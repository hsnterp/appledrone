import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import './OrchardMap.css';

const API_BASE_URL = 'http://localhost:5000/api';
const CM = 0.01;                 // cm -> scene metres (positions arrive in cm)
const APPLE_BASE = 0.082;        // -> ~7.5 cm apple at confidence ~1

/* ---------------------------------------------------------------------
   Ripeness tokens (ported from design/orchard/orchard-data.js).
   Color by ripeKey() — `isUncertain` overrides the raw ripeness.
   --------------------------------------------------------------------- */
const RIPENESS = {
  ripe:      { label: 'Ripe',      color: '#5F8A4C' },
  unripe:    { label: 'Unripe',    color: '#C9A227' },
  overripe:  { label: 'Overripe',  color: '#A8482F' },
  uncertain: { label: 'Uncertain', color: '#C2702E' }
};
const RIPENESS_ORDER = ['ripe', 'unripe', 'overripe', 'uncertain'];
const ripeKey = (d) => (d.isUncertain ? 'uncertain' : d.ripeness);

/* ---- seeded RNG (mulberry32) + string hash for stable procedural trees */
function seeded(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ---------------------------------------------------------------------
   Derived helpers (ported from orchard-data.js). groupByTree derives each
   tree's center from the mean x/z of its detections (per the handoff).
   --------------------------------------------------------------------- */
function groupByTree(detections) {
  const map = {};
  detections.forEach((d) => {
    let g = map[d.treeId];
    if (!g) {
      g = map[d.treeId] = {
        treeId: d.treeId, total: 0, breakdown: { ripe: 0, unripe: 0, overripe: 0 },
        uncertain: 0, dominant: 'ripe', detections: [], _sx: 0, _sz: 0
      };
    }
    g.total++;
    g.detections.push(d);
    if (d.isUncertain) g.uncertain++;
    if (g.breakdown[d.ripeness] != null) g.breakdown[d.ripeness]++;
    g._sx += d.position.x; g._sz += d.position.z;
  });
  Object.keys(map).forEach((k) => {
    const g = map[k];
    g.cx = g.total ? g._sx / g.total : 0;   // mean x (cm)
    g.cz = g.total ? g._sz / g.total : 0;   // mean z (cm)
    g.row = g.cx < 0 ? 'A' : 'B';
    const b = g.breakdown;
    g.dominant = Object.keys(b).reduce((a, c) => (b[c] > b[a] ? c : a), 'ripe');
  });
  return map;
}

function computeTotals(detections) {
  const t = { total: detections.length, ripe: 0, unripe: 0, overripe: 0, uncertain: 0, conf: 0 };
  detections.forEach((d) => {
    if (d.isUncertain) t.uncertain++;
    if (t[d.ripeness] != null) t[d.ripeness]++;
    t.conf += d.confidence;
  });
  t.avgConf = detections.length ? t.conf / detections.length : 0;
  return t;
}

/* =====================================================================
   Procedural geometry (ported ~verbatim from orchard-tree.js).
   Da Vinci pipe model + phyllotaxis + length allometry + tropisms.
   ===================================================================== */
const PHI = (1 + Math.sqrt(5)) / 2;
const GOLDEN_ANGLE = Math.PI * 2 * (1 - 1 / PHI);   // ≈ 137.5°
const DELTA = 2.3;                                  // pipe-model exponent

// realistic apple: lathe a half-silhouette (calyx dimple + stem cavity)
const APPLE_PROFILE = [
  [0.00, 0.00], [0.07, 0.015], [0.11, 0.05], [0.075, 0.085],
  [0.17, 0.13], [0.31, 0.23], [0.43, 0.37], [0.485, 0.50],
  [0.47, 0.63], [0.40, 0.75], [0.28, 0.85], [0.14, 0.92],
  [0.055, 0.95], [0.10, 0.965], [0.045, 0.99], [0.0, 1.0]
].map(([x, y]) => new THREE.Vector2(x * 0.95, y));

const APPLE_GEOM = new THREE.LatheGeometry(APPLE_PROFILE, 18);
APPLE_GEOM.translate(0, -0.5, 0);
APPLE_GEOM.computeVertexNormals();

const STEM_GEOM = new THREE.CylinderGeometry(0.016, 0.024, 0.24, 5);
STEM_GEOM.translate(0, 0.5 + 0.12, 0);   // base seated in the apple's stem cavity

// Build one tree. Returns { group, foliageMats, crownTop }.
function buildTree(rand, opts) {
  opts = opts || {};
  const barkColor = opts.barkColor || '#7c5a3c';
  const leafColor = new THREE.Color(opts.leafColor || '#7d9b62');

  const group = new THREE.Group();
  const branchGeoms = [];
  const foliageGeoms = [];
  let crownTop = 0;

  const heightScale = 0.92 + rand() * 0.22;
  const r0 = 0.052 * (0.9 + rand() * 0.25);
  const L0 = 1.05 * heightScale;
  const MAX_DEPTH = 4;
  const MIN_R = 0.009;

  const up = new THREE.Vector3(0, 1, 0);
  const _q = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _scale = new THREE.Vector3(1, 1, 1);

  function addBranch(start, dir, len, rStart, rEnd) {
    const geom = new THREE.CylinderGeometry(rEnd, rStart, len, 6, 1);
    const mid = start.clone().addScaledVector(dir, len / 2);
    _q.setFromUnitVectors(up, dir.clone().normalize());
    _m.compose(mid, _q, _scale);
    geom.applyMatrix4(_m);
    branchGeoms.push(geom);
  }

  function addFoliage(center, radius) {
    const g = new THREE.IcosahedronGeometry(radius, 1);
    g.scale(1, 0.82 + rand() * 0.2, 1);
    g.translate(center.x, center.y, center.z);
    foliageGeoms.push(g);
    crownTop = Math.max(crownTop, center.y + radius);
  }

  function grow(start, dir, len, radius, depth) {
    const segs = depth === 0 ? 3 : 2;
    let p = start.clone();
    let d = dir.clone().normalize();
    let r = radius;
    for (let s = 0; s < segs; s++) {
      const segLen = len / segs;
      const rTo = radius * (1 - (s + 1) / segs * 0.45);
      const bias = depth <= 1 ? 0.10 : -0.06 - depth * 0.02;
      d.lerp(new THREE.Vector3(0, bias > 0 ? 1 : -1, 0), Math.abs(bias)).normalize();
      const end = p.clone().addScaledVector(d, segLen);
      addBranch(p, d, segLen, r, rTo);
      p = end; r = rTo;
    }
    crownTop = Math.max(crownTop, p.y);

    if (depth >= MAX_DEPTH || radius < MIN_R) {
      addFoliage(p, 0.16 + rand() * 0.14);
      return;
    }

    const n = depth === 0 ? 3 : (depth === 1 ? 3 : 2);
    const childR = radius * Math.pow(n, -1 / DELTA);
    const childLen = len * (0.74 + rand() * 0.06);
    const baseAngle = (depth === 0 ? 32 : 42 + depth * 6) * Math.PI / 180;

    for (let i = 0; i < n; i++) {
      const azim = GOLDEN_ANGLE * i + rand() * 0.5;
      const angle = baseAngle * (0.8 + rand() * 0.4);
      const ortho = new THREE.Vector3(1, 0, 0).applyAxisAngle(up, azim);
      ortho.sub(d.clone().multiplyScalar(ortho.dot(d))).normalize();
      const childDir = d.clone().applyAxisAngle(ortho, angle).normalize();
      grow(p, childDir, childLen, childR, depth + 1);
    }
    if (depth <= 1) {
      grow(p, d.clone().lerp(up, 0.4).normalize(), childLen * 0.85, childR * 0.9, depth + 1);
    }
  }

  grow(new THREE.Vector3(0, 0, 0), up.clone(), L0, r0, 0);

  const barkMat = new THREE.MeshStandardMaterial({ color: barkColor, roughness: 0.95, metalness: 0 });
  const branchMesh = new THREE.Mesh(mergeGeometries(branchGeoms, false), barkMat);
  branchMesh.castShadow = true; branchMesh.receiveShadow = true;
  branchMesh.userData = { kind: 'tree' };
  group.add(branchMesh);

  const leafMat = new THREE.MeshStandardMaterial({
    color: leafColor, roughness: 0.85, metalness: 0, flatShading: true,
    transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide
  });
  const foliageMesh = new THREE.Mesh(mergeGeometries(foliageGeoms, false), leafMat);
  foliageMesh.castShadow = true;
  foliageMesh.userData = { kind: 'tree' };
  group.add(foliageMesh);

  branchGeoms.forEach((g) => g.dispose());
  foliageGeoms.forEach((g) => g.dispose());

  return { group, foliageMats: [leafMat], crownTop };
}

/* =====================================================================
   3D scene pieces (R3F)
   ===================================================================== */
function Lights() {
  return (
    <>
      <hemisphereLight args={['#fbf6e9', '#cdbf9e', 0.95]} />
      <directionalLight
        color="#fff7e6" intensity={1.05} position={[6, 12, 4]} castShadow
        shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-near={1} shadow-camera-far={50}
        shadow-camera-left={-16} shadow-camera-right={16}
        shadow-camera-top={20} shadow-camera-bottom={-6}
        shadow-bias={-0.0004}
      />
    </>
  );
}

function GroundAndGrid() {
  const grids = useMemo(() => {
    const fine = new THREE.GridHelper(80, 80, '#C8B894', '#C8B894');
    fine.position.set(0, 0.002, 7);
    fine.material.transparent = true; fine.material.opacity = 0.32;
    const bold = new THREE.GridHelper(80, 16, '#6B6354', '#C8B894');
    bold.position.set(0, 0.004, 7);
    bold.material.transparent = true; bold.material.opacity = 0.22;
    return { fine, bold };
  }, []);

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 7]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshToonMaterial color="#EAE0CC" />
      </mesh>
      <primitive object={grids.fine} />
      <primitive object={grids.bold} />
      {/* mission-pad marker at the drone origin (0,0) */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.16, 0.26, 24]} />
        <meshBasicMaterial color="#2E2A22" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.011, 0]}>
        <circleGeometry args={[0.08, 20]} />
        <meshBasicMaterial color="#2E2A22" />
      </mesh>
    </>
  );
}

