/* =====================================================================
   orchard-scene.js   (ES module — owns the 3D scene + world overlays)
   Reads window.ORCHARD, exposes window.orchardAPI, talks via window.bus.
   ===================================================================== */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildTree, appleGeometry, stemGeometry } from './orchard-tree.js';

// seeded RNG (mulberry32) so procedural trees are stable across reloads
function seeded(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const O = window.ORCHARD;
const P = O.PALETTE;
const bus = window.bus;
const CM = 0.01;                       // cm -> scene metres

const mount   = document.getElementById('scene');
const labels  = document.getElementById('labels');
const tooltip = document.getElementById('tooltip');

// ---------- renderer / scene / camera --------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(mount.clientWidth, mount.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
mount.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(P.paperHi);
scene.fog = new THREE.Fog(P.paperHi, 17, 36);

const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 200);
camera.position.set(0, 2.45, -5.8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 1.35, 7);
controls.minDistance = 1.6;
controls.maxDistance = 26;
controls.maxPolarAngle = 1.46;        // stay above ground
controls.minPolarAngle = 0.18;
controls.update();

// ---------- lighting (soft, illustrative) ----------------------------
scene.add(new THREE.HemisphereLight('#fbf6e9', '#cdbf9e', 0.95));
const sun = new THREE.DirectionalLight('#fff7e6', 1.05);
sun.position.set(6, 12, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 50;
sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -6;
sun.shadow.bias = -0.0004;
scene.add(sun);

// ---------- ground + measurement grid --------------------------------
const groundMat = new THREE.MeshToonMaterial({ color: P.paper });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, 0, 7);
ground.receiveShadow = true;
scene.add(ground);

// faint 1 m grid (sepia ink) — measurement reference
const grid = new THREE.GridHelper(80, 80, P.grid, P.grid);
grid.position.set(0, 0.002, 7);
grid.material.transparent = true;
grid.material.opacity = 0.32;
scene.add(grid);
// bolder 5 m grid on top
const grid5 = new THREE.GridHelper(80, 16, P.inkSoft, P.grid);
grid5.position.set(0, 0.004, 7);
grid5.material.transparent = true;
grid5.material.opacity = 0.22;
scene.add(grid5);

// mission-pad marker at origin (0,0)
const pad = new THREE.Mesh(
  new THREE.RingGeometry(0.16, 0.26, 24),
  new THREE.MeshBasicMaterial({ color: P.ink, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
);
pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.01, 0);
scene.add(pad);
const padDot = new THREE.Mesh(
  new THREE.CircleGeometry(0.08, 20),
  new THREE.MeshBasicMaterial({ color: P.ink })
);
padDot.rotation.x = -Math.PI / 2; padDot.position.set(0, 0.011, 0);
scene.add(padDot);

// ---------- helper: ink outline hull ---------------------------------
function outline(geom, scale, color) {
  const m = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: color || P.ink, side: THREE.BackSide }));
  m.scale.setScalar(scale);
  return m;
}

// ---------- shared geometries / materials ----------------------------
// ---------- shared apple geometry + materials ------------------------
const APPLE_BASE = 0.082;               // → ~7.5 cm apple at confidence ~1
const stemMat = new THREE.MeshStandardMaterial({ color: '#6b4f33', roughness: 0.9 });
function appleMat(key) {
  const base = new THREE.Color(O.RIPENESS[key].color);
  return new THREE.MeshStandardMaterial({
    color: base, roughness: 0.4, metalness: 0.0,
    emissive: base.clone(), emissiveIntensity: 0.12   // gentle pop so fruit reads through foliage
  });
}

// ---------- build trees + fruits -------------------------------------
const treeGroups = {};     // treeId -> { group, foliageMats, anchor(Vector3) }
const fruitMeshes = [];    // pickable
const treePickMeshes = []; // branches + foliage for picking a tree

