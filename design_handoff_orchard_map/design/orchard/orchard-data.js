/* =====================================================================
   orchard-data.js  (classic script — sets window globals)
   ---------------------------------------------------------------------
   Produces MOCK detections in the EXACT shape your API returns:
     GET /api/session/:id/detections
     -> { detections: [ { id, fruitType, ripeness, confidence,
                          isUncertain, treeId, position:{x,y,z} } ] }
   Positions are in CENTIMETRES relative to the drone's mission pad.
   When wiring real data, delete generateMockSession() and feed the
   fetched `detections` array straight into window.ORCHARD.detections.
   ===================================================================== */
(function () {
  'use strict';

  // ---- Sketchbook palette (muted botanical-plate inks) ----------------
  var PALETTE = {
    paper:    '#EAE0CC',
    paperHi:  '#F2EADA',
    ink:      '#2E2A22',
    inkSoft:  '#6B6354',
    grid:     '#C8B894',
    rule:     '#D7CBB0'
  };

  // ripeness -> { label, dot color, soft tint } -------------------------
  var RIPENESS = {
    ripe:      { label: 'Ripe',      color: '#5F8A4C', tint: '#5F8A4C' },
    unripe:    { label: 'Unripe',    color: '#C9A227', tint: '#C9A227' },
    overripe:  { label: 'Overripe',  color: '#A8482F', tint: '#A8482F' },
    uncertain: { label: 'Uncertain', color: '#C2702E', tint: '#C2702E' }
  };
  // Display order used by legend + panels
  var RIPENESS_ORDER = ['ripe', 'unripe', 'overripe', 'uncertain'];

  // Effective ripeness key for coloring (uncertain overrides)
  function ripeKey(d) { return d.isUncertain ? 'uncertain' : d.ripeness; }

  // ---- Seeded RNG (mulberry32) so the mock is stable ------------------
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- Orchard layout -------------------------------------------------
  // Two rows flanking a central aisle the drone flies down.
  // Coordinates in cm, mission pad at origin (0,0). +Z runs down the aisle.
  function treeLayout() {
    var trees = [];
    var rows = [
      { side: 'A', x: -220 },   // left row
      { side: 'B', x:  220 }    // right row
    ];
    var zStops = [60, 420, 780, 1140, 1500];
    var n = 1;
    rows.forEach(function (row) {
      zStops.forEach(function (z, i) {
        var id = 'T-' + String(n).padStart(2, '0');
        trees.push({
          treeId: id,
          x: row.x + (i % 2 === 0 ? -14 : 18),   // slight natural jitter
          z: z + (row.side === 'A' ? -10 : 12),
          row: row.side
        });
        n++;
      });
    });
    return trees;
  }

  // Distribute fruit inside a canopy (cm offsets from trunk top)
  function fruitInCanopy(rand, cx, cz) {
    var canopyR = 118;                 // canopy radius (cm)
    var u = rand(), v = rand(), w = rand();
    var theta = u * Math.PI * 2;
    var phi = Math.acos(2 * v - 1);
    var r = canopyR * Math.cbrt(w);    // uniform in sphere
    return {
      x: Math.round(cx + r * Math.sin(phi) * Math.cos(theta)),
      y: Math.round(180 + r * 0.78 * Math.cos(phi)),   // canopy centered ~180cm
      z: Math.round(cz + r * Math.sin(phi) * Math.sin(theta))
    };
  }

  function generateMockSession(seed) {
    var rand = rng(seed || 7);
    var trees = treeLayout();
    var dets = [];
    var uid = 0;

    trees.forEach(function (t, ti) {
      // each tree gets a slightly different ripeness "personality"
      var count = 9 + Math.floor(rand() * 13);          // 9..21 fruits
      var bias = rand();                                 // dominant lean
      for (var k = 0; k < count; k++) {
        var p = fruitInCanopy(rand, t.x, t.z);
        var roll = rand();
        var ripeness;
        if (bias < 0.34)      ripeness = roll < 0.62 ? 'ripe'     : (roll < 0.85 ? 'unripe'   : 'overripe');
        else if (bias < 0.67) ripeness = roll < 0.55 ? 'unripe'   : (roll < 0.82 ? 'ripe'     : 'overripe');
        else                  ripeness = roll < 0.48 ? 'overripe' : (roll < 0.78 ? 'ripe'     : 'unripe');

        var conf = 0.55 + rand() * 0.44;                 // 0.55..0.99
        var isUncertain = rand() < 0.12;                 // ~12% flagged
        if (isUncertain) conf = 0.42 + rand() * 0.22;    // lower conf

        dets.push({
          id: 'd' + (++uid),
          fruitType: 'apple',
          ripeness: ripeness,
          confidence: +conf.toFixed(3),
          isUncertain: isUncertain,
          treeId: t.treeId,
          position: p
        });
      }
    });

    return {
      sessionId: 'mock-' + (seed || 7),
      capturedAt: '2026-06-05T09:14:00',
      trees: trees,            // helper for layout (real API derives from positions)
      detections: dets
    };
  }

  // ---- Derived helpers ------------------------------------------------
  // Group detections by treeId, compute per-tree breakdown + dominant.
  function groupByTree(detections, treeMeta) {
    var map = {};
    (treeMeta || []).forEach(function (t) {
      map[t.treeId] = {
        treeId: t.treeId, row: t.row, x: t.x, z: t.z,
        total: 0, breakdown: { ripe: 0, unripe: 0, overripe: 0 },
        uncertain: 0, dominant: 'ripe', detections: []
      };
    });
    detections.forEach(function (d) {
      var g = map[d.treeId] || (map[d.treeId] = {
        treeId: d.treeId, total: 0, breakdown: { ripe: 0, unripe: 0, overripe: 0 },
        uncertain: 0, dominant: 'ripe', detections: []
      });
      g.total++;
      g.detections.push(d);
      if (d.isUncertain) g.uncertain++;
      if (g.breakdown[d.ripeness] != null) g.breakdown[d.ripeness]++;
    });
    Object.keys(map).forEach(function (k) {
      var b = map[k].breakdown;
      map[k].dominant = Object.keys(b).reduce(function (a, c) {
        return b[c] > b[a] ? c : a;
      }, 'ripe');
    });
    return map;
  }

  function totals(detections) {
    var t = { total: detections.length, ripe: 0, unripe: 0, overripe: 0, uncertain: 0, conf: 0 };
    detections.forEach(function (d) {
      if (d.isUncertain) t.uncertain++;
      if (t[d.ripeness] != null) t[d.ripeness]++;
      t.conf += d.confidence;
    });
    t.avgConf = detections.length ? t.conf / detections.length : 0;
    return t;
  }

  var session = generateMockSession(7);

  window.ORCHARD = {
    PALETTE: PALETTE,
    RIPENESS: RIPENESS,
    RIPENESS_ORDER: RIPENESS_ORDER,
    ripeKey: ripeKey,
    session: session,
    detections: session.detections,
    trees: session.trees,
    byTree: groupByTree(session.detections, session.trees),
    totals: totals(session.detections),
    helpers: { groupByTree: groupByTree, totals: totals, generateMockSession: generateMockSession }
  };

  // event bus shared by the Three scene + React UI
  window.bus = window.bus || new EventTarget();
})();