function TreeMesh({ built, position, treeId, active, onSelect, onHover }) {
  useEffect(() => {
    built.foliageMats.forEach((m) => { m.opacity = active ? 0.46 : 0.3; });
  }, [active, built]);

  return (
    <group
      position={position}
      onPointerOver={(e) => { e.stopPropagation(); onHover(treeId); document.body.style.cursor = 'pointer'; }}
      onPointerOut={(e) => { e.stopPropagation(); onHover(null); document.body.style.cursor = 'auto'; }}
      onClick={(e) => { e.stopPropagation(); onSelect(treeId); }}
    >
      <primitive object={built.group} />
    </group>
  );
}

const Fruit = memo(function Fruit({ det, selectedTreeId, filterKey, onSelect, showTooltip, hideTooltip }) {
  const key = ripeKey(det);
  const [hovered, setHovered] = useState(false);

  const look = useMemo(() => {
    const rand = seeded(hashStr(det.id));
    const v = 0.93 + rand() * 0.12;     // gentle per-apple lightness variation
    const color = new THREE.Color(RIPENESS[key].color).multiplyScalar(v).getStyle();
    return {
      color,
      baseScale: APPLE_BASE * (0.85 + det.confidence * 0.5),
      rotation: [(rand() - 0.5) * 0.6, rand() * 6.28, (rand() - 0.5) * 0.6],
      stemTilt: (rand() - 0.5) * 0.5
    };
  }, [det.id, det.confidence, key]);

  const matchFilter = !filterKey || key === filterKey;
  const inSel = !selectedTreeId || det.treeId === selectedTreeId;
  const dim = (filterKey && !matchFilter) || (selectedTreeId && !inSel);
  const emph = filterKey && matchFilter;          // highlighted by the legend filter
  const scale = look.baseScale * (hovered ? 1.7 : emph ? 1.18 : 1);
  const emissiveIntensity = hovered ? 0.55 : emph ? 0.3 : 0.12;

  return (
    <mesh
      geometry={APPLE_GEOM}
      position={[det.position.x * CM, det.position.y * CM, det.position.z * CM]}
      rotation={look.rotation}
      scale={scale}
      castShadow
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; showTooltip(det, key, e.clientX, e.clientY); }}
      onPointerMove={(e) => { e.stopPropagation(); showTooltip(det, key, e.clientX, e.clientY); }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto'; hideTooltip(); }}
      onClick={(e) => { e.stopPropagation(); onSelect(det.treeId); }}
    >
      <meshStandardMaterial
        color={look.color} emissive={look.color} emissiveIntensity={emissiveIntensity}
        roughness={0.4} metalness={0} transparent={!!dim} opacity={dim ? 0.12 : 1}
      />
      <mesh geometry={STEM_GEOM} rotation-z={look.stemTilt}>
        <meshStandardMaterial color="#6b4f33" roughness={0.9} />
      </mesh>
    </mesh>
  );
});