O.trees.forEach((t, ti) => {
  const built = buildTree(seeded(1000 + ti * 7), { barkColor: '#7c5a3c', leafColor: '#7d9b62' });
  const g = built.group;
  g.position.set(t.x * CM, 0, t.z * CM);
  g.rotation.y = ti * 1.3;            // vary orientation
  g.userData = { treeId: t.treeId, kind: 'tree' };
  built.pickMeshes.forEach((m) => { m.userData = { treeId: t.treeId, kind: 'tree' }; treePickMeshes.push(m); });
  scene.add(g);
  treeGroups[t.treeId] = {
    group: g, foliageMats: built.foliageMats,
    anchor: new THREE.Vector3(t.x * CM, built.crownTop + 0.28, t.z * CM)
  };
});

O.detections.forEach((d) => {
  const key = O.ripeKey(d);
  // slight per-apple lightness variation for a natural, non-uniform look
  const mat = appleMat(key);
  const v = 0.93 + Math.random() * 0.12;
  mat.color.multiplyScalar(v);
  const m = new THREE.Mesh(appleGeometry(), mat);
  m.position.set(d.position.x * CM, d.position.y * CM, d.position.z * CM);
  const base = APPLE_BASE * (0.85 + d.confidence * 0.5);
  m.scale.setScalar(base);
  m.rotation.set((Math.random() - .5) * 0.6, Math.random() * 6.28, (Math.random() - .5) * 0.6);
  m.castShadow = true;
  m.userData = { det: d, key, kind: 'fruit', baseScale: base };
  const stem = new THREE.Mesh(stemGeometry(), stemMat);
  stem.rotation.z = (Math.random() - .5) * 0.5;
  m.add(stem);
  scene.add(m);
  fruitMeshes.push(m);
});

// ---------- tree label chips (DOM, projected each frame) -------------
const chips = {};
O.trees.forEach((t) => {
  const g = O.byTree[t.treeId];
  const el = document.createElement('button');
  el.className = 'tree-chip';
  el.dataset.tree = t.treeId;
  el.innerHTML =
    `<span class="tc-id">${t.treeId}</span>` +
    `<span class="tc-detail"><span class="tc-count">${g.total}</span> apples` +
    `<span class="tc-dom" style="--dot:${O.RIPENESS[g.dominant].color}">${O.RIPENESS[g.dominant].label}</span></span>`;
  el.addEventListener('click', (e) => { e.stopPropagation(); focusTree(t.treeId); });
  el.addEventListener('pointerenter', () => setTreeHover(t.treeId, true));
  el.addEventListener('pointerleave', () => setTreeHover(t.treeId, false));
  labels.appendChild(el);
  chips[t.treeId] = el;
});

// ---------- interaction state ----------------------------------------
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let hoverFruit = null, hoverTree = null, selectedTree = null, filterKey = null;

