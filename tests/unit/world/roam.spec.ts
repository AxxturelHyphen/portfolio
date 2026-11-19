import { expect, test } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { FOLLOW, FOLLOW_FRAMINGS, ROAM, SPRING_99, type LandscapeFraming } from '../../../src/core/motion.ts';
import { createRig } from '../../../src/world/camera.ts';
import { createFollower, followPose, framingFor, moonElevation, viewLimitsOf, type Framing } from '../../../src/world/follow.ts';
import type { RigPose } from '../../../src/world/rail.ts';
import { createVisitor, HOLD, nearestBed, type Visitor, type WalkArea } from '../../../src/world/roam.ts';
import { traceLayout, traceRig } from './rig.trace.ts';

const ground = traceLayout.ground;
const pond = ground.pond;
const enc = ground.enclosure;
const area: WalkArea = { ...enc.walk, pond, path: ground.path.points };
const limits = viewLimitsOf(enc, ground.wall.z);
const r = ROAM.radius;

/** Ellipse metric of the body-inflated pond: below 1 means the body overlaps the water. */
const pondMetric = (v: Visitor): number => Math.hypot((v.pos[0]! - pond.x) / (pond.rx + r), (v.pos[1]! - pond.z) / (pond.rz + r));
const speedOf = (v: Visitor): number => Math.hypot(v.vel[0]!, v.vel[1]!);
const inside = (v: Visitor): boolean =>
  v.pos[0]! >= area.minX + r - 1e-5 && v.pos[0]! <= area.maxX - r + 1e-5 && v.pos[1]! >= area.minZ + r - 1e-5 && v.pos[1]! <= area.maxZ - r + 1e-5;

test('walk speed is capped at 3.2 m/s', () => {
  const v = createVisitor(area, 0, 0);
  v.setHeld(HOLD.right | HOLD.down);
  let max = 0;
  for (let i = 0; i < 120; i++) {
    v.step(1 / 60);
    max = Math.max(max, speedOf(v));
  }
  expect(max).toBeLessThanOrEqual(ROAM.speed + 1e-4);
  expect(max).toBeGreaterThan(ROAM.speed - 1e-4);
});

test('full speed after 0.15 s, standing still 0.1 s after release', () => {
  const dt = 1 / 240;
  const v = createVisitor(area, 0, 0);
  v.setHeld(HOLD.right);
  let t = 0;
  while (speedOf(v) < ROAM.speed - 1e-4) {
    v.step(dt);
    t += dt;
  }
  expect(t).toBeCloseTo(ROAM.toSpeedS, 2);
  v.setHeld(0);
  t = 0;
  while (speedOf(v) > 0) {
    v.step(dt);
    t += dt;
  }
  expect(t).toBeCloseTo(ROAM.toStopS, 2);
});

test('slides along the edge of the walkable rectangle', () => {
  const v = createVisitor(area, 2, -4.9);
  v.setHeld(HOLD.up | HOLD.right);
  for (let i = 0; i < 60; i++) v.step(1 / 60);
  const x0 = v.pos[0]!;
  for (let i = 0; i < 60; i++) v.step(1 / 60);
  expect(v.pos[1]).toBeCloseTo(area.minZ + r, 5);
  expect(v.pos[0]! - x0).toBeGreaterThan(1.5);
  expect(v.vel[1]).toBe(0);
});

test('never inside the pond, from any approach direction and at dt 0.05', () => {
  const dirs = [HOLD.left, HOLD.right, HOLD.up, HOLD.down, HOLD.left | HOLD.up, HOLD.left | HOLD.down, HOLD.right | HOLD.up, HOLD.right | HOLD.down];
  let minMetric = Infinity;
  let outside = 0;
  for (const dt of [1 / 60, 0.05, 0.25]) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * 2 * Math.PI;
      for (const dir of dirs) {
        const v = createVisitor(area, pond.x + Math.cos(ang) * (pond.rx + 1), pond.z + Math.sin(ang) * (pond.rz + 0.6));
        v.setHeld(dir);
        for (let t = 0; t < 3; t += dt) {
          v.step(dt);
          minMetric = Math.min(minMetric, pondMetric(v));
          if (!inside(v)) outside++;
        }
      }
    }
  }
  expect(minMetric).toBeGreaterThan(1 - 1e-4);
  expect(outside).toBe(0);
});