/* Camera tween: lerp position + controls target together (cubic ease-out). */
function CameraRig({ selectedTreeId, treeCenters, controlsRef }) {
  const { camera } = useThree();
  const tween = useRef(null);
  const didMount = useRef(false);

  useEffect(() => {
    if (!didMount.current) { didMount.current = true; if (!selectedTreeId) return; }
    let camPos, target;
    const c = treeCenters[selectedTreeId];
    if (selectedTreeId && c) {
      const aisleDir = c.cx < 0 ? 1 : -1;
      camPos = new THREE.Vector3(c.cx + aisleDir * 2.5, 1.95, c.cz - 0.7);
      target = new THREE.Vector3(c.cx, 1.7, c.cz);
    } else {
      camPos = new THREE.Vector3(0, 2.45, -5.8);
      target = new THREE.Vector3(0, 1.35, 7);
    }
    const ctrl = controlsRef.current;
    tween.current = {
      fromC: camera.position.clone(), toC: camPos,
      fromT: ctrl ? ctrl.target.clone() : new THREE.Vector3(0, 1.35, 7),
      toT: target, t: 0
    };
    if (ctrl) ctrl.enabled = false;
  }, [selectedTreeId, treeCenters, camera, controlsRef]);

  useFrame((_, delta) => {
    const tw = tween.current;
    if (!tw) return;
    tw.t = Math.min(1, tw.t + (delta * 1000) / 850);
    const k = 1 - Math.pow(1 - tw.t, 3);
    camera.position.lerpVectors(tw.fromC, tw.toC, k);
    const ctrl = controlsRef.current;
    if (ctrl) ctrl.target.lerpVectors(tw.fromT, tw.toT, k);
    if (tw.t >= 1) {
      tween.current = null;
      if (ctrl) { ctrl.enabled = true; ctrl.update(); }
    }
  });

  return null;
}

