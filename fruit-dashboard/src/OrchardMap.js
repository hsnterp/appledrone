import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MissionPad, DroneFlight, FlightHUD } from './DroneFlight';
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

/* Smaller, rounder variant for located "bush" labels — same foliage
   technique (translucent icosahedron blobs) over a few short stems. */
function buildBush(rand, opts) {
  opts = opts || {};
  const barkColor = opts.barkColor || '#7c5a3c';
  const leafColor = new THREE.Color(opts.leafColor || '#7d9b62');

  const group = new THREE.Group();
  const branchGeoms = [];
  const foliageGeoms = [];
  let crownTop = 0;

  const up = new THREE.Vector3(0, 1, 0);
  const _q = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _s = new THREE.Vector3(1, 1, 1);

  const stems = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < stems; i++) {
    const azim = (i / stems) * Math.PI * 2 + rand() * 0.8;
    const dir = new THREE.Vector3(Math.sin(azim) * 0.5, 1, Math.cos(azim) * 0.5).normalize();
    const len = 0.32 + rand() * 0.2;
    const geom = new THREE.CylinderGeometry(0.011, 0.022, len, 5);
    _q.setFromUnitVectors(up, dir);
    _m.compose(dir.clone().multiplyScalar(len / 2), _q, _s);
    geom.applyMatrix4(_m);
    branchGeoms.push(geom);
  }

  const blobs = 6 + Math.floor(rand() * 3);
  for (let i = 0; i < blobs; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 0.3;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const cy = 0.32 + rand() * 0.28;
    const radius = 0.18 + rand() * 0.14;
    const g = new THREE.IcosahedronGeometry(radius, 1);
    g.scale(1, 0.78 + rand() * 0.2, 1);
    g.translate(cx, cy, cz);
    foliageGeoms.push(g);
    crownTop = Math.max(crownTop, cy + radius);
  }

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
      {/* mission pad at the drone origin (0,0) — see DroneFlight.js */}
      <MissionPad />
    </>
  );
}

/* base ring marking trees confirmed by the locator endpoint */
function LocatedRing() {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]}>
      <ringGeometry args={[0.3, 0.36, 28]} />
      <meshBasicMaterial color="#C2702E" transparent opacity={0.5} side={THREE.DoubleSide} />
    </mesh>
  );
}

function TreeMesh({ built, position, treeId, active, located, onSelect, onHover }) {
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
      {located && <LocatedRing />}
    </group>
  );
}

/* standalone located tree/bush (from /trees, no detection cluster nearby) */
function LocatedTreeMesh({ lt, built, active, onSelect, onHover, showTip, hideTip }) {
  useEffect(() => {
    built.foliageMats.forEach((m) => { m.opacity = active ? 0.46 : 0.3; });
  }, [active, built]);

  const key = 'loc:' + lt.id;
  return (
    <group
      position={[lt.position.x * CM, 0, lt.position.z * CM]}
      onPointerOver={(e) => { e.stopPropagation(); onHover(key); document.body.style.cursor = 'pointer'; showTip(lt, e.clientX, e.clientY); }}
      onPointerMove={(e) => { e.stopPropagation(); showTip(lt, e.clientX, e.clientY); }}
      onPointerOut={(e) => { e.stopPropagation(); onHover(null); document.body.style.cursor = 'auto'; hideTip(); }}
      onClick={(e) => { e.stopPropagation(); onSelect(key); }}
    >
      <primitive object={built.group} />
      <LocatedRing />
    </group>
  );
}

