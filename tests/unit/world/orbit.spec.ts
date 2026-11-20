import { expect, test } from '@playwright/test';
import { ORBIT, ROAM } from '../../../src/core/motion.ts';
import { createFollower, orbitPose, viewLimitsOf } from '../../../src/world/follow.ts';
import { createOrbit, orbitModeOf } from '../../../src/world/orbit.ts';
import type { RigPose } from '../../../src/world/rail.ts';
import { createVisitor, HOLD, type WalkArea } from '../../../src/world/roam.ts';
import { traceLayout } from './rig.trace.ts';

const ground = traceLayout.ground;
const enc = ground.enclosure;
const limits = viewLimitsOf(enc, ground.wall.z);
const area: WalkArea = { ...enc.walk, pond: ground.pond, path: ground.path.points };
const DEG = Math.PI / 180;
const MAX = ORBIT.maxDeg * DEG;

function run(o: ReturnType<typeof createOrbit>, s: number, reduced = false): void {
  for (let t = 0; t < s; t += 1 / 60) o.step(1 / 60, reduced);
}

test('?orbit holds a clamped yaw; a still keeps the rest angle; a visit orbits freely', () => {
  expect(orbitModeOf('20', false)).toBe(20);
  expect(orbitModeOf('-90', true)).toBe(-ORBIT.maxDeg);
  expect(orbitModeOf(null, true)).toBe('fixed');
  expect(orbitModeOf('', false)).toBe('free');
  expect(orbitModeOf('x', false)).toBe('free');
});

test('turn keys turn at their rate up to the arc, then the yaw springs back after the idle time', () => {
  const o = createOrbit('free');
  o.setKeys(1);
  run(o, 0.2);
  expect(o.yaw).toBeCloseTo(ORBIT.keyDegPerS * DEG * 0.2, 1);
  run(o, 2);
  expect(o.yaw).toBe(MAX);
  o.setKeys(0);
  run(o, ORBIT.idleS - 0.1);
  expect(o.yaw, 'held through the idle time').toBe(MAX);
  expect(o.busy).toBe(true);
  run(o, 2 * ORBIT.backS);
  expect(o.yaw, 'back at rest').toBe(0);
  expect(o.busy).toBe(false);
});

test('a drag is clamped, grabbing holds the yaw, reduced motion snaps back, zoom stays in range', () => {
  const o = createOrbit('free');
  o.grab(true);
  o.turnBy(-2);
  expect(o.yaw).toBe(-MAX);
  run(o, 3);
  expect(o.yaw, 'held while grabbed').toBe(-MAX);
  o.grab(false);
  run(o, ORBIT.idleS + 0.05, true);
  expect(o.yaw).toBe(0);
  o.zoomBy(5);
  run(o, 1);
  expect(o.zoom).toBe(ORBIT.zoomMax);
  o.zoomBy(0.01);
  run(o, 1);
  expect(o.zoom).toBe(ORBIT.zoomMin);
});

test('a fixed or held orbit ignores input', () => {
  for (const mode of ['fixed', 15] as const) {
    const o = createOrbit(mode);
    o.turnBy(0.3);
    o.setKeys(1);
    o.zoomBy(1.2);
    run(o, 3);
    expect(o.yaw).toBeCloseTo(mode === 'fixed' ? 0 : 15 * DEG, 6);
    expect(o.zoom).toBe(1);
    expect(o.busy).toBe(false);
  }
});

test('the orbited follow pose turns about the visitor and keeps it on the view axis, inside the end walls', () => {
  const px = (limits.minX + limits.maxX) / 2;
  const pz = 2;
  const pose: RigPose = { x: px, y: 3, z: pz + 6, pitch: -0.3, yaw: 0, fov: 40 };
  orbitPose(pose, px, pz, 30 * DEG, limits);
  expect(pose.yaw).toBeCloseTo(30 * DEG, 6);
  expect(Math.hypot(pose.x - px, pose.z - pz)).toBeCloseTo(6, 6);
  const fx = Math.sin(pose.yaw);
  const fz = -Math.cos(pose.yaw);
  expect((px - pose.x) * fz - (pz - pose.z) * fx, 'the visitor stays on the forward axis').toBeCloseTo(0, 6);
  const edge: RigPose = { x: limits.minX + 1, y: 3, z: pz + 8, pitch: -0.3, yaw: 0, fov: 40 };
  orbitPose(edge, limits.minX + 1, pz, MAX, limits);
  expect(edge.x).toBeGreaterThan(limits.minX);
});

test('the follower comes nearer with zoom and carries the orbit yaw', () => {
  const view = { yaw: 0, zoom: 1 };
  const f = createFollower(limits, view);
  f.resize(1920, 1080);
  const x = (limits.minX + limits.maxX) / 2;
  f.step(x, 1, 0, true);
  const far = f.pose.y;
  view.zoom = ORBIT.zoomMax;
  view.yaw = 20 * DEG;
  f.step(x, 1, 0, true);
  expect(f.pose.y).toBeCloseTo(far / ORBIT.zoomMax, 5);
  expect(f.pose.yaw).toBeCloseTo(20 * DEG, 6);
});

test('held walk keys are screen directions: up walks away from an orbited camera', () => {
  const v = createVisitor(area, 0, 0);
  v.setYaw(30 * DEG);
  v.setHeld(HOLD.up);
  for (let i = 0; i < 60; i++) v.step(1 / 60);
  const a = Math.atan2(v.vel[0]!, -v.vel[1]!);
  expect(a).toBeCloseTo(30 * DEG, 3);
  expect(Math.hypot(v.vel[0]!, v.vel[1]!)).toBeCloseTo(ROAM.speed, 3);
});
