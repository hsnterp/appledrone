# Handoff: Orchard Map (3D orchard fruit-detection visualization)

> Replaces the existing single-tree `fruit-dashboard/src/OrchardMap.js` with a
> full multi-tree orchard map. This bundle is a **design reference**, not drop-in
> production code — see "About the design files" below.

---

## Overview

A 3D orchard visualization for the Pomona / AppleDrone field tool. It plots every
apple a Tello EDU drone detected, grouped into its source tree, in the trees'
real relative positions. Users walk the orchard aisle at drone height, see each
tree's fruit load and ripeness at a glance, click a tree to focus it and read a
detailed breakdown, and highlight a ripeness stage across the whole orchard.

It supersedes the current `OrchardMap.js`, which shows a **single** tree with
fruits in a Fibonacci sphere. The new design is multi-tree, spatially accurate,
and styled as a naturalist's field sketchbook (light UI, desktop-first, usable on
a tablet in the field).

---

## About the design files

The files in `design/` are a **working HTML/JS prototype** built to demonstrate
the intended look, layout, data flow, and interactions. They are a **reference**,
not code to paste into the app.

- The prototype is **vanilla Three.js + a thin React UI layer + an event bus**,
  loaded via Babel-in-the-browser and an import map.
- **Your codebase already uses React + `@react-three/fiber` (R3F) + `three`**
  (the current `OrchardMap.js` uses `<Canvas>`, `OrbitControls`, etc.).
- **The task is to re-create this design as idiomatic R3F components** inside
  `fruit-dashboard/`, using the app's existing patterns (Tailwind classes, the
  Cinzel/"trajan-header" type treatment, Lucide icons, the blue `#2563eb`
  accent where appropriate) — NOT to ship the raw prototype.

