import { expect, test } from '@playwright/test';
import { APPROACH, APPROACH_FIT } from '../../../src/core/motion.ts';
import { createApproach, type Approach } from '../../../src/world/approach.ts';
import { createFitter, type Fit, type Subject } from '../../../src/world/fit.ts';
import { blendFraming, createFollower, followPose, framingFor, paramsFor, viewLimitsOf, type Framing, type FramingParams } from '../../../src/world/follow.ts';
import type { RigPose } from '../../../src/world/rail.ts';
import { traceLayout } from './rig.trace.ts';

// The approach of free roam (world/approach.ts, world/fit.ts): when the camera eases toward the fitted framing and
// out again, and how far the fit lets it go.

const DT = 1 / 60;
const ROSE = 'rosaleda/rose-a';
const limits = viewLimitsOf(traceLayout.ground.enclosure, traceLayout.ground.wall.z);

/** Steps the approach for `s` seconds at a constant speed along x from x0; returns the x reached. */
function run(a: Approach, speed: number, s: number, focus: string | null = ROSE, x0 = 10, gains = true): number {
  let x = x0;
  for (let t = 0; t < s - 1e-9; t += DT) {
    x += speed * DT;
    a.step(speed, x, 0, focus, gains, true, DT, 'run');
  }
  return x;
}

test('only a focused slot that gains eases in: never because the visitor is merely slow', () => {
  const a = createApproach();
  run(a, 0, 2, null);
  expect(a.near, 'slow, nothing focused').toBe(false);
  run(a, 0, 1, ROSE, 10, false);
  expect(a.near, 'focused, no gain').toBe(false);
  run(a, 3.2, 0.5);
  expect(a.near, 'focused while walking past at full speed').toBe(false);
  run(a, 1.2, DT);
  expect(a.near, 'focused, slowing, gains').toBe(true);
});

test('out after 0.3 s faster than 1.5 m/s, after a metre, or when the focus ends', () => {
  const a = createApproach();
  run(a, 0, 1);
  run(a, 2, APPROACH.fastS - 0.05);
  expect(a.near, 'not before 0.3 s fast').toBe(true);
  run(a, 2, 0.1);
  expect(a.near).toBe(false);
  const b = createApproach();
  run(b, 0, 1, 'estanque/lily-a');
  run(b, 1.2, 1, 'estanque/lily-a');
  expect(b.near, 'a metre and a little at 1.2 m/s').toBe(false);
  const c = createApproach();
  run(c, 0, 1);
  run(c, 0, DT, null);
  expect(c.near, 'focus gone').toBe(false);
});

test('the ease reaches 99 percent in about 1.2 s going in and 0.8 s going out, never jumps and never overshoots', () => {
  const a = createApproach();
  run(a, 0, DT);
  let t = 0;
  let last = a.k;
  while (a.k < 0.99) {
    run(a, 0, DT);
    expect(a.k - last, 'a slow ease, not a cut').toBeLessThan(0.05);
    expect(a.k).toBeLessThanOrEqual(1);
    last = a.k;
    t += DT;
  }
  expect(t).toBeGreaterThan(APPROACH.inS * 0.8);
  expect(t).toBeLessThan(APPROACH.inS * 1.25);
  run(a, 3.2, APPROACH.fastS + DT);
  t = 0;
  while (a.k > 0.01) {
    run(a, 3.2, DT);
    expect(a.k).toBeGreaterThanOrEqual(0);
    t += DT;
  }
  expect(t).toBeGreaterThan(APPROACH.outS * 0.6);
  expect(t).toBeLessThan(APPROACH.outS * 1.25);
});

test('the slot it left does not pull the camera in again; a new one does', () => {
  const a = createApproach();
  run(a, 1.2, DT);
  run(a, 1.2, 1);
  expect(a.near).toBe(false);
  run(a, 1.2, 2, ROSE, 12);
  expect(a.near, 'the same flower').toBe(false);
  run(a, 1.2, DT, 'rosaleda/rose-b', 14);
  expect(a.near, 'a new flower').toBe(true);
});