test('no tunnelling through the rectangle at dt 0.05', () => {
  for (const dir of [HOLD.left, HOLD.right, HOLD.up, HOLD.down]) {
    const v = createVisitor(area, 40, 0);
    v.setHeld(dir);
    for (let i = 0; i < 400; i++) {
      v.step(0.05);
      expect(inside(v)).toBe(true);
    }
  }
});

test('a walk target across the pond goes round it by the nearer side and arrives', () => {
  for (const [z, north] of [[-1.2, true], [-2.4, false]] as const) {
    const v = createVisitor(area, pond.x - pond.rx - 1.5, z);
    v.walkTo(pond.x + pond.rx + 1.5, z);
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let t = 0; t < 12 && v.busy; t += 1 / 60) {
      v.step(1 / 60);
      expect(pondMetric(v)).toBeGreaterThan(1 - 1e-4);
      minZ = Math.min(minZ, v.pos[1]!);
      maxZ = Math.max(maxZ, v.pos[1]!);
    }
    expect(v.busy).toBe(false);
    expect(Math.hypot(v.pos[0]! - (pond.x + pond.rx + 1.5), v.pos[1]! - z)).toBeLessThan(0.1);
    if (north) expect(maxZ).toBeGreaterThan(pond.z + pond.rz);
    else expect(minZ).toBeLessThan(pond.z - pond.rz);
  }
});

test('an assisted move follows the path with its offset blended away, keeps its walking speed over a cut, lands exactly', () => {
  const v = createVisitor(area, 10, 1.5);
  v.assist(20, 1.25);
  v.assistAt(12, 0.2, 1 / 60, false);
  expect(v.assisted).toBe(true);
  const vx = v.vel[0]!;
  v.assistAt(18, 0.8, 1 / 60, true);
  expect(v.pos[0], 'the cut puts the visitor ahead').toBeCloseTo(18, 5);
  expect(v.vel[0], 'no velocity from the jump').toBe(vx);
  v.assistAt(19.99, 1, 1 / 60, false);
  expect([v.pos[0], v.pos[1]], 'lands on the stand point').toEqual([20, 1.25]);
  expect(v.assisted).toBe(false);
  expect(speedOf(v)).toBe(0);
});

test('steering ends an assisted move at once; halt ends a walk target where the visitor is', () => {
  const v = createVisitor(area, 10, 1.5);
  v.assist(30, 0);
  v.setHeld(HOLD.down);
  expect(v.assisted, 'a held key cancels').toBe(false);
  v.setHeld(0);
  v.assist(30, 0);
  v.walkTo(12, 2);
  expect(v.assisted, 'a walk target cancels').toBe(false);
  for (let i = 0; i < 10; i++) v.step(1 / 60);
  v.halt();
  for (let i = 0; i < 30; i++) v.step(1 / 60);
  expect(v.busy, 'stopped and still').toBe(false);
  expect(v.pos[0]).toBeLessThan(12);
});

test('a walk target behind a card the body cannot pass is given up once the walk stalls', () => {
  const v = createVisitor({ ...area, blocks: new Float32Array([11, -1, 12, 1]) }, 10, 0);
  v.walkTo(13, 0);
  let t = 0;
  for (; t < 3 && v.busy; t += 1 / 60) v.step(1 / 60);
  expect(v.busy, 'stopped and given up').toBe(false);
  expect(t, 'within about half a second of reaching the card').toBeLessThan(1);
  expect(v.pos[0]).toBeCloseTo(11 - r, 3);
});

test('a walk target past the wedge between the pond and a box corner is given up, and the visitor comes to rest', () => {
  // The Estanque's west lantern box and the pond: each push-out keeps the speed along its own shape, so the wedged body
  // keeps a velocity while it stands still (the 5-minute soak hung on it).
  const v = createVisitor({ ...area, blocks: new Float32Array([16.89, -0.525, 17.11, -0.275]) }, 17.5, -0.5);
  v.walkTo(17.7, -1.3);
  let t = 0;
  for (; t < 5 && v.busy; t += 1 / 60) v.step(1 / 60);
  expect(v.busy, 'given up and standing').toBe(false);
  expect(t, 'within a couple of seconds').toBeLessThan(3);
});

