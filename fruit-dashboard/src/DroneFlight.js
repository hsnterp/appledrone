import { useState, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/* =====================================================================
   DroneFlight.js — Tello EDU scan-flight simulation for the OrchardMap.

   Mirrors real mission-pad behavior (SDK 2.0): the pad defines the
   coordinate origin with +X forward; the drone flies `go x y z mid`
   waypoints at ~50-100 cm/s with a forward-facing 82.6° FOV camera.

   Exports:
     <MissionPad />               — pad mesh at the scene origin
     <DroneFlight targets simRef progressRef /> — drone + path + trail
     <FlightHUD simRef progressRef />           — play/pause/speed overlay
   ===================================================================== */

const CRUISE_H = 1.25;       // cruise altitude, scene metres (~125 cm)
const SPEED_MPS = 0.75;      // ~75 cm/s — middle of the Tello go-speed band
const HOVER_SEC = 1.5;       // photo pause at each tree
const REST_SEC = 2.2;        // pause on the pad before the loop replays
const STANDOFF = 1.6;        // photo standoff distance from tree center (m)
const DRONE_SCALE = 1.5;     // true Tello is ~10 cm; scaled slightly for legibility

// 82.6° diagonal FOV on the Tello's 4:3 sensor → half-angle tangents
const FRUSTUM_LEN = 1.35;
const TAN_H = Math.tan((82.6 * Math.PI / 180) / 2) * 0.8;  // horizontal
const TAN_V = Math.tan((82.6 * Math.PI / 180) / 2) * 0.6;  // vertical

/* ------------------------------------------------------------------ */
/* Mission pad: 21×21 cm plate with a rust arrow marking +X forward.   */
/* Ground plane sits at y=0 and grid helpers at y≈0.004, so the pad     */
/* top face lands just above them.                                      */
/* ------------------------------------------------------------------ */
export function MissionPad() {
  const arrowGeom = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0.082, 0);          // tip points along +X (pad "forward")
    s.lineTo(0.018, 0.04);
    s.lineTo(0.018, 0.018);
    s.lineTo(-0.066, 0.018);
    s.lineTo(-0.066, -0.018);
    s.lineTo(0.018, -0.018);
    s.lineTo(0.018, -0.04);
    s.closePath();
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2);     // lay flat: shape y → scene z
    return g;
  }, []);

  useEffect(() => () => arrowGeom.dispose(), [arrowGeom]);

  return (
    <group>
      <mesh position={[0, 0.006, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.21, 0.012, 0.21]} />
        <meshStandardMaterial color="#2E2A22" roughness={0.9} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.0125, 0]}>
        <planeGeometry args={[0.178, 0.178]} />
        <meshStandardMaterial color="#F5EEDD" roughness={0.85} />
      </mesh>
      <mesh geometry={arrowGeom} position={[0, 0.0133, 0]}>
        <meshBasicMaterial color="#A8482F" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Low-poly Tello built from primitives. Local +Z is forward (matches  */
/* yaw = atan2(dir.x, dir.z)). Props get refs so useFrame can spin them.*/
/* ------------------------------------------------------------------ */
const MOTOR_XZ = 0.062;

function TelloModel({ propsRef }) {
  return (
    <group scale={DRONE_SCALE}>
      {/* main body shell */}
      <mesh position={[0, 0.024, 0]} castShadow>
        <boxGeometry args={[0.092, 0.04, 0.098]} />
        <meshStandardMaterial color="#2E2A22" roughness={0.75} />
      </mesh>
      {/* top battery panel */}
      <mesh position={[0, 0.047, 0]} castShadow>
        <boxGeometry args={[0.078, 0.007, 0.084]} />
        <meshStandardMaterial color="#F5EEDD" roughness={0.85} />
      </mesh>
      {/* forward camera nub */}
      <mesh position={[0, 0.026, 0.0525]}>
        <boxGeometry args={[0.02, 0.016, 0.01]} />
        <meshStandardMaterial color="#6B6354" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.026, 0.0585]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.0045, 0.0045, 0.004, 10]} />
        <meshStandardMaterial color="#2E2A22" roughness={0.3} metalness={0.4} />
      </mesh>
      {/* four arms + motors + props */}
      {[0, 1, 2, 3].map((i) => {
        const sx = i % 2 === 0 ? 1 : -1;
        const sz = i < 2 ? 1 : -1;
        return (
          <group key={i}>
            <mesh
              position={[sx * 0.038, 0.02, sz * 0.04]}
              rotation-y={Math.atan2(sx, sz)}
              castShadow
            >
              <boxGeometry args={[0.014, 0.012, 0.06]} />
              <meshStandardMaterial color="#2E2A22" roughness={0.8} />
            </mesh>
            <mesh position={[sx * MOTOR_XZ, 0.028, sz * MOTOR_XZ]}>
              <cylinderGeometry args={[0.007, 0.008, 0.022, 8]} />
              <meshStandardMaterial color="#6B6354" roughness={0.7} />
            </mesh>
            <group
              position={[sx * MOTOR_XZ, 0.042, sz * MOTOR_XZ]}
              ref={(el) => { propsRef.current[i] = el; }}
            >
              {/* two blades + a faint motion disc */}
              <mesh>
                <boxGeometry args={[0.072, 0.0022, 0.009]} />
                <meshStandardMaterial color="#C9A227" roughness={0.6} />
              </mesh>
              <mesh rotation-y={Math.PI / 2}>
                <boxGeometry args={[0.072, 0.0022, 0.009]} />
                <meshStandardMaterial color="#C9A227" roughness={0.6} />
              </mesh>
              <mesh>
                <cylinderGeometry args={[0.038, 0.038, 0.0015, 16]} />
                <meshBasicMaterial color="#C8B894" transparent opacity={0.18} depthWrite={false} />
              </mesh>
            </group>
          </group>
        );
      })}
    </group>
  );
}