The prototype's **scene-building math is the valuable part** and should be ported
almost verbatim (it's plain `three`, which R3F wraps): the procedural tree
geometry, the apple lathe geometry, the cm→scene unit conversion, the fruit
placement, the camera framing, and the raycast/highlight logic all translate
directly. The DOM/CSS chrome should be rebuilt with your app's component system.

---

## Fidelity

**High-fidelity.** Final colors, typography, spacing, geometry, and interactions
are all specified below and present in the prototype. Recreate the UI faithfully,
but swap the prototype's hand-rolled CSS for the app's existing styling system.

One deliberate aesthetic choice to confirm with the team: the prototype uses a
**"field sketchbook" theme** (warm paper `#EAE0CC`, ink linework, botanical-plate
ripeness colors, serif + handwritten + mono type) rather than the current
dashboard's white-card look. If you'd rather keep it visually consistent with the
existing `Dashboard.js`, keep the **layout and interactions** below and restyle
the surfaces with your normal white `rounded-xl` cards — the structure is
independent of the theme.

---

## Data contract (this is the integration seam)

The design is built entirely around your real API response. **No shape changes
are needed to wire up live data.**

```
GET /api/session/:id/detections
->
{
  detections: [
    {
      id:          string,        // detection id
      fruitType:   string,        // e.g. "apple"
      ripeness:    "ripe" | "unripe" | "overripe",
      confidence:  number,        // 0..1
      isUncertain: boolean,       // true => treated as "uncertain" for color
      treeId:      string,        // grouping key
      position: { x: number, y: number, z: number }  // CENTIMETRES, relative to mission pad
    },
    ...
  ]
}
```

Key facts the design relies on:

- **Positions are in centimetres**, relative to the drone's mission pad at world
  origin `(0,0,0)`. The scene converts with `CM = 0.01` (cm → metres). `x`/`z` is
  the ground plane; `y` is height.
- **Trees are derived by grouping `detections` on `treeId`.** The prototype also
  carries a `trees` array (id + x/z center) for label/canopy placement — in
  production, **derive each tree's center from the mean of its detections'
  x/z** (or from a trees endpoint if you add one). Do not rely on the mock
  `trees` array; it only exists to seed the prototype layout.
- **Ripeness → color** mapping, and the `isUncertain` override, are defined in
  `orchard-data.js` (`RIPENESS`, `ripeKey()`), reproduced under "Design tokens".
- `orchard-data.js` contains a **seeded mock generator** (`generateMockSession`)
  that emits exactly this shape. **Delete it on integration** and feed the
  fetched `detections` array into the same downstream helpers
  (`groupByTree`, `totals`).

### Recommended integration shape (R3F)

```jsx
// OrchardMap.js (new)
const { data } = useDetections(sessionId);   // GET /api/session/:id/detections
const detections = data?.detections ?? [];
const byTree     = useMemo(() => groupByTree(detections), [detections]); // port from orchard-data.js
const totals     = useMemo(() => computeTotals(detections), [detections]);
// <Canvas> … <Ground/> {trees.map(t => <Tree…/>)} {detections.map(d => <Fruit…/>)}
```

Port `groupByTree()` and `totals()` straight from `design/orchard/orchard-data.js`
(adjust `groupByTree` to derive tree centers from detection means).

---

## Screens / views

There is one screen with three states: **orchard overview**, **tree focused**,
and **ripeness highlighted** (the last composes with either of the first two).

### 1. Orchard overview (default)

- **Purpose:** see the whole block — where trees are, how loaded each is, the
  dominant ripeness per tree, and the orchard-wide total.
- **Layout:** full-viewport 3D canvas. Fixed overlays on top:
  - **Top summary bar** (top: 18px, left/right: 18px).
  - **Bottom-left ripeness legend / filter** (left: 18px, bottom: 18px).
  - **Floating tree-ID label chips**, projected from each tree's crown into
    screen space every frame.
  - **Centered bottom hint** ("drag to look · scroll to zoom · click a tree to
    inspect").
- **Camera:** drone-height eye level looking down the central aisle.
  Perspective FOV 50, near 0.1, far 200. Initial position `(0, 2.45, -5.8)`,
  `controls.target = (0, 1.35, 7)`. OrbitControls with damping (factor 0.08),
  `minDistance 1.6`, `maxDistance 26`, `maxPolarAngle 1.46` (stay above ground),
  `minPolarAngle 0.18`.

### 2. Tree focused (on tree click)

- **Trigger:** click any tree's branches/foliage, any of its fruit, or its label
  chip.
- **Behavior:** camera tweens (~850ms, cubic ease-out) to stand in the aisle
  beside that tree and look at it; a **right-side detail panel** appears (340px
  wide, full height) with that tree's breakdown. Fruits on **other** trees dim to
  ~12% opacity so the focused tree reads clearly. Clicking empty space (or the
  panel's "← back to orchard") deselects, restoring the overview camera.
- **Focus camera math:** for a tree at center `(cx, cz)` metres, stand off toward
  the aisle: `aisleDir = cx < 0 ? +1 : -1`, camera =
  `(cx + aisleDir*2.5, 1.95, cz - 0.7)`, target = `(cx, 1.7, cz)`.

### 3. Ripeness highlighted (legend chip click)

- **Trigger:** click a ripeness chip in the bottom-left legend.
- **Behavior (highlight, never hide):** matching fruits stay vivid and bump up
  slightly (scale ×1.18, higher emissive); non-matching fruits dim to ~12%
  opacity. Click the active chip again to clear. Composes with tree focus.

---

## Components

### Top summary bar
- Container: paper card `#F5EEDD`, 1.5px solid ink border `#2E2A22`, 3px radius,
  offset hard shadow `3px 3px 0 rgba(46,42,34,.16)`, padding `12px 20px`,
  flex row, 26px gap.
- **Left — brand:** "✻" mark in ripe-green `#5F8A4C` (26px); "Pomona" (Newsreader
  600, 24px) over "Orchard Field Survey" (Caveat, 18px, `#6B6354`).
- **Center — total (the one headline metric, per product decision):** big number
  (Newsreader 600, 40px) + "apples mapped" (Caveat, 17px). Value = total
  detection count.
- **Right — meta** (JetBrains Mono, 11px, `#6B6354`): session id, capture
  timestamp, tree count. Right-aligned rows; truncate long session ids.

> Per the product decision, the summary bar is intentionally minimal — **total
> count only**, not per-ripeness counts. Per-ripeness counts live in the legend.

### Ripeness legend / filter (bottom-left)
- Same paper-card treatment, width 210px.
- Caption: "Ripeness key — *tap to highlight*" (uppercase label + Caveat accent).
- Four rows (ripe, unripe, overripe, uncertain), each: 13px color dot (1.5px
  ink ring) + label (Newsreader 16px) + count (JetBrains Mono 13px).
- States: hover = faint ink wash; active = ink border + wash; when any chip is
  active, the others dim to 42% opacity.

### Tree-ID label chips (floating, projected)
- Anchored above each tree's crown (`crownTop + 0.28m`), projected to screen each
  frame; CSS `transform: translate(-50%,-100%)` so the chip sits above a 14px
  ink "leader" line down to the tree.
- Default shows **tree ID only** (JetBrains Mono 12px, 600) — per the product
  decision ("minimal — ID only, details on hover").
- On hover/selected, the chip expands to show `<count> apples` + a dominant-
  ripeness dot+label. Selected chip inverts (ink background, paper text).
- **Declutter:** chips are sorted nearest-first; a chip is hidden if it would
  collide (within 58px × 30px) with an already-placed nearer chip, or if its
  tree is > 24m away, or behind the camera. Hovered/selected chips are exempt.

### Tree detail panel (right side, on focus)
- 340px wide, full height, paper card with a **ruled-paper background**
  (repeating 32px sepia rule lines starting below the header) — the "journal
  page" motif.
- "← back to orchard" link (JetBrains Mono 12px).
- **Header:** big tree ID (Newsreader 600, 44px) + "Row {A/B} · specimen"
  (Caveat 19px).
- **Figure block:** huge fruit count (Newsreader 600, 58px) + "apples detected"
  (Caveat) + "mostly **{dominant}**" with the dominant color dot.
- **Ripeness breakdown:** three ruled bars (ripe / unripe / overripe). Each: name
  + dot, count (mono), and a track filled to `value / max * 100%` in the ripeness
  color. `max` = the largest of the three counts.
- **Field notes:** if the tree has uncertain detections, a list — "{n} flagged
  for review" then per-item `apple · possible {ripeness}` + confidence %. If none,
  "No uncertain detections — all reads above threshold." (Caveat).
- **Footer:** "~ {x}, {z} cm from mission pad" (mono 11px).

### Fruit hover tooltip
- Follows the cursor (flips to stay on-screen). Paper card.
- Head: color dot + "apple · *{Ripeness}*". Rows: confidence %, tree id. If
  uncertain, a dashed-top "flagged uncertain — needs review" line in
  `#C2702E` (Caveat).
- On hover the fruit scales ×1.7 and brightens (emissiveIntensity 0.55).

---

## The 3D scene (port this math directly)

All of the following is plain `three` and maps 1:1 onto R3F primitives
(`<mesh>`, `<cylinderGeometry>`, `<latheGeometry>`, `useFrame`, `useThree`, drei
`<OrbitControls>`). Files: `design/orchard/orchard-scene.js` and
`design/orchard/orchard-tree.js`.

### World setup
- `CM = 0.01` — multiply every API position by this (cm → metres).
- Scene background + fog = paper `#F2EADA` (fog near 17, far 36) for aerial haze.
- **Ground:** 80×80 plane, `MeshToonMaterial` paper `#EAE0CC`, at `y=0`,
  centered at `z=7`, receives shadow.
- **Measurement grid:** a fine `GridHelper(80, 80)` (1m cells, opacity .32) plus a
  bolder `GridHelper(80, 16)` (5m cells, opacity .22), both sepia.
- **Mission-pad marker at origin:** ink ring (`RingGeometry 0.16–0.26`) + center
  dot — marks `(0,0)`, the drone's reference.
- **Lighting:** `HemisphereLight('#fbf6e9','#cdbf9e',0.95)` + a warm
  `DirectionalLight('#fff7e6',1.05)` at `(6,12,4)` casting soft shadows
  (2048² map, PCFSoft).
- **Tree layout (prototype):** two rows flanking a central aisle, left row at
  `x = -220cm`, right at `x = +220cm`, five trees per row at
  `z ≈ 60..1500cm`, with slight per-tree jitter. **In production, place each tree
  at the mean x/z of its detections instead.**

### Procedural apple tree — `orchard-tree.js` (the realism work)

Built from real botanical/allometric models so trees look like trees, scaled so
a mature tree stands a bit taller than a person:

1. **Da Vinci / Murray pipe model** — a parent branch's cross-sectional area
   equals the sum of its children's: `r_child = r_parent · n^(-1/Δ)`, with the
   Leonardo exponent `Δ = 2.3` (measured range for broadleaf trees).
2. **Phyllotaxis** — successive child branches are spun around the parent by the
   golden angle `≈ 137.5°`.
3. **Length allometry** — `child_length = parent_length · ~0.76` (self-similar
   fractal taper → finite height).
4. **Tropisms** — upper branches bend up toward light (negative gravitropism);
   lower/outer limbs sag under load (positive gravitropism). Per-segment lerp of
   growth direction toward ±Y.

Recursion: `MAX_DEPTH = 4`, stop also when radius `< 0.009m`. Trunk radius
`r0 ≈ 0.052m`, clear-trunk length `L0 ≈ 1.05m × heightScale (0.92–1.14)`.
Branches are tapered cylinders; terminals get an airy `IcosahedronGeometry`
foliage clump. All branch geoms are **merged** into one mesh (and foliage into
another) via `BufferGeometryUtils.mergeGeometries` for performance — important
when porting: build geometry per tree once (e.g. in a `useMemo`), don't emit
hundreds of React meshes per tree.

- **Bark:** `MeshStandardMaterial` `#7c5a3c`, roughness .95.
- **Foliage:** `MeshStandardMaterial` `#7d9b62`, **translucent (opacity ~0.3,
  depthWrite:false, flatShading, DoubleSide)** so fruit stays readable through
  the canopy. Raise to ~0.46 opacity when the tree is hovered/selected.
- `buildTree(rand, {barkColor, leafColor})` returns
  `{ group, pickMeshes, foliageMats, crownTop }`. Seed each tree with a stable
  per-tree RNG so reloads are deterministic. `crownTop` is the label anchor.

### Realistic apple geometry
- A **`LatheGeometry`** revolved from a hand-tuned half-silhouette profile
  (`APPLE_PROFILE`) — gives the calyx dimple (bottom) and stem cavity (top), not
  a plain sphere. 18 radial segments.
- A short tapered-cylinder **stem** (`#6b4f33`) seated in the stem cavity, added
  as a child of each apple mesh with slight random tilt.
- **Per-apple material:** `MeshStandardMaterial` in the ripeness color, roughness
  .4, with a gentle `emissiveIntensity 0.12` so fruit pops through foliage.
  Multiply base color by `0.93–1.05` per apple for natural, non-uniform color.
- **Scale = realism × confidence:** base `0.082 × (0.85 + confidence·0.5)`
  → roughly a 7.5cm apple at full confidence; lower-confidence reads render a
  touch smaller. Random per-apple rotation for variety.

### Picking & highlight
- One `Raycaster`. Fruit meshes are one pick set; tree branch+foliage meshes are
  another. `pointermove` updates hover (fruit tooltip vs. tree-chip highlight);
  `click` resolves to a `treeId` (from fruit's `det.treeId` or the tree mesh) and
  calls `focusTree`, or deselects on empty space.
- `applyFruitStyle(mesh)` is the single source of truth for a fruit's look given
  current `filterKey` + `selectedTree` + `hoverFruit` (opacity, scale, emissive).
  In R3F, drive these from state/props per `<Fruit>` instead of mutating
  materials imperatively.

---

## Interactions & behavior (summary)

| Action | Result |
|---|---|
| Drag | Orbit (damped) around current target |
| Scroll | Dolly between 1.6m and 26m |
| Hover fruit | Fruit scales ×1.7 + brightens; cursor tooltip appears |
| Hover tree (mesh or chip) | Chip expands to count + dominant ripeness; canopy firms up |
| Click tree / fruit / chip | Camera tweens to that tree (~850ms ease-out); detail panel opens; other trees' fruit dim |
| Click legend chip | Matching fruit emphasized, non-matching dim to ~12%; toggle off by re-click |
| Click empty space / "← back" | Deselect; camera returns to aisle overview |

- **Camera tween:** lerp camera position and controls target together over
  ~850ms with cubic ease-out `1-(1-t)³`.
- **Reduced motion / capture safety:** the detail panel must render in its final
  visible state when mounted (no enter-transition that can freeze paused) — the
  prototype mounts the panel only when open for exactly this reason.

---

## State management

Minimal. In the prototype, scene ↔ UI communicate over a `window.bus`
(`EventTarget`) — **replace with React state/context in the app.**

- `selectedTreeId: string | null` — drives the detail panel + camera focus + the
  "dim other trees" pass.
- `filterKey: "ripe" | "unripe" | "overripe" | "uncertain" | null` — drives the
  highlight pass.
- `hoverFruit` / `hoverTree` — transient hover state for tooltip/chip.
- Derived (memoized): `byTree` (group + per-tree breakdown + dominant),
  `totals` (overall counts + avg confidence). Both port from `orchard-data.js`.
- Data: `useDetections(sessionId)` → `GET /api/session/:id/detections`. Handle
  loading (splash) and empty (no detections) states.

---

## Design tokens

### Palette (sketchbook theme)
| Token | Hex | Use |
|---|---|---|
| paper | `#EAE0CC` | ground, base |
| paper-hi | `#F2EADA` | scene bg / fog |
| card | `#F5EEDD` | overlay surfaces |
| ink | `#2E2A22` | borders, primary text |
| ink-soft | `#6B6354` | secondary text |
| rule | `#D2C4A6` | dividers, ruled lines |
| grid | `#C8B894` | measurement grid |

### Ripeness colors (the functional palette — keep these exact)
| Ripeness | Hex | Notes |
|---|---|---|
| ripe | `#5F8A4C` | green |
| unripe | `#C9A227` | yellow |
| overripe | `#A8482F` | red |
| uncertain | `#C2702E` | orange — used when `isUncertain === true`, overriding `ripeness` |

`ripeKey(d) = d.isUncertain ? "uncertain" : d.ripeness` — color by this, but keep
the raw `ripeness` for the "possible {ripeness}" copy in field notes.

### Typography
| Role | Font | Notes |
|---|---|---|
| Display / serif | Newsreader (400/500/600 + italic) | headlines, numbers, labels |
| Marginalia | Caveat (500/600) | captions, hints, "field note" voice |
| Data / mono | JetBrains Mono (400/500/600) | ids, counts, coordinates, timestamps |

> These fonts realize the sketchbook theme. If the team keeps the existing
> dashboard look instead, substitute your current type system but preserve the
> three-tier hierarchy (display / annotation / data).

### Shape & shadow
- Card radius 3px; border 1.5px solid ink; signature offset shadow
  `3px 3px 0 rgba(46,42,34,.16)`.
- Bar fills, dots, and tracks use the ripeness colors above.

---

## Assets
No external image assets. Trees and apples are **procedurally generated geometry**
(see `orchard-tree.js`). Fonts load from Google Fonts (Newsreader, Caveat,
JetBrains Mono). `three` / R3F / drei are already in the codebase.

---

## Files in this bundle
```
design/
  Orchard Map.html          — entry point; load order, import map, fonts, splash
  orchard/
    orchard-data.js         — API-shape mock + groupByTree() + totals() + RIPENESS tokens  (KEEP the helpers, DELETE the mock generator on integration)
    orchard-tree.js         — procedural botany: pipe model, phyllotaxis, allometry, tropism; apple lathe geometry  (PORT ~verbatim)
    orchard-scene.js        — scene, lighting, ground/grid, fruit placement, raycast picking, camera tween, label projection  (PORT the math)
    orchard-ui.jsx          — React chrome: summary bar, legend/filter, detail panel, tooltip  (REBUILD with app components)
    orchard.css             — sketchbook styling + the three-tier type system  (REFERENCE for tokens)
```

Reference file to replace in the app: `fruit-dashboard/src/OrchardMap.js`.

## Suggested implementation order
1. Port `groupByTree` / `totals` and the `RIPENESS` tokens (pure JS, no 3D).
2. Port `orchard-tree.js` → a `useMemo`-built tree geometry; render one `<Tree>`.
3. Add the ground, grid, mission-pad, lighting, and camera/OrbitControls config.
4. Place trees at detection-mean x/z; place `<Fruit>` meshes from real detections.
5. Add raycast hover/click → `selectedTreeId`; build the detail panel in app UI.
6. Add the summary bar, the legend filter (`filterKey`), and tooltip.
7. Add the floating label chips + declutter, and the camera focus tween.
8. Wire `useDetections(sessionId)`; remove the mock generator.
```
