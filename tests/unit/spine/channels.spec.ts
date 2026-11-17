import { expect, test } from '@playwright/test';
import { createClock, MAX_DT_S, step12 } from '../../../src/core/clock.ts';
import { linear } from '../../../src/core/motion.ts';
import { spring, tween } from '../../../src/core/spring.ts';

test('spring reverses mid-flight from its value and velocity, no jump', () => {
  const c = spring(1);
  c.to(1);
  for (let i = 0; i < 20; i++) c.tick(1 / 60);
  const x = c.value;
  const v = c.velocity;
  expect(v).toBeGreaterThan(0);
  c.to(0);
  expect(c.value).toBe(x);
  expect(c.velocity).toBe(v);
  c.tick(1 / 60);
  expect(Math.abs(c.value - x)).toBeLessThan(v / 60 + 1e-3);
  let settledFrames = 0;
  for (let i = 0; i < 600; i++) {
    if (c.tick(1 / 60)) settledFrames++;
    expect(c.value).toBeGreaterThanOrEqual(0);
    expect(c.value).toBeLessThanOrEqual(1);
  }
  expect(settledFrames).toBe(1);
  expect(c.value).toBe(0);
});

test('spring to() the same target is a no-op; hold coasts to a stop without a kink', () => {
  const c = spring(1);
  c.to(1);
  c.tick(0.2);
  const x = c.value;
  c.to(1);
  expect(c.value).toBe(x);
  c.hold();
  expect(c.target).toBeGreaterThan(x);
  expect(c.velocity).toBeGreaterThan(0);
  let prev = c.value;
  for (let i = 0; i < 300; i++) {
    c.tick(1 / 60);
    expect(c.value).toBeGreaterThanOrEqual(prev);
    prev = c.value;
  }
  expect(c.settled).toBe(true);
});

test('tween re-bases on reversal: continuous, and half the distance takes half the time', () => {
  const c = tween(1, linear);
  c.to(1);
  c.tick(0.5);
  expect(c.value).toBeCloseTo(0.5, 9);
  c.to(0);
  expect(c.value).toBeCloseTo(0.5, 9);
  c.tick(0.25);
  expect(c.value).toBeCloseTo(0.25, 9);
  expect(c.tick(0.25)).toBe(true);
  expect(c.value).toBe(0);
});

test('tween retime only ever hurries', () => {
  const c = tween(3, linear);
  c.to(1);
  c.tick(1);
  c.retime(0.3);
  const x = c.value;
  c.tick(0.15);
  expect(c.value).toBeCloseTo(x + (1 - x) / 2, 9);
  c.retime(10);
  c.tick(0.15);
  expect(c.settled).toBe(true);
});

test('clock: dt clamped, content time frozen by ?t, stepped at 12 fps', () => {
  const c = createClock();
  c.advance(1000);
  expect(c.dt).toBe(0);
  c.advance(1016);
  expect(c.dt).toBeCloseTo(0.016, 9);
  c.advance(5000);
  expect(c.dt).toBe(MAX_DT_S);
  expect(c.t).toBeCloseTo(0.016 + MAX_DT_S, 9);
  const f = createClock(12.5);
  f.advance(0);
  f.advance(100);
  expect(f.frozen).toBe(true);
  expect(f.t).toBe(12.5);
  expect(f.dt).toBeCloseTo(0.1 > MAX_DT_S ? MAX_DT_S : 0.1, 9);
  expect(step12(1)).toBe(1);
  expect(step12(1 / 12 * 7)).toBeCloseTo(7 / 12, 12);
  expect(step12(0.124)).toBeCloseTo(1 / 12, 12);
});