/* camera-frustum wireframe (apex at the lens, opening along +Z) */
function makeFrustum() {
  const hw = TAN_H * FRUSTUM_LEN, hh = TAN_V * FRUSTUM_LEN;
  const c = [
    [-hw, -hh, FRUSTUM_LEN], [hw, -hh, FRUSTUM_LEN],
    [hw, hh, FRUSTUM_LEN], [-hw, hh, FRUSTUM_LEN]
  ];
  const verts = [];
  c.forEach((p) => verts.push(0, 0, 0, p[0], p[1], p[2]));
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    verts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const mat = new THREE.LineBasicMaterial({
    color: '#C2702E', transparent: true, opacity: 0, depthWrite: false
  });
  const lines = new THREE.LineSegments(geom, mat);
  lines.visible = false;
  return lines;
}

/* ------------------------------------------------------------------ */
/* DroneFlight — builds the mission from tree targets and animates it. */
/*   targets:     [{x,z}] tree centers in scene metres                 */
/*   simRef:      ref({ playing, speed }) shared with FlightHUD        */
/*   progressRef: ref to the HUD progress-fill DOM node                */
/* ------------------------------------------------------------------ */
const TRAIL_N = 360;

export function DroneFlight({ targets, simRef, progressRef }) {
  const groupRef = useRef();
  const propsRef = useRef([]);

  /* mission plan: waypoints → CatmullRom curve → timed phase schedule */
  const flight = useMemo(() => {
    if (!targets.length) return null;

    // visit order: greedy nearest-neighbor from the pad (origin)
    const remaining = targets.slice();
    const ordered = [];
    let cx = 0, cz = 0;
    while (remaining.length) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const p = remaining[i];
        const d = (p.x - cx) * (p.x - cx) + (p.z - cz) * (p.z - cz);
        if (d < bd) { bd = d; bi = i; }
      }
      const next = remaining.splice(bi, 1)[0];
      ordered.push(next); cx = next.x; cz = next.z;
    }

    // waypoints: pad → climb → standoff per tree → return → land
    const pts = [new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(0, CRUISE_H, 0)];
    const captures = [];   // { index into pts, look target }
    ordered.forEach((t) => {
      const d = Math.hypot(t.x, t.z) || 1;
      const ux = t.x / d, uz = t.z / d;
      const sd = Math.max(d - STANDOFF, 0.45);   // hold short of the tree
      pts.push(new THREE.Vector3(ux * sd, CRUISE_H, uz * sd));
      captures.push({ index: pts.length - 1, look: new THREE.Vector3(t.x, CRUISE_H, t.z) });
    });
    pts.push(new THREE.Vector3(0, CRUISE_H, 0));
    pts.push(new THREE.Vector3(0, 0.03, 0));

    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    curve.arcLengthDivisions = 512;
    const total = curve.getLength();
    const lengths = curve.getLengths(512);
    const uAt = (i) => lengths[Math.round((i / (pts.length - 1)) * 512)] / total;

    // schedule: move legs timed by arc length / speed; hovers at captures
    const capByIndex = new Map(captures.map((c) => [c.index, c]));
    const phases = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const u0 = uAt(i), u1 = uAt(i + 1);
      phases.push({ type: 'move', u0, u1, dur: Math.max(0.5, ((u1 - u0) * total) / SPEED_MPS) });
      const cap = capByIndex.get(i + 1);
      if (cap) phases.push({ type: 'hover', u: u1, dur: HOVER_SEC, look: cap.look });
    }
    phases.push({ type: 'hover', u: 1, dur: REST_SEC, look: null });   // rest on pad
    const duration = phases.reduce((a, p) => a + p.dur, 0);

    // precomputed trail polyline, revealed by draw-range as the drone flies
    const trailPos = new Float32Array(TRAIL_N * 3);
    const tv = new THREE.Vector3();
    for (let i = 0; i < TRAIL_N; i++) {
      curve.getPointAt(i / (TRAIL_N - 1), tv);
      trailPos[i * 3] = tv.x; trailPos[i * 3 + 1] = tv.y; trailPos[i * 3 + 2] = tv.z;
    }

    return { curve, phases, duration, trailPos };
  }, [targets]);

  /* imperative three objects (trail line + frustum) */
  const objects = useMemo(() => {
    if (!flight) return null;
    const trailGeom = new THREE.BufferGeometry();
    trailGeom.setAttribute('position', new THREE.BufferAttribute(flight.trailPos, 3));
    trailGeom.setDrawRange(0, 0);
    const trail = new THREE.Line(
      trailGeom,
      new THREE.LineBasicMaterial({ color: '#6B6354', transparent: true, opacity: 0.4 })
    );
    const frustum = makeFrustum();
    return { trail, frustum };
  }, [flight]);

  useEffect(() => () => {
    if (!objects) return;
    objects.trail.geometry.dispose();
    objects.trail.material.dispose();
    objects.frustum.geometry.dispose();
    objects.frustum.material.dispose();
  }, [objects]);

  useEffect(() => {
    if (groupRef.current) groupRef.current.rotation.order = 'YXZ';   // yaw, then local pitch/roll
  }, [flight]);

  /* mutable per-frame state + scratch vectors (zero allocations in useFrame) */
  const st = useRef({ time: 0, yaw: 0, pitch: 0, roll: 0 }).current;
  const scratch = useMemo(() => ({
    pos: new THREE.Vector3(),
    tan: new THREE.Vector3(),
    p1: new THREE.Vector3(),
    p2: new THREE.Vector3()
  }), []);

  useFrame((rstate, delta) => {
    if (!flight || !objects || !groupRef.current) return;
    const sim = simRef.current;
    if (sim.playing) st.time += delta * sim.speed;
    if (st.time >= flight.duration) st.time -= flight.duration;   // loop
    const t = st.time;

    // locate current phase (schedule is small; linear scan is cheap)
    let acc = 0;
    let phase = flight.phases[flight.phases.length - 1];
    let pt = 1;
    for (let i = 0; i < flight.phases.length; i++) {
      const ph = flight.phases[i];
      if (t <= acc + ph.dur) { phase = ph; pt = (t - acc) / ph.dur; break; }
      acc += ph.dur;
    }

    // curve parameter + desired heading
    let u, targetYaw = null;
    if (phase.type === 'move') {
      const e = pt * pt * (3 - 2 * pt);                 // ease in/out per leg
      u = phase.u0 + (phase.u1 - phase.u0) * e;
      // finite-difference tangent (getTangentAt allocates; this does not)
      const uu = Math.min(u, 1);
      flight.curve.getPointAt(Math.max(0, uu - 0.002), scratch.p1);
      flight.curve.getPointAt(Math.min(1, uu + 0.002), scratch.p2);
      scratch.tan.subVectors(scratch.p2, scratch.p1);
      if (scratch.tan.x !== 0 || scratch.tan.z !== 0) {
        targetYaw = Math.atan2(scratch.tan.x, scratch.tan.z);
      }
    } else {
      u = phase.u;
    }
    flight.curve.getPointAt(Math.min(u, 1), scratch.pos);
    if (phase.type === 'hover' && phase.look) {
      targetYaw = Math.atan2(phase.look.x - scratch.pos.x, phase.look.z - scratch.pos.z);
    }

    // position + gentle hover bob (suppressed near the ground)
    const g = groupRef.current;
    g.position.copy(scratch.pos);
    g.position.y += Math.sin(rstate.clock.elapsedTime * 2.7) * 0.012 *
      Math.min(1, scratch.pos.y / 0.5);

    // smoothed yaw (shortest angle), banking from yaw error, pitch when moving
    if (targetYaw !== null) {
      let dy = targetYaw - st.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      st.yaw += dy * Math.min(1, delta * 5);
      st.roll += (THREE.MathUtils.clamp(-dy * 0.6, -0.3, 0.3) - st.roll) * Math.min(1, delta * 6);
    } else {
      st.roll += (0 - st.roll) * Math.min(1, delta * 6);
    }
    const speedEnv = phase.type === 'move' ? Math.sin(Math.PI * Math.min(pt, 1)) : 0;
    st.pitch += (speedEnv * 0.13 - st.pitch) * Math.min(1, delta * 5);
    g.rotation.set(st.pitch, st.yaw, st.roll);

    // spinning props (alternating direction)
    for (let i = 0; i < 4; i++) {
      const p = propsRef.current[i];
      if (p) p.rotation.y += delta * (i % 2 === 0 ? 38 : -38) * (sim.playing ? sim.speed : 0.15);
    }

    // photo capture: frustum flash while hovering at a tree
    let fo = 0;
    if (phase.type === 'hover' && phase.look) {
      fo = Math.sin(Math.PI * Math.min(1, pt / 0.85)) * 0.55;
    }
    objects.frustum.material.opacity = fo;
    objects.frustum.visible = fo > 0.02;

    // progressive trail reveal
    objects.trail.geometry.setDrawRange(0, Math.max(2, Math.floor(u * (TRAIL_N - 1)) + 1));

    // HUD progress bar (imperative — no React re-render per frame)
    const pr = progressRef.current;
    if (pr) pr.style.width = ((t / flight.duration) * 100).toFixed(1) + '%';
  });

  if (!flight || !objects) return null;

  return (
    <>
      <group ref={groupRef}>
        <TelloModel propsRef={propsRef} />
        <primitive object={objects.frustum} position={[0, 0.04, 0.09]} />
      </group>
      <primitive object={objects.trail} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* HUD overlay: play/pause, 1×/2×/4× speed, progress. Mutates simRef    */
/* so the animation loop never forces a scene re-render.               */
/* ------------------------------------------------------------------ */
export function FlightHUD({ simRef, progressRef }) {
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);

  const toggle = () => {
    const p = !playing;
    setPlaying(p);
    simRef.current.playing = p;
  };
  const pickSpeed = (s) => {
    setSpeed(s);
    simRef.current.speed = s;
  };

  return (
    <div className="flight-hud">
      <div className="fh-cap">Survey flight — <em>simulated</em></div>
      <div className="fh-row">
        <button className="fh-btn fh-play" onClick={toggle}>
          {playing ? '❚❚' : '▶'}
        </button>
        {[1, 2, 4].map((s) => (
          <button
            key={s}
            className={'fh-btn' + (speed === s ? ' active' : '')}
            onClick={() => pickSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
      <div className="fh-track"><div className="fh-fill" ref={progressRef} /></div>
    </div>
  );
}