const Fruit = memo(function Fruit({ det, offset, selectedTreeId, filterKey, onSelect, showTooltip, hideTooltip }) {
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
      position={[
        (det.position.x + (offset ? offset.dx : 0)) * CM,
        det.position.y * CM,
        (det.position.z + (offset ? offset.dz : 0)) * CM
      ]}
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
  const prevSel = useRef(null);

  useEffect(() => {
    const prev = prevSel.current;
    prevSel.current = selectedTreeId;
    // only tween home when an actual deselect happens (not on data refreshes)
    if (!selectedTreeId && !prev) return;
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
  anchors, treeCenters, chipRefs, controlsRef,
  mergedLocated, standaloneLocated, builtLocated, fruitOffsets,
  showLocatedTip, hideLocatedTip, flightTargets, simRef, progressRef
}) {
  return (
    <>
      <color attach="background" args={['#F2EADA']} />
      <fog attach="fog" args={['#F2EADA', 17, 36]} />
      <Lights />
      <GroundAndGrid />

      {trees.map((t) => {
        const lt = mergedLocated[t.treeId];
        return (
          <TreeMesh
            key={t.treeId}
            built={builtTrees[t.treeId]}
            position={[(lt ? lt.position.x : t.cx) * CM, 0, (lt ? lt.position.z : t.cz) * CM]}
            treeId={t.treeId}
            active={t.treeId === selectedTreeId || t.treeId === hoverTreeId}
            located={!!lt}
            onSelect={onSelect}
            onHover={setHoverTree}
          />
        );
      })}

      {standaloneLocated.map((lt) => (
        <LocatedTreeMesh
          key={'loc:' + lt.id}
          lt={lt}
          built={builtLocated[lt.id]}
          active={'loc:' + lt.id === selectedTreeId || 'loc:' + lt.id === hoverTreeId}
          onSelect={onSelect}
          onHover={setHoverTree}
          showTip={showLocatedTip}
          hideTip={hideLocatedTip}
        />
      ))}

      {detections.map((d) => (
        <Fruit
          key={d.id}
          det={d}
          offset={fruitOffsets[d.treeId]}
          selectedTreeId={selectedTreeId}
          filterKey={filterKey}
          onSelect={onSelect}
          showTooltip={showTooltip}
          hideTooltip={hideTooltip}
        />
      ))}

      <DroneFlight targets={flightTargets} simRef={simRef} progressRef={progressRef} />

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

function LocatedRows({ lt }) {
  return (
    <ul className="lp-rows">
      <li className="lp-row"><span>label</span><b>{lt.label}</b></li>
      <li className="lp-row"><span>confidence</span><b>{Math.round(lt.confidence * 100)}%</b></li>
      {Number.isFinite(lt.distanceCm) && (
        <li className="lp-row"><span>distance</span><b>{Math.round(lt.distanceCm)} cm</b></li>
      )}
      {lt.image && <li className="lp-row"><span>source</span><b>{lt.image}</b></li>}
    </ul>
  );
}

/* journal page for a standalone located tree/bush (no fruit cluster yet) */
function LocatedPanel({ lt, onClose }) {
  if (!lt) return null;
  return (
    <aside className="panel">
      <button className="panel-close" onClick={onClose}>← back to orchard</button>
      <div className="panel-head">
        <div className="ph-id">{lt.label}</div>
        <div className="ph-meta">located by drone survey</div>
      </div>
      <div className="panel-sec">
        <div className="sec-cap">Locator reading</div>
        <LocatedRows lt={lt} />
      </div>
      <div className="panel-sec">
        <div className="sec-cap">Field notes</div>
        <p className="note-clean">No fruit detections matched to this specimen yet.</p>
      </div>
      <div className="panel-coords">
        ~ {Math.round(lt.position.x)}, {Math.round(lt.position.z)} cm from mission pad
      </div>
    </aside>
  );
}

function DetailPanel({ tree, located, onClose }) {
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
      {located && (
        <div className="panel-sec">
          <div className="sec-cap">Matched located tree</div>
          <LocatedRows lt={located} />
        </div>
      )}
      <div className="panel-coords">
        ~ {Math.round(located ? located.position.x : tree.cx)}, {Math.round(located ? located.position.z : tree.cz)} cm from mission pad
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

/* GET /api/session/:id/trees — located trees from the tree-locator pass.
   The endpoint may 404 or not exist yet; any failure degrades to []
   so the map keeps working exactly as before. */
function useLocatedTrees(sessionId) {
  const [located, setLocated] = useState([]);

  useEffect(() => {
    if (!sessionId) { setLocated([]); return; }
    let cancelled = false;
    fetch(`${API_BASE_URL}/session/${sessionId}/trees`)
      .then((res) => { if (!res.ok) throw new Error('trees endpoint unavailable'); return res.json(); })
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data && data.trees) ? data.trees : [];
        setLocated(list.filter((t) =>
          t && t.id != null && t.position &&
          Number.isFinite(t.position.x) && Number.isFinite(t.position.z)
        ));
      })
      .catch(() => { if (!cancelled) setLocated([]); });
    return () => { cancelled = true; };
  }, [sessionId]);

  return located;
}

/* =====================================================================
   Root component
   ===================================================================== */
function OrchardMap({ sessionId }) {
  const { detections, loading, error, capturedAt } = useDetections(sessionId);
  const locatedTrees = useLocatedTrees(sessionId);

  const [selectedTreeId, setSelectedTreeId] = useState(null);
  const [filterKey, setFilterKey] = useState(null);
  const [hoverTreeId, setHoverTreeId] = useState(null);

  const containerRef = useRef(null);
  const tooltipRef = useRef(null);
  const chipRefs = useRef({});
  const controlsRef = useRef(null);

  // flight-sim shared state (mutated by the HUD, read in useFrame)
  const simRef = useRef({ playing: true, speed: 1 });
  const progressRef = useRef(null);

  // ---- derived data (memoized) ----
  const byTree = useMemo(() => groupByTree(detections), [detections]);
  const trees = useMemo(() => Object.values(byTree), [byTree]);
  const totals = useMemo(() => computeTotals(detections), [detections]);

  // merge located trees with inferred clusters: a located tree within
  // ~80 cm (x/z) of a detection-derived center adopts that cluster.
  const locatedMerge = useMemo(() => {
    const merged = {};                 // inferred treeId -> located tree
    const standalone = [];
    const claimed = new Set();
    locatedTrees.forEach((lt) => {
      let best = null, bestD = Infinity;
      trees.forEach((t) => {
        if (claimed.has(t.treeId)) return;
        const d = Math.hypot(t.cx - lt.position.x, t.cz - lt.position.z);
        if (d < bestD) { bestD = d; best = t; }
      });
      if (best && bestD <= 80) { merged[best.treeId] = lt; claimed.add(best.treeId); }
      else standalone.push(lt);
    });
    return { merged, standalone };
  }, [locatedTrees, trees]);

  // when merged, fruits shift by the located-vs-inferred center delta (cm)
  // so they sit on/around the located tree.
  const fruitOffsets = useMemo(() => {
    const m = {};
    Object.keys(locatedMerge.merged).forEach((tid) => {
      const lt = locatedMerge.merged[tid];
      const g = byTree[tid];
      if (g) m[tid] = { dx: lt.position.x - g.cx, dz: lt.position.z - g.cz };
    });
    return m;
  }, [locatedMerge, byTree]);

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

  // standalone located trees get their own procedural builds, seeded by id
  const builtLocated = useMemo(() => {
    const m = {};
    locatedMerge.standalone.forEach((lt) => {
      const rand = seeded(hashStr(String(lt.id)));
      m[lt.id] = lt.label === 'bush'
        ? buildBush(rand, { barkColor: '#7c5a3c', leafColor: '#7d9b62' })
        : buildTree(rand, { barkColor: '#7c5a3c', leafColor: '#7d9b62' });
      m[lt.id].group.rotation.y = (hashStr(String(lt.id)) % 628) / 100;
    });
    return m;
  }, [locatedMerge.standalone]);

  // dispose old geometry/materials when the tree set changes or on unmount
  useEffect(() => {
    return () => {
      [...Object.values(builtTrees), ...Object.values(builtLocated)].forEach((b) => {
        b.group.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose());
        });
      });
    };
  }, [builtTrees, builtLocated]);

  // label anchors (crown top) + tree centers in scene metres
  const anchors = useMemo(() => {
    const a = trees.map((t) => {
      const lt = locatedMerge.merged[t.treeId];
      const x = (lt ? lt.position.x : t.cx) * CM;
      const z = (lt ? lt.position.z : t.cz) * CM;
      return {
        treeId: t.treeId,
        anchor: new THREE.Vector3(x, (builtTrees[t.treeId]?.crownTop || 2) + 0.28, z)
      };
    });
    locatedMerge.standalone.forEach((lt) => {
      a.push({
        treeId: 'loc:' + lt.id,
        anchor: new THREE.Vector3(
          lt.position.x * CM,
          (builtLocated[lt.id]?.crownTop || 1) + 0.28,
          lt.position.z * CM
        )
      });
    });
    return a;
  }, [trees, builtTrees, locatedMerge, builtLocated]);

  const treeCenters = useMemo(() => {
    const m = {};
    trees.forEach((t) => {
      const lt = locatedMerge.merged[t.treeId];
      m[t.treeId] = { cx: (lt ? lt.position.x : t.cx) * CM, cz: (lt ? lt.position.z : t.cz) * CM };
    });
    locatedMerge.standalone.forEach((lt) => {
      m['loc:' + lt.id] = { cx: lt.position.x * CM, cz: lt.position.z * CM };
    });
    return m;
  }, [trees, locatedMerge]);

  // drone scan-flight targets: every rendered tree center (scene metres)
  const flightTargets = useMemo(() => {
    const pts = trees.map((t) => {
      const lt = locatedMerge.merged[t.treeId];
      return { x: (lt ? lt.position.x : t.cx) * CM, z: (lt ? lt.position.z : t.cz) * CM };
    });
    locatedMerge.standalone.forEach((lt) => {
      pts.push({ x: lt.position.x * CM, z: lt.position.z * CM });
    });
    return pts;
  }, [trees, locatedMerge]);

  // ---- imperative tooltip (avoids re-rendering the scene on pointer move) ----
  const placeTooltip = useCallback((clientX, clientY) => {
    const el = tooltipRef.current, cont = containerRef.current;
    if (!el || !cont) return;
    const r = cont.getBoundingClientRect();
    el.style.display = 'block';
    const pad = 16;
    let x = clientX - r.left + pad, y = clientY - r.top + pad;
    const tw = el.offsetWidth, th = el.offsetHeight;
    if (x + tw > r.width) x = clientX - r.left - tw - pad;
    if (y + th > r.height) y = clientY - r.top - th - pad;
    el.style.left = Math.max(0, x) + 'px';
    el.style.top = Math.max(0, y) + 'px';
  }, []);

  const showTooltip = useCallback((det, key, clientX, clientY) => {
    const el = tooltipRef.current;
    if (!el) return;
    const rk = RIPENESS[key];
    el.innerHTML =
      `<div class="tt-head"><span class="tt-dot" style="background:${rk.color}"></span>` +
      `${det.fruitType} · <em>${rk.label}</em></div>` +
      `<div class="tt-row">confidence <b>${Math.round(det.confidence * 100)}%</b></div>` +
      `<div class="tt-row">tree <b>${det.treeId}</b></div>` +
      (det.isUncertain ? `<div class="tt-flag">flagged uncertain — needs review</div>` : ``);
    placeTooltip(clientX, clientY);
  }, [placeTooltip]);

  const showLocatedTip = useCallback((lt, clientX, clientY) => {
    const el = tooltipRef.current;
    if (!el) return;
    el.innerHTML =
      `<div class="tt-head"><span class="tt-dot" style="background:#C2702E"></span>` +
      `${lt.label} · <em>located</em></div>` +
      `<div class="tt-row">confidence <b>${Math.round(lt.confidence * 100)}%</b></div>` +
      (Number.isFinite(lt.distanceCm)
        ? `<div class="tt-row">distance <b>${Math.round(lt.distanceCm)} cm</b></div>` : '') +
      (lt.image ? `<div class="tt-row">source <b>${lt.image}</b></div>` : '');
    placeTooltip(clientX, clientY);
  }, [placeTooltip]);

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
  const selectedLocated = (selectedTreeId && selectedTreeId.indexOf('loc:') === 0)
    ? locatedMerge.standalone.find((lt) => 'loc:' + lt.id === selectedTreeId) || null
    : null;
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
              mergedLocated={locatedMerge.merged}
              standaloneLocated={locatedMerge.standalone}
              builtLocated={builtLocated}
              fruitOffsets={fruitOffsets}
              showLocatedTip={showLocatedTip}
              hideLocatedTip={hideTooltip}
              flightTargets={flightTargets}
              simRef={simRef}
              progressRef={progressRef}
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
            {locatedMerge.standalone.map((lt) => {
              const key = 'loc:' + lt.id;
              return (
                <button
                  key={key}
                  ref={(el) => { chipRefs.current[key] = el; }}
                  className="tree-chip"
                  onClick={(e) => { e.stopPropagation(); onSelect(key); }}
                  onPointerEnter={() => setHoverTree(key)}
                  onPointerLeave={() => setHoverTree(null)}
                >
                  <span className="tc-id">{lt.label}</span>
                  <span className="tc-detail">
                    <span className="tc-count">{Math.round(lt.confidence * 100)}%</span> located
                  </span>
                </button>
              );
            })}
          </div>

          {/* screen-fixed chrome */}
          <div className="ui">
            <SummaryBar
              totals={totals} sessionId={sessionId} capturedAt={capturedAt}
              treeCount={trees.length + locatedMerge.standalone.length}
            />
            <Legend filterKey={filterKey} setFilter={setFilter} totals={totals} />
            <FlightHUD simRef={simRef} progressRef={progressRef} />
            {selectedLocated
              ? <LocatedPanel lt={selectedLocated} onClose={onDeselect} />
              : <DetailPanel tree={selectedTree} located={selectedTreeId ? locatedMerge.merged[selectedTreeId] : null} onClose={onDeselect} />}
            <div className="hint">drag to look · scroll to zoom · click a tree to inspect</div>
          </div>

          <div className="tooltip" ref={tooltipRef} />
        </>
      )}
    </div>
  );
}

export default OrchardMap;