test('a walk target inside the pond or outside the walls stops at the edge', () => {
  const v = createVisitor(area, 14, 1);
  v.walkTo(pond.x, pond.z);
  for (let i = 0; i < 600 && v.busy; i++) v.step(1 / 60);
  expect(pondMetric(v)).toBeGreaterThan(1 - 1e-4);
  expect(pondMetric(v)).toBeLessThan(1.05);
  v.walkTo(60, 20);
  for (let i = 0; i < 1200 && v.busy; i++) v.step(1 / 60);
  expect(v.pos[0]).toBeCloseTo(area.maxX - r, 1);
  expect(v.pos[1]).toBeCloseTo(area.maxZ - r, 1);
});

test('the nearest bed changes only 1 m past the halfway line', () => {
  const beds = ['puerta', 'rosaleda', 'estanque'] as const;
  const at = (b: string): number => traceLayout.anchors[b as 'puerta'];
  expect(nearestBed(5.9, 'puerta', beds, at)).toBe('puerta');
  expect(nearestBed(6.1, 'puerta', beds, at)).toBe('rosaleda');
  expect(nearestBed(4.1, 'rosaleda', beds, at)).toBe('rosaleda');
  expect(nearestBed(3.9, 'rosaleda', beds, at)).toBe('puerta');
  expect(nearestBed(3.9, null, beds, at)).toBe('puerta');
});

const LANDSCAPE: readonly LandscapeFraming[] = ['low', 'mid', 'high'];
const blankPose = (): RigPose => ({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0, fov: 0 });

