import { expect, test } from '@playwright/test';
import { EASE_OUT, irisOf, modeCanvasOf, modeDomOf, omegaFor, panelOf, springStep, stripOf, travelDipOf, travelS } from '../../../src/core/motion.ts';

test('closed-form spring reaches 99 % at its duration, independent of dt', () => {
  const omega = omegaFor(1);
  const a = { x: 0, v: 0 };
  const b = { x: 0, v: 0 };
  springStep(a, 1, omega, 1);
  for (let i = 0; i < 144; i++) springStep(b, 1, omega, 1 / 144);
  expect(a.x).toBeCloseTo(0.99, 2);
  expect(b.x).toBeCloseTo(a.x, 9);
});

test('spring from rest never overshoots and settles exactly', () => {
  const s = { x: 0, v: 0 };
  let settled = false;
  for (let i = 0; i < 600 && !settled; i++) {
    settled = springStep(s, 1, omegaFor(0.46), 1 / 60);
    expect(s.x).toBeLessThanOrEqual(1);
  }
  expect(settled).toBe(true);
  expect(s.x).toBe(1);
});

test('easing endpoints and monotonic', () => {
  expect(EASE_OUT(0)).toBe(0);
  expect(EASE_OUT(1)).toBe(1);
  let prev = 0;
  for (let i = 1; i <= 100; i++) {
    const y = EASE_OUT(i / 100);
    expect(y).toBeGreaterThanOrEqual(prev);
    prev = y;
  }
});

test('iris shuts at open 0.5 and is fully open at 0 and 1; panel only on the second half', () => {
  const o = { x: 0, y: 0, z: 0, w: 0 };
  expect(irisOf(0.5, 0.5, 0.5, 16 / 9, o).z).toBe(0);
  expect(irisOf(0, 0.5, 0.5, 16 / 9, o).z).toBeGreaterThanOrEqual(1.2);
  expect(irisOf(1, 0.1, 0.9, 16 / 9, o).z).toBeGreaterThan(1.5);
  expect(panelOf(0.5)).toBe(0);
  expect(panelOf(1)).toBe(1);
});

test('mode switch: canvas down then DOM up, no overlap', () => {
  expect(modeCanvasOf(0.2 / 0.45)).toBe(0);
  expect(modeDomOf(0.2 / 0.45)).toBe(0);
  expect(modeDomOf(1)).toBe(1);
});

test('travel duration, dip depth and strip', () => {
  expect(travelS(1)).toBe(1.6);
  expect(travelS(5)).toBe(1.6);
  expect(travelDipOf(0.42 * 1.4, 1.4, false)).toBeCloseTo(0.88, 6);
  expect(travelDipOf(0.42 * 1.4, 1.4, true)).toBe(1);
  expect(travelDipOf(0, 1.4, false)).toBe(1);
  const o = { x: 0, y: 0, z: 0, w: 0 };
  expect(stripOf(1, 2, o).w).toBe(0);
  expect(stripOf(0.5, 1, o).w).toBe(0);
  expect(stripOf(0.5, 2, o).w).toBe(1);
});