/* Project each tree's crown anchor to screen space every frame and drive the
   floating label chips imperatively, with nearest-first declutter. */
function ChipProjector({ anchors, chipRefs, selectedTreeId, hoverTreeId }) {
  const { camera, size } = useThree();
  const scratch = useMemo(() => ({ v: new THREE.Vector3(), cam: new THREE.Vector3() }), []);

  useFrame(() => {
    const w = size.width, h = size.height;
    const items = [];
    anchors.forEach(({ treeId, anchor }) => {
      const el = chipRefs.current[treeId];
      if (!el) return;
      scratch.cam.copy(anchor).applyMatrix4(camera.matrixWorldInverse);
      const behind = scratch.cam.z > -0.4;
      scratch.v.copy(anchor).project(camera);
      const x = (scratch.v.x * 0.5 + 0.5) * w;
      const y = (-scratch.v.y * 0.5 + 0.5) * h;
      const dist = camera.position.distanceTo(anchor);
      if (behind || dist > 24 || x < -60 || x > w + 60 || y < -40 || y > h + 40) {
        el.style.display = 'none'; return;
      }
      items.push({ treeId, el, x, y, dist });
    });
    items.sort((a, b) => a.dist - b.dist);
    const placed = [];
    items.forEach((it) => {
      const selOrHover = it.treeId === selectedTreeId || it.treeId === hoverTreeId;
      const clash = !selOrHover && placed.some((p) => Math.abs(p.x - it.x) < 58 && Math.abs(p.y - it.y) < 30);
      it.el.classList.toggle('is-hover', it.treeId === hoverTreeId);
      it.el.classList.toggle('is-selected', it.treeId === selectedTreeId);
      if (clash) { it.el.style.display = 'none'; return; }
      it.el.style.display = 'flex';
      it.el.style.transform = `translate(-50%,-100%) translate(${it.x}px, ${it.y}px)`;
      it.el.style.opacity = String(Math.max(0.45, 1 - Math.max(0, it.dist - 6) / 24));
      placed.push(it);
    });
  });

  return null;
}

