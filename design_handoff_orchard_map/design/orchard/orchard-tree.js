/* =====================================================================
   orchard-tree.js  (ES module)
   Procedural apple tree built from established botanical models, so the
   geometry is grounded in real allometry rather than a trunk + sphere.

   Equations applied
   -----------------
   1. Da Vinci / Murray "pipe model":  the cross-sectional area of a parent
      branch equals the sum of its children's areas.  Generalised:
          r_parent^Δ = Σ r_child^Δ      → r_child = r_parent · n^(-1/Δ)
      Δ (the "Leonardo exponent") ≈ 2.0 for da Vinci, ~2.3–2.5 measured in
      real broadleaf trees.  We use Δ = 2.3.
   2. Phyllotaxis: successive branches are placed at the golden angle
          φ = 360° · (1 − 1/Φ) ≈ 137.5°
      around the parent axis — the same divergence seen in real shoots.
   3. Length allometry:  child length = parent length · k_L  (k_L ≈ 0.76),
      a self-similar (fractal) taper that yields finite total height.
   4. Tropisms:  young upper branches bend toward light (negative
      gravitropism → upward bias); lower fruit-bearing limbs bend down
      under load (positive gravitropism).  Modelled as a per-segment lerp
      of the growth direction toward ±Y.
   ===================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PHI = (1 + Math.sqrt(5)) / 2;
const GOLDEN_ANGLE = Math.PI * 2 * (1 - 1 / PHI);   // ≈ 137.5°
const DELTA = 2.3;                                  // pipe-model exponent

// ---- realistic apple: lathe a half-silhouette (calyx dimple + stem cavity)
const APPLE_PROFILE = [
  [0.00, 0.00], [0.07, 0.015], [0.11, 0.05], [0.075, 0.085],
  [0.17, 0.13], [0.31, 0.23], [0.43, 0.37], [0.485, 0.50],
  [0.47, 0.63], [0.40, 0.75], [0.28, 0.85], [0.14, 0.92],
  [0.055, 0.95], [0.10, 0.965], [0.045, 0.99], [0.0, 1.0]
].map(([x, y]) => new THREE.Vector2(x * 0.95, y));

const _appleGeom = new THREE.LatheGeometry(APPLE_PROFILE, 18);
_appleGeom.translate(0, -0.5, 0);          // centre vertically
_appleGeom.computeVertexNormals();

export function appleGeometry() { return _appleGeom; }

const _stemGeom = new THREE.CylinderGeometry(0.016, 0.024, 0.24, 5);
_stemGeom.translate(0, 0.5 + 0.12, 0);     // base seated in the apple's stem cavity
export function stemGeometry() { return _stemGeom; }

// ---------------------------------------------------------------------
// Build one tree.  Returns { group, pickMeshes, foliageMats, crownTop }.
//   rand  : seeded() RNG in [0,1)
//   opts  : { barkColor, leafColor }
// ---------------------------------------------------------------------
export function buildTree(rand, opts) {
  opts = opts || {};
  const barkColor = opts.barkColor || '#7c5a3c';
  const leafColor = new THREE.Color(opts.leafColor || '#7d9b62');

  const group = new THREE.Group();
  const branchGeoms = [];
  const foliageGeoms = [];
  let crownTop = 0;

  // per-tree character
  const heightScale = 0.92 + rand() * 0.22;          // ~0.92–1.14
  const r0 = 0.052 * (0.9 + rand() * 0.25);          // trunk radius (m)
  const L0 = 1.05 * heightScale;                      // clear-trunk length
  const MAX_DEPTH = 4;
  const MIN_R = 0.009;

  const up = new THREE.Vector3(0, 1, 0);
  const _q = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _scale = new THREE.Vector3(1, 1, 1);

  function addBranch(start, dir, len, rStart, rEnd) {
    // a tapered cylinder from `start` along `dir`
    const geom = new THREE.CylinderGeometry(rEnd, rStart, len, 6, 1);
    const mid = start.clone().addScaledVector(dir, len / 2);
    _q.setFromUnitVectors(up, dir.clone().normalize());
    _m.compose(mid, _q, _scale);
    geom.applyMatrix4(_m);
    branchGeoms.push(geom);
  }

  function addFoliage(center, radius) {
    const g = new THREE.IcosahedronGeometry(radius, 1);
    // squash slightly + jitter for an organic clump
    g.scale(1, 0.82 + rand() * 0.2, 1);
    g.translate(center.x, center.y, center.z);
    foliageGeoms.push(g);
    crownTop = Math.max(crownTop, center.y + radius);
  }

  // recursive growth ---------------------------------------------------
  function grow(start, dir, len, radius, depth) {
    // curve the limb over 2 segments to suggest tropism, then place tip
    const segs = depth === 0 ? 3 : 2;
    let p = start.clone();
    let d = dir.clone().normalize();
    let r = radius;
    for (let s = 0; s < segs; s++) {
      const segLen = len / segs;
      const rTo = radius * (1 - (s + 1) / segs * 0.45);
      // tropism: upper branches reach up, lower/outer limbs sag
      const bias = depth <= 1 ? 0.10 : -0.06 - depth * 0.02;
      d.lerp(new THREE.Vector3(0, bias > 0 ? 1 : -1, 0), Math.abs(bias)).normalize();
      const end = p.clone().addScaledVector(d, segLen);
      addBranch(p, d, segLen, r, rTo);
      p = end; r = rTo;
    }
    crownTop = Math.max(crownTop, p.y);

    if (depth >= MAX_DEPTH || radius < MIN_R) {
      // terminal: a single airy clump of foliage
      addFoliage(p, 0.16 + rand() * 0.14);
      return;
    }

    // number of children rises lower in the canopy, then settles
    const n = depth === 0 ? 3 : (depth === 1 ? 3 : 2);
    const childR = radius * Math.pow(n, -1 / DELTA);     // pipe model
    const childLen = len * (0.74 + rand() * 0.06);       // length allometry
    // open branch angle, wider deeper in the crown
    const baseAngle = (depth === 0 ? 32 : 42 + depth * 6) * Math.PI / 180;

    for (let i = 0; i < n; i++) {
      const azim = GOLDEN_ANGLE * i + rand() * 0.5;       // phyllotaxis
      const angle = baseAngle * (0.8 + rand() * 0.4);
      // build child direction: tilt parent dir by `angle`, spun to `azim`
      const ortho = new THREE.Vector3(1, 0, 0)
        .applyAxisAngle(up, azim);
      // make ortho perpendicular to current growth dir
      ortho.sub(d.clone().multiplyScalar(ortho.dot(d))).normalize();
      const childDir = d.clone().applyAxisAngle(ortho, angle).normalize();
      grow(p, childDir, childLen, childR, depth + 1);
    }
    // central leader continues a little for a rounded apple crown
    if (depth <= 1) {
      grow(p, d.clone().lerp(up, 0.4).normalize(), childLen * 0.85, childR * 0.9, depth + 1);
    }
  }

  grow(new THREE.Vector3(0, 0, 0), up.clone(), L0, r0, 0);

  // ---- merge + materialise ------------------------------------------
  const barkMat = new THREE.MeshStandardMaterial({ color: barkColor, roughness: 0.95, metalness: 0 });
  const branchMesh = new THREE.Mesh(mergeGeometries(branchGeoms, false), barkMat);
  branchMesh.castShadow = true; branchMesh.receiveShadow = true;
  group.add(branchMesh);

  // foliage: airy translucent wash so the fruit stays readable through it
  const leafMat = new THREE.MeshStandardMaterial({
    color: leafColor, roughness: 0.85, metalness: 0, flatShading: true,
    transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide
  });
  const foliageMesh = new THREE.Mesh(mergeGeometries(foliageGeoms, false), leafMat);
  foliageMesh.castShadow = true;
  group.add(foliageMesh);

  branchGeoms.forEach((g) => g.dispose());
  foliageGeoms.forEach((g) => g.dispose());

  return { group, pickMeshes: [branchMesh, foliageMesh], foliageMats: [leafMat], crownTop };
}