test('a visitor dithering by a flower around either threshold never pumps the camera', () => {
  const pairs: [number, number][] = [[APPROACH.fastMps - 0.05, APPROACH.fastMps + 0.05], [0.3, 1.8], [0, 0.6]];
  for (const [lo, hi] of pairs) {
    const a = createApproach();
    let flips = 0;
    let was = a.near;
    let x = 10;
    for (let i = 0; i < 600; i++) {
      const v = Math.floor(i / 15) % 2 === 0 ? hi : lo;
      x += v * DT;
      a.step(v, x, 0, ROSE, true, true, DT, 'run');
      if (a.near !== was) flips++;
      was = a.near;
    }
    expect(flips, `${lo}..${hi} m/s`).toBeLessThanOrEqual(2);
  }
});

test('no approach before the visitor has walked by itself, and none under reduced motion', () => {
  const a = createApproach();
  for (let i = 0; i < 120; i++) a.step(0, 10, 0, ROSE, true, false, DT, 'run');
  expect(a.k).toBe(0);
  expect(a.busy).toBe(false);
  for (let i = 0; i < 120; i++) a.step(0, 10, 0, ROSE, true, true, DT, 'reduced');
  expect(a.k).toBe(0);
  expect(a.near).toBe(false);
});

test('frozen time lands on the end state for the speed, focus and gain in the first frame', () => {
  const cases: [number, string | null, boolean, number][] = [[0, ROSE, true, 1], [1, ROSE, true, 1], [0, null, true, 0], [0, ROSE, false, 0], [3.2, ROSE, true, 0]];
  for (const [speed, focus, gains, want] of cases) {
    const a = createApproach();
    a.step(speed, 10, 0, focus, gains, true, DT, 'frozen');
    expect(a.k, `${speed} m/s, focus ${String(focus)}, gains ${gains}`).toBe(want);
    expect(a.busy).toBe(false);
  }
});

const fitter = createFitter(limits);
const fitOf = (s: Subject, vx: number, vz: number, w: number, h: number): Fit => fitter(s, vx, vz, w, h, { k: 0, shift: 0, gain: 1 });
/** The Rosaleda's potted rose (slot rose-a and its plant), and the Salida trunk as if it were a slot. */
const ROSE_SUBJECT: Subject = { x: 11.88, z: -1.63, y0: 0, y1: 2.1, w: 0.6, tagY: 1.39, reach: 0.3 };
const TRUNK: Subject = { x: 44.3, z: -1.2, y0: 0, y1: 4.6, w: 1.6, tagY: 2, reach: 0.8 };

test('the fit eases in on a compact subject on desktop: at least 1.25 times its walking size, at most 45 percent', () => {
  const f = fitOf(ROSE_SUBJECT, 11.9, -0.35, 1920, 1080);
  expect(f.k).toBeGreaterThan(0);
  expect(f.gain).toBeGreaterThanOrEqual(APPROACH_FIT.minGain);
  expect(Math.abs(f.shift)).toBeLessThanOrEqual(APPROACH_FIT.maxShiftM);
});

test('a tall subject, and a phone whose tag strip leaves no room, give no gain: the walking framing stays', () => {
  expect(fitOf(TRUNK, 43.6, 0.1, 1920, 1080).k).toBe(0);
  expect(fitOf(TRUNK, 43.6, 0.1, 390, 844).k).toBe(0);
  const phone = fitOf(ROSE_SUBJECT, 11.9, -0.35, 390, 844);
  expect(phone.k === 0 || phone.gain >= APPROACH_FIT.minGain).toBe(true);
});

test('the near framing is closer and lower than the walking one; k blends between them and lands on both', () => {
  const pose = (): RigPose => ({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0, fov: 0 });
  for (const aspect of [16 / 9, 390 / 844]) {
    const blank = (): FramingParams => ({ up: 0, downDeg: 0, fov: 0, moonAt: 0, at: 0 });
    const w = paramsFor(aspect, false, blank());
    const n = paramsFor(aspect, true, blank());
    const walk = framingFor(aspect, {} as Framing);
    const near = blendFraming(aspect, 1, w, n, blank(), {} as Framing);
    expect(near.up).toBeLessThan(walk.up);
    expect(Math.hypot(near.up, near.back), 'nearer the visitor').toBeLessThan(Math.hypot(walk.up, walk.back));
    expect(blendFraming(aspect, 0, w, n, blank(), {} as Framing)).toEqual(walk);
    const f = createFollower(limits);
    f.resize(aspect * 1000, 1000);
    f.step(20, 0, DT, true, 1, 0.5);
    expect(f.pose.yaw, 'the camera never turns from the back wall').toBe(0);
    expect(f.pose).toEqual(followPose(20, 0, near, limits, pose(), 20.5));
  }
});