function Scene({
  trees, builtTrees, detections, selectedTreeId, filterKey, hoverTreeId,
  setHoverTree, onSelect, showTooltip, hideTooltip,
  anchors, treeCenters, chipRefs, controlsRef
}) {
  return (
    <>
      <color attach="background" args={['#F2EADA']} />
      <fog attach="fog" args={['#F2EADA', 17, 36]} />
      <Lights />
      <GroundAndGrid />

      {trees.map((t) => (
        <TreeMesh
          key={t.treeId}
          built={builtTrees[t.treeId]}
          position={[t.cx * CM, 0, t.cz * CM]}
          treeId={t.treeId}
          active={t.treeId === selectedTreeId || t.treeId === hoverTreeId}
          onSelect={onSelect}
          onHover={setHoverTree}
        />
      ))}

      {detections.map((d) => (
        <Fruit
          key={d.id}
          det={d}
          selectedTreeId={selectedTreeId}
          filterKey={filterKey}
          onSelect={onSelect}
          showTooltip={showTooltip}
          hideTooltip={hideTooltip}
        />
      ))}

      <CameraRig selectedTreeId={selectedTreeId} treeCenters={treeCenters} controlsRef={controlsRef} />
      <ChipProjector anchors={anchors} chipRefs={chipRefs} selectedTreeId={selectedTreeId} hoverTreeId={hoverTreeId} />

      <OrbitControls
        ref={controlsRef} makeDefault
        enableDamping dampingFactor={0.08}
        target={[0, 1.35, 7]}
        minDistance={1.6} maxDistance={26}
        maxPolarAngle={1.46} minPolarAngle={0.18}
      />
    </>
  );
}

/* =====================================================================
   Overlay UI (screen-fixed chrome, rebuilt as React components)
   ===================================================================== */
function SummaryBar({ totals, sessionId, capturedAt, treeCount }) {
  return (
    <header className="bar">
      <div className="brand">
        <span className="brand-mark">✻</span>
        <div className="brand-txt">
          <div className="brand-name">Pomona</div>
          <div className="brand-sub">Orchard Field Survey</div>
        </div>
      </div>
      <div className="bar-total">
        <span className="bt-num">{totals.total}</span>
        <span className="bt-lbl">apples<br />mapped</span>
      </div>
      <div className="bar-meta">
        <div className="bm-row"><span>session</span><b>{sessionId}</b></div>
        {capturedAt && <div className="bm-row"><span>captured</span><b>{capturedAt}</b></div>}
        <div className="bm-row"><span>trees</span><b>{treeCount}</b></div>
      </div>
    </header>
  );
}