function setPtr(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

function applyFruitStyle(m) {
  const d = m.userData.det;
  const matchFilter = !filterKey || m.userData.key === filterKey;
  const sel = selectedTree;
  const inSel = !sel || d.treeId === sel;
  const dim = (filterKey && !matchFilter) || (sel && !inSel);
  m.material.opacity = dim ? 0.12 : 1;
  m.material.transparent = dim;
  const emph = (filterKey && matchFilter) || m === hoverFruit;
  m.scale.setScalar(m.userData.baseScale * (m === hoverFruit ? 1.7 : (emph ? 1.18 : 1)));
  if (m.material.emissive) m.material.emissiveIntensity = m === hoverFruit ? 0.55 : (emph ? 0.3 : 0.12);
}
function refreshFruits() { fruitMeshes.forEach(applyFruitStyle); }

function setTreeHover(id, on) {
  hoverTree = on ? id : (hoverTree === id ? null : hoverTree);
  Object.keys(chips).forEach((k) => {
    chips[k].classList.toggle('is-hover', k === hoverTree);
    chips[k].classList.toggle('is-selected', k === selectedTree);
  });
  Object.values(treeGroups).forEach((tg) => {
    const active = tg.group.userData.treeId === hoverTree || tg.group.userData.treeId === selectedTree;
    tg.foliageMats.forEach((m) => { m.opacity = active ? 0.46 : 0.3; });
  });
}

function showTooltip(m, e) {
  const d = m.userData.det;
  const rk = O.RIPENESS[m.userData.key];
  tooltip.innerHTML =
    `<div class="tt-head"><span class="tt-dot" style="background:${rk.color}"></span>` +
    `${d.fruitType} · <em>${rk.label}</em></div>` +
    `<div class="tt-row">confidence <b>${Math.round(d.confidence * 100)}%</b></div>` +
    `<div class="tt-row">tree <b>${d.treeId}</b></div>` +
    (d.isUncertain ? `<div class="tt-flag">flagged uncertain — needs review</div>` : ``);
  tooltip.style.display = 'block';
  const pad = 16;
  let x = e.clientX + pad, y = e.clientY + pad;
  const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
  if (x + tw > window.innerWidth) x = e.clientX - tw - pad;
  if (y + th > window.innerHeight) y = e.clientY - th - pad;
  tooltip.style.left = x + 'px'; tooltip.style.top = y + 'px';
}
function hideTooltip() { tooltip.style.display = 'none'; }

// ---------- pointer events -------------------------------------------
renderer.domElement.addEventListener('pointermove', (e) => {
  setPtr(e);
  ray.setFromCamera(ptr, camera);
  const hitF = ray.intersectObjects(fruitMeshes, false)[0];
  if (hitF) {
    if (hoverFruit !== hitF.object) { hoverFruit = hitF.object; refreshFruits(); }
    showTooltip(hoverFruit, e);
    setTreeHover(null, false);
    renderer.domElement.style.cursor = 'pointer';
    return;
  }
  if (hoverFruit) { hoverFruit = null; refreshFruits(); }
  hideTooltip();
  const hitT = ray.intersectObjects(treePickMeshes, false)[0];
  const id = hitT ? hitT.object.userData.treeId : null;
  if (id !== hoverTree) setTreeHover(id, !!id);
  renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
});

renderer.domElement.addEventListener('pointerdown', () => { dragMoved = false; });
let dragMoved = false;
renderer.domElement.addEventListener('pointermove', () => { dragMoved = true; }, true);
renderer.domElement.addEventListener('click', (e) => {
  setPtr(e);
  ray.setFromCamera(ptr, camera);
  const hitF = ray.intersectObjects(fruitMeshes, false)[0];
  const hitT = ray.intersectObjects(treePickMeshes, false)[0];
  const id = hitF ? hitF.object.userData.det.treeId : (hitT ? hitT.object.userData.treeId : null);
  if (id) focusTree(id);
  else deselect();
});

// ---------- camera tween ---------------------------------------------
let tween = null;
function tweenTo(camPos, target, ms) {
  tween = { fromC: camera.position.clone(), toC: camPos.clone(),
            fromT: controls.target.clone(), toT: target.clone(), t: 0, ms: ms || 850 };
}
const ease = (x) => 1 - Math.pow(1 - x, 3);

// ---------- public API ------------------------------------------------
function focusTree(id) {
  const t = O.trees.find((x) => x.treeId === id);
  if (!t) return;
  selectedTree = id;
  const cx = t.x * CM, cz = t.z * CM;
  const aisleDir = cx < 0 ? 1 : -1;             // toward aisle centre
  const camPos = new THREE.Vector3(cx + aisleDir * 2.5, 1.95, cz - 0.7);
  tweenTo(camPos, new THREE.Vector3(cx, 1.7, cz), 850);
  setTreeHover(null, false);
  refreshFruits();
  bus.dispatchEvent(new CustomEvent('orchard:select', { detail: { treeId: id } }));
}
function deselect() {
  if (!selectedTree) return;
  selectedTree = null;
  setTreeHover(null, false);
  refreshFruits();
  bus.dispatchEvent(new CustomEvent('orchard:deselect'));
}
function reset() {
  selectedTree = null; refreshFruits(); setTreeHover(null, false);
  tweenTo(new THREE.Vector3(0, 2.45, -5.8), new THREE.Vector3(0, 1.35, 7), 850);
  bus.dispatchEvent(new CustomEvent('orchard:deselect'));
}
function setFilter(key) { filterKey = key || null; refreshFruits(); }

window.orchardAPI = { focusTree, deselect, reset, setFilter };

// React asks to focus/reset/filter via the bus too
bus.addEventListener('ui:focusTree', (e) => focusTree(e.detail.treeId));
bus.addEventListener('ui:reset', reset);
bus.addEventListener('ui:filter', (e) => setFilter(e.detail.key));

// ---------- render loop ----------------------------------------------
const v = new THREE.Vector3(), camSpace = new THREE.Vector3();
function projectChips() {
  const w = mount.clientWidth, h = mount.clientHeight;
  // gather visible candidates with screen pos + world distance
  const items = [];
  Object.keys(treeGroups).forEach((id) => {
    const anchor = treeGroups[id].anchor;
    camSpace.copy(anchor).applyMatrix4(camera.matrixWorldInverse);
    const behind = camSpace.z > -0.4;                  // in front of camera only
    v.copy(anchor).project(camera);
    const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    const dist = camera.position.distanceTo(anchor);
    const chip = chips[id];
    if (behind || dist > 24 || x < -60 || x > w + 60 || y < -40 || y > h + 40) {
      chip.style.display = 'none'; return;
    }
    items.push({ id, chip, x, y, dist });
  });
  // nearest first; suppress chips that collide with a nearer, already-placed one
  items.sort((a, b) => a.dist - b.dist);
  const placed = [];
  const selOrHover = (id) => id === selectedTree || id === hoverTree;
  items.forEach((it) => {
    const clash = !selOrHover(it.id) && placed.some(
      (p) => Math.abs(p.x - it.x) < 58 && Math.abs(p.y - it.y) < 30
    );
    if (clash) { it.chip.style.display = 'none'; return; }
    it.chip.style.display = 'flex';
    it.chip.style.transform = `translate(-50%,-100%) translate(${it.x}px, ${it.y}px)`;
    it.chip.style.opacity = String(Math.max(0.45, 1 - Math.max(0, (it.dist - 6)) / 24));
    placed.push(it);
  });
}

let lastW = 0, lastH = 0;
function animate() {
  requestAnimationFrame(animate);
  // self-correct the canvas if layout wasn't ready at init (sizing race)
  const w = mount.clientWidth, h = mount.clientHeight;
  if (w && h && (Math.abs(lastW - w) > 0.5 || Math.abs(lastH - h) > 0.5)) onResize();
  if (tween) {
    tween.t = Math.min(1, tween.t + 16.7 / tween.ms);
    const k = ease(tween.t);
    camera.position.lerpVectors(tween.fromC, tween.toC, k);
    controls.target.lerpVectors(tween.fromT, tween.toT, k);
    if (tween.t >= 1) tween = null;
  }
  controls.update();
  projectChips();
  renderer.render(scene, camera);
}
animate();

// ---------- resize ----------------------------------------------------
function onResize() {
  const w = mount.clientWidth, h = mount.clientHeight;
  if (!w || !h) return;
  lastW = w; lastH = h;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
new ResizeObserver(onResize).observe(mount);

// timer-driven sizing fallback — works even when rAF / ResizeObserver are
// suspended (background tab, initially-hidden iframe, throttled contexts),
// so the canvas always reaches container size without a user resize.
onResize();
(function pollSize() {
  let tries = 0;
  (function tick() {
    onResize();
    const ok = renderer.domElement.width > 0 && renderer.domElement.height > 0;
    if (!ok && tries++ < 40) setTimeout(tick, 150);
  })();
})();

refreshFruits();
bus.dispatchEvent(new CustomEvent('orchard:ready'));
window.orchardReady = true;
