import { expect, test } from '@playwright/test';
import puerta from '../../../content/beds/puerta.json' with { type: 'json' };
import rosaleda from '../../../content/beds/rosaleda.json' with { type: 'json' };
import type { BedScene3 } from '../../../src/world/layout.ts';
import { findLamps, LAMPS, stepLamps } from '../../../src/world/lamps.ts';
import { createPendulum, PENDULUM, stepPendulum } from '../../../src/world/visitor.ts';

// The carried lantern (cook/ROAM_PLAN.md 3, P5): its pendulum and the lamp list the shader reads.

const DT = 1 / 60;
const scene = (s: unknown): BedScene3 => s as BedScene3;

/** Walks the hand along x: 3.2 m/s for `walkS`, then stands; returns the largest |angle| seen. */
function walk(p: ReturnType<typeof createPendulum>, walkS: number, standS: number, still = false): number {
  let x = 0;
  let max = 0;
  for (let t = 0; t < walkS + standS; t += DT) {
    if (t < walkS) x += 3.2 * DT;
    stepPendulum(p, x, DT, still);
    max = Math.max(max, Math.abs(p.angle));
  }
  return max;
}

test('the swing stays inside its clamp, even under hard back-and-forth steering', () => {
  const p = createPendulum();
  let x = 0;
  for (let i = 0; i < 2000; i++) {
    x += (Math.floor(i / 7) % 2 === 0 ? 3.2 : -3.2) * DT;
    stepPendulum(p, x, DT, false);
    expect(Math.abs(p.angle)).toBeLessThanOrEqual(PENDULUM.maxRad + 1e-9);
    expect(Number.isFinite(p.spin)).toBe(true);
  }
});

test('starting to walk swings the lantern back, and it settles once the visitor stands', () => {
  const p = createPendulum();
  let x = 0;
  for (let i = 0; i < 15; i++) {
    x += 3.2 * DT;
    stepPendulum(p, x, DT, false);
  }
  expect(p.angle).toBeLessThan(-0.02);
  const max = walk(p, 1, 5);
  expect(max).toBeGreaterThan(0.05);
  expect(Math.abs(p.angle)).toBeLessThan(0.005);
  expect(Math.abs(p.spin)).toBeLessThan(0.02);
});

test('reduced motion or frozen time keeps it hanging straight', () => {
  const p = createPendulum();
  expect(walk(p, 2, 1, true)).toBe(0);
  expect(p.spin).toBe(0);
});

test('a large frame step does not blow the swing up', () => {
  const p = createPendulum();
  stepPendulum(p, 0, DT, false);
  stepPendulum(p, 0.5, 0.25, false);
  expect(Math.abs(p.angle)).toBeLessThanOrEqual(PENDULUM.maxRad);
});

test('a bed gives at most two standing lamps, at their flames', () => {
  const out = new Float32Array(LAMPS.standing * 4);
  expect(findLamps(scene(puerta), out)).toBe(2);
  expect(out[0]).toBeCloseTo(1, 5);
  expect(out[1]).toBeGreaterThan(0.1);
  expect(out[3]).toBe(0);
  expect(findLamps(scene(rosaleda), out)).toBe(1);
  expect(out[4]).toBe(0);
  expect(findLamps(null, out)).toBe(0);
  const many = { layers: [{ items: [0, 1, 2, 3].map((i) => ({ sprite: 'sh/lantern-tin', x: i, y: 0, z: 0, scale: 1, h: 0.4 })) }] };
  expect(findLamps(scene(many), out)).toBe(LAMPS.standing);
});

test('the carried lantern is lamp 0 at full strength; standing lamps light only on screen', () => {
  const standing = new Float32Array(LAMPS.standing * 4);
  const n = findLamps(scene(puerta), standing);
  const lamps = new Float32Array(LAMPS.count * 4);
  const onlyFirst = (x: number): boolean => x < 1.3;
  stepLamps(lamps, 5, 0.7, -1, standing, n, onlyFirst, DT, true);
  expect([...lamps.subarray(0, 4)].map((v) => Math.round(v * 100) / 100)).toEqual([5, 0.7, -1, 1]);
  expect(lamps[7]).toBe(1);
  expect(lamps[11]).toBe(0);
  stepLamps(lamps, 5, 0.7, -1, standing, n, () => false, DT, false);
  expect(lamps[7]).toBeGreaterThan(0.9);
  expect(lamps[7]).toBeLessThan(1);
  for (let i = 0; i < 120; i++) stepLamps(lamps, 5, 0.7, -1, standing, n, () => false, DT, false);
  expect(lamps[7]).toBeLessThan(0.01);
  stepLamps(lamps, 5, 0.7, -1, standing, 0, () => true, DT, true);
  expect(lamps[7]).toBe(0);
  expect(lamps[11]).toBe(0);
});