function Legend({ filterKey, setFilter, totals }) {
  return (
    <div className="legend">
      <div className="legend-cap">Ripeness key — <em>tap to highlight</em></div>
      <div className="legend-rows">
        {RIPENESS_ORDER.map((k) => {
          const r = RIPENESS[k];
          const active = filterKey === k;
          const dim = filterKey && !active;
          return (
            <button
              key={k}
              className={'leg-chip' + (active ? ' active' : '') + (dim ? ' dim' : '')}
              onClick={() => setFilter(active ? null : k)}
            >
              <span className="leg-dot" style={{ background: r.color }} />
              <span className="leg-name">{r.label}</span>
              <span className="leg-n">{totals[k] || 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RuleBar({ k, value, max }) {
  const r = RIPENESS[k];
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="rb">
      <div className="rb-top">
        <span className="rb-name"><span className="rb-dot" style={{ background: r.color }} />{r.label}</span>
        <span className="rb-val">{value}</span>
      </div>
      <div className="rb-track"><div className="rb-fill" style={{ width: pct + '%', background: r.color }} /></div>
    </div>
  );
}

function DetailPanel({ tree, onClose }) {
  if (!tree) return null;
  const max = Math.max(tree.breakdown.ripe, tree.breakdown.unripe, tree.breakdown.overripe, 1);
  const dom = RIPENESS[tree.dominant];
  const uncertain = tree.detections.filter((d) => d.isUncertain);
  return (
    <aside className="panel">
      <button className="panel-close" onClick={onClose}>← back to orchard</button>
      <div className="panel-head">
        <div className="ph-id">{tree.treeId}</div>
        <div className="ph-meta">Row {tree.row} · specimen</div>
      </div>
      <div className="panel-figure">
        <div className="pf-num">{tree.total}</div>
        <div className="pf-lbl">apples detected</div>
        <div className="pf-dom" style={{ '--dot': dom.color }}>mostly <b>{dom.label.toLowerCase()}</b></div>
      </div>
      <div className="panel-sec">
        <div className="sec-cap">Ripeness breakdown</div>
        <RuleBar k="ripe" value={tree.breakdown.ripe} max={max} />
        <RuleBar k="unripe" value={tree.breakdown.unripe} max={max} />
        <RuleBar k="overripe" value={tree.breakdown.overripe} max={max} />
      </div>
      <div className="panel-sec">
        <div className="sec-cap">Field notes</div>
        {uncertain.length === 0 ? (
          <p className="note-clean">No uncertain detections — all reads above threshold.</p>
        ) : (
          <ul className="note-list">
            <li className="nl-head">{uncertain.length} flagged for review</li>
            {uncertain.map((d) => (
              <li key={d.id} className="nl-item">
                <span className="nl-dot" />
                <span className="nl-txt">{d.fruitType} · possible {RIPENESS[d.ripeness]?.label.toLowerCase() || d.ripeness}</span>
                <span className="nl-conf">{Math.round(d.confidence * 100)}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="panel-coords">
        ~ {Math.round(tree.cx)}, {Math.round(tree.cz)} cm from mission pad
      </div>
    </aside>
  );
}

/* =====================================================================
   Data hook — GET /api/session/:id/detections
   ===================================================================== */
function useDetections(sessionId) {
  const [state, setState] = useState({ detections: [], loading: true, error: null, capturedAt: null });

  useEffect(() => {
    if (!sessionId) { setState({ detections: [], loading: false, error: null, capturedAt: null }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(`${API_BASE_URL}/session/${sessionId}/detections`)
      .then((res) => { if (!res.ok) throw new Error('Failed to fetch detections'); return res.json(); })
      .then((data) => {
        if (cancelled) return;
        setState({
          detections: data.detections || [],
          loading: false, error: null,
          capturedAt: data.capturedAt || null
        });
      })
      .catch((err) => { if (!cancelled) setState({ detections: [], loading: false, error: err.message, capturedAt: null }); });
    return () => { cancelled = true; };
  }, [sessionId]);

  return state;
}

/* =====================================================================
   Root component
   ===================================================================== */
function OrchardMap({ sessionId }) {
  const { detections, loading, error, capturedAt } = useDetections(sessionId);

  const [selectedTreeId, setSelectedTreeId] = useState(null);
  const [filterKey, setFilterKey] = useState(null);
  const [hoverTreeId, setHoverTreeId] = useState(null);

  const containerRef = useRef(null);
  const tooltipRef = useRef(null);
  const chipRefs = useRef({});
  const controlsRef = useRef(null);

  // ---- derived data (memoized) ----
  const byTree = useMemo(() => groupByTree(detections), [detections]);
  const trees = useMemo(() => Object.values(byTree), [byTree]);
  const totals = useMemo(() => computeTotals(detections), [detections]);

  // procedural tree geometry — built once per tree set, seeded by treeId
  const builtTrees = useMemo(() => {
    const m = {};
    trees.forEach((t, i) => {
      const b = buildTree(seeded(hashStr(t.treeId)), { barkColor: '#7c5a3c', leafColor: '#7d9b62' });
      b.group.rotation.y = i * 1.3;
      m[t.treeId] = b;
    });
    return m;
  }, [trees]);

  // dispose old geometry/materials when the tree set changes or on unmount
  useEffect(() => {
    return () => {
      Object.values(builtTrees).forEach((b) => {
        b.group.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose());
        });
      });
    };
  }, [builtTrees]);

  // label anchors (crown top) + tree centers in scene metres
  const anchors = useMemo(() => trees.map((t) => ({
    treeId: t.treeId,
    anchor: new THREE.Vector3(t.cx * CM, (builtTrees[t.treeId]?.crownTop || 2) + 0.28, t.cz * CM)
  })), [trees, builtTrees]);

  const treeCenters = useMemo(() => {
    const m = {};
    trees.forEach((t) => { m[t.treeId] = { cx: t.cx * CM, cz: t.cz * CM }; });
    return m;
  }, [trees]);

  // ---- imperative tooltip (avoids re-rendering the scene on pointer move) ----
  const showTooltip = useCallback((det, key, clientX, clientY) => {
    const el = tooltipRef.current, cont = containerRef.current;
    if (!el || !cont) return;
    const r = cont.getBoundingClientRect();
    const rk = RIPENESS[key];
    el.innerHTML =
      `<div class="tt-head"><span class="tt-dot" style="background:${rk.color}"></span>` +
      `${det.fruitType} · <em>${rk.label}</em></div>` +
      `<div class="tt-row">confidence <b>${Math.round(det.confidence * 100)}%</b></div>` +
      `<div class="tt-row">tree <b>${det.treeId}</b></div>` +
      (det.isUncertain ? `<div class="tt-flag">flagged uncertain — needs review</div>` : ``);
    el.style.display = 'block';
    const pad = 16;
    let x = clientX - r.left + pad, y = clientY - r.top + pad;
    const tw = el.offsetWidth, th = el.offsetHeight;
    if (x + tw > r.width) x = clientX - r.left - tw - pad;
    if (y + th > r.height) y = clientY - r.top - th - pad;
    el.style.left = Math.max(0, x) + 'px';
    el.style.top = Math.max(0, y) + 'px';
  }, []);

  const hideTooltip = useCallback(() => {
    const el = tooltipRef.current;
    if (el) el.style.display = 'none';
  }, []);

  // ---- interaction handlers ----
  const onSelect = useCallback((id) => setSelectedTreeId(id), []);
  const onDeselect = useCallback(() => setSelectedTreeId(null), []);
  const setHoverTree = useCallback((id) => setHoverTreeId((prev) => (prev === id ? prev : id)), []);
  const setFilter = useCallback((k) => setFilterKey(k), []);

  const selectedTree = selectedTreeId ? byTree[selectedTreeId] : null;
  const isEmpty = !loading && !error && detections.length === 0;

  return (
    <div className="orchard-map" ref={containerRef}>
      {(loading || error || isEmpty) ? (
        <div className={'splash' + (error ? ' error' : '')}>
          {loading && <div className="spin" />}
          {loading && <div>Reading the orchard…</div>}
          {error && <div>Couldn't load detections — {error}</div>}
          {isEmpty && <div>No detections in this session yet.</div>}
        </div>
      ) : (
        <>
          <Canvas
            shadows
            dpr={[1, 2]}
            gl={{ antialias: true }}
            camera={{ fov: 50, near: 0.1, far: 200, position: [0, 2.45, -5.8] }}
            onPointerMissed={onDeselect}
          >
            <Scene
              trees={trees}
              builtTrees={builtTrees}
              detections={detections}
              selectedTreeId={selectedTreeId}
              filterKey={filterKey}
              hoverTreeId={hoverTreeId}
              setHoverTree={setHoverTree}
              onSelect={onSelect}
              showTooltip={showTooltip}
              hideTooltip={hideTooltip}
              anchors={anchors}
              treeCenters={treeCenters}
              chipRefs={chipRefs}
              controlsRef={controlsRef}
            />
          </Canvas>

          {/* floating, projected tree-label chips (positioned by ChipProjector) */}
          <div className="labels">
            {trees.map((t) => (
              <button
                key={t.treeId}
                ref={(el) => { chipRefs.current[t.treeId] = el; }}
                className="tree-chip"
                onClick={(e) => { e.stopPropagation(); onSelect(t.treeId); }}
                onPointerEnter={() => setHoverTree(t.treeId)}
                onPointerLeave={() => setHoverTree(null)}
              >
                <span className="tc-id">{t.treeId}</span>
                <span className="tc-detail">
                  <span className="tc-count">{t.total}</span> apples
                  <span className="tc-dom" style={{ '--dot': RIPENESS[t.dominant].color }}>
                    {RIPENESS[t.dominant].label}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* screen-fixed chrome */}
          <div className="ui">
            <SummaryBar totals={totals} sessionId={sessionId} capturedAt={capturedAt} treeCount={trees.length} />
            <Legend filterKey={filterKey} setFilter={setFilter} totals={totals} />
            <DetailPanel tree={selectedTree} onClose={onDeselect} />
            <div className="hint">drag to look · scroll to zoom · click a tree to inspect</div>
          </div>

          <div className="tooltip" ref={tooltipRef} />
        </>
      )}
    </div>
  );
}

export default OrchardMap;