function cameraOf(p: RigPose, aspect: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(p.fov, aspect, 0.05, 400);
  cam.rotation.order = 'YXZ';
  cam.position.set(p.x, p.y, p.z);
  cam.rotation.set(p.pitch, -p.yaw, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

test('the clamp keeps the visitor 22 to 78 percent across a landscape frame anywhere in the walk area', () => {
  for (const aspect of [16 / 9, 21 / 9]) {
    const f = framingFor(aspect, {} as Framing);
    const pose = blankPose();
    let lo = 1;
    let hi = 0;
    for (let x = enc.walk.minX + r; x <= enc.walk.maxX - r + 1e-6; x += 0.1) {
      for (let z = enc.walk.minZ + r; z <= enc.walk.maxZ - r + 1e-6; z += 0.25) {
        const s = (new Vector3(x, 0, z).project(cameraOf(followPose(x, z, f, limits, pose), aspect)).x + 1) / 2;
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
    }
    expect(lo, `${aspect.toFixed(2)}`).toBeGreaterThanOrEqual(0.22 - 1e-3);
    expect(hi, `${aspect.toFixed(2)}`).toBeLessThanOrEqual(0.78 + 1e-3);
  }
});

test('each framing puts the visitor at 60 to 65 percent of the height and the moon in view over the wall', () => {
  const cases = [...LANDSCAPE.map((n) => [n, 1920 / 1080] as const), ['phone', 390 / 844] as const, ['phone', 800 / 1200] as const];
  for (const [name, aspect] of cases) {
    const f = framingFor(aspect, {} as Framing, name === 'phone' ? FOLLOW.framing : name);
    expect(f.fov, name).toBe(FOLLOW_FRAMINGS[name].fov);
    expect(f.fov, name).toBeLessThan(55);
    const pose = followPose(20, -1, f, limits, blankPose());
    const cam = cameraOf(pose, aspect);
    const at = (1 - new Vector3(20, 0, -1).project(cam).y) / 2;
    expect(at, name).toBeGreaterThanOrEqual(0.6);
    expect(at, name).toBeLessThanOrEqual(0.65);
    const el = moonElevation(f) * (Math.PI / 180);
    const moon = new Vector3(pose.x, pose.y + Math.sin(el) * 100, pose.z - Math.cos(el) * 100).project(cam);
    expect((1 - moon.y) / 2, name).toBeCloseTo(f.moonAt, 5);
    const wallTop = new Vector3(20, ground.wall.h, ground.wall.z).project(cam);
    expect(moon.y, `${name}: the moon stands over the wall top`).toBeGreaterThan(wallTop.y);
  }
});

test('the follower trails a walk by under a metre, settles within a second, and has no lag under reduced motion', () => {
  const f = createFollower(limits);
  f.resize(1920, 1080);
  const dt = 1 / 60;
  let x = 10;
  f.step(x, 0, dt, false);
  for (let i = 0; i < 180; i++) f.step((x += ROAM.speed * dt), 0, dt, false);
  const behind = x - f.pose.x;
  expect(behind).toBeGreaterThan(0.3);
  expect(behind).toBeLessThan(0.7);
  const want = followPose(x, 0, framingFor(1920 / 1080, {} as Framing), limits, blankPose());
  let t = 0;
  while (Math.abs(f.pose.x - want.x) > 0.01 * behind) {
    f.step(x, 0, dt, false);
    t += dt;
  }
  expect(t).toBeLessThan(1);
  expect(SPRING_99 * FOLLOW.tauS).toBeLessThan(1);
  f.step(x + 2, 0, dt, true);
  expect(f.pose).toEqual(followPose(x + 2, 0, framingFor(1920 / 1080, {} as Framing), limits, blankPose()));
});

/** Rail poses recorded from the rig before free roam existed (tests/unit/world/rig.trace.ts). */
const RAIL_BEFORE_ROAM: number[][] = [
  [22.5, 2.2, 8, -0.10472, 0, 44],
  [23.93654, 2.2, 8, -0.10472, 0, 44],
  [24.52937, 1.5723, 5.71744, -0.10472, 0, 44],
  [24.62764, 1.57143, 5.71429, -0.10472, 0, 44],
  [21.14801, 2.02686, 6.95291, -0.1224, -0.11651, 35.59943],
  [15.16954, 2.58561, 6.32722, -0.27715, -0.07127, 36.03868],
  [11.63477, 2.3996, 3.20182, -0.26172, -0.11144, 34.0055],
  [11.6, 2.4, 3.2, -0.2618, -0.10472, 34],
  [11.6, 2.32362, 2.46742, -0.2618, -0.10472, 34],
  [11.6, 2.3216, 2.44814, -0.2618, -0.10472, 34],
  [11.6, 2.07366, 0.2766, -0.2618, -0.10472, 34],
  [11.6, 2.07366, 0.2766, -0.2618, -0.10472, 34],
  [11.6, 2.31566, 2.39595, -0.2618, -0.10472, 34],
  [11.6, 2.3216, 2.448, -0.2618, -0.10472, 34],
  [11.6, 2.3216, 2.448, -0.2618, -0.10472, 34],
  [14.57667, 2.57388, 5.99501, -0.27715, 0.04207, 35.75902],
  [18.49333, 2.31086, 6.86249, -0.18842, 0.01432, 34.84343],
  [20.97978, 2.10002, 7.19997, -0.12218, -0.06491, 34.00008],
  [21, 2.1, 7.2, -0.12217, -0.06981, 34],
  [26.57746, 2.26281, 5.8534, -0.22906, 0.05395, 38.42147],
  [35.09393, 2.50917, 6.3384, -0.26386, 0.06367, 36.70578],
  [41.28975, 2.58383, 5.0115, -0.20781, 0.06211, 38.09392],
  [41.55689, 2.59739, 5.00182, -0.20917, 0.05223, 38.01525],
  [37.28225, 2.06167, 1.89582, -0.24256, -0.01297, 32.49121],
  [34.076, 1.35333, -2.84975, -0.25387, -0.01235, 26.16724],
  [33.50004, 0.90366, -6.17434, -0.24445, 0.00002, 22.62792],
  [33.5, 0.9, -6.2, -0.24435, 0, 22.6],
  [33.16908, 1.43833, -2.55576, -0.26294, 0.00146, 26.62723],
  [31.72533, 2.14667, 1.93498, -0.29405, 0.01003, 31.73603],
  [30.21418, 2.59634, 4.77634, -0.31401, 0.03311, 34.97333],
  [30.20362, 1.73206, 5.5714, -0.13743, 0.00545, 42.59427],
  [30.20427, 1.58168, 5.70502, -0.10681, 0.00035, 43.90997],
  [30.20423, 1.57196, 5.7138, -0.10483, 0.00002, 43.99533],
  [30.20423, 1.57143, 5.71429, -0.10472, 0, 44],
  [25.08454, 1.98467, 6.32841, -0.16412, -0.0396, 42.86561],
  [11.33727, 2.22903, 3.98067, -0.19924, -0.06301, 42.19482],
  [2.22292, 2.28818, 0.88392, -0.20774, -0.01463, 42.03246],
  [1.77244, 2.29815, 0.81249, -0.20917, 0, 42.00508],
];

test('without roam the rig poses equal the rail poses recorded before free roam', () => {
  expect(traceRig(createRig(traceLayout))).toEqual(RAIL_BEFORE_ROAM);
});
