import { expect, test } from '@playwright/test';
import { stepHash } from '../../../src/audio/steps.ts';
import { createGait, GAIT, stepGait, type Gait } from '../../../src/world/puppet.gait.ts';

// Footfalls (Gait.steps, read by the footstep sound): one per foot set down while walking, one for the settling step,
// none standing or in frozen time; reduced motion still counts them by distance. The per-step variation is fixed.

const DT = 1 / 60;
const STEP_M = 2 * GAIT.strideM;

function run(g: Gait, t0: number, s: number, vx: number, vz: number, o: { frozen?: boolean; reduced?: boolean } = {}): number {
  for (let t = t0; t < t0 + s; t += DT) stepGait(g, t, DT, vx, vz, o.frozen ?? false, o.reduced ?? false);
  return t0 + s;
}

test('walking sets a foot down every two poses, about one per 0.42 m; stopping adds the settling step, standing none', () => {
  const g = createGait();
  let t = run(g, 0, 1, 0, 0);
  expect(g.steps).toBe(0);
  t = run(g, t, 4, 0, -1.2);
  const walked = g.steps;
  expect(walked).toBeGreaterThanOrEqual(Math.floor((4 * 1.2) / STEP_M) - 1);
  expect(walked).toBeLessThanOrEqual(Math.ceil((4 * 1.2) / STEP_M) + 1);
  t = run(g, t, 1, 0, 0);
  /** The settling step, after at most one stride share already walked when the stop came. */
  expect(g.steps - walked).toBeGreaterThanOrEqual(1);
  expect(g.steps - walked).toBeLessThanOrEqual(2);
  const stopped = g.steps;
  run(g, t, 8, 0, 0);
  expect(g.steps).toBe(stopped);
});

test('frozen time sets no foot down; reduced motion still counts steps by distance', () => {
  const frozen = createGait();
  run(frozen, 0, 3, 1.2, 0, { frozen: true });
  expect(frozen.steps).toBe(0);
  const reduced = createGait();
  run(reduced, 0, 4, 1.2, 0, { reduced: true });
  expect(Math.abs(reduced.steps - (4 * 1.2) / STEP_M)).toBeLessThanOrEqual(1.5);
});

test('each step varies by a fixed hash in 0..1, the same on every run and different step to step', () => {
  const a = Array.from({ length: 16 }, (_, n) => stepHash(n, 1));
  expect(a).toEqual(Array.from({ length: 16 }, (_, n) => stepHash(n, 1)));
  for (const v of a) expect(v >= 0 && v < 1).toBe(true);
  expect(new Set(a.map((v) => v.toFixed(3))).size).toBe(a.length);
});
