import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CAMERA, stripOf, walkOf, walkPeakSpeed, wingOpacityOf, WALK } from '../../../src/core/motion.ts';
import { createRail } from '../../../src/world/rail.ts';
import type { WorldLayout } from '../../../src/world/layout.ts';
import { QUAD_FLAG as GL_FLAG, packPhase as glPack } from '../../../src/gl/instances.ts';
import { QUAD_FLAG, packPhase } from '../../../src/world/quadflags.ts';

// The walk profile (cook/ART.md section 1: 10 m/s cap, wings fade above 6 m/s) and the rail sampling.

const garden = JSON.parse(readFileSync(new URL('../../../content/garden.json', import.meta.url), 'utf8')) as WorldLayout;
const stops = garden.rail.keys.filter((k) => k.bed !== undefined).map((k) => k.x);

test('walk progress runs 0 to 1, monotone, done by the end of travelS', () => {
  let prev = -1;
  for (let i = 0; i <= 200; i++) {
    const w = walkOf(i / 200);
    expect(w).toBeGreaterThanOrEqual(prev - 1e-9);
    prev = w;
  }
  expect(walkOf(0)).toBe(0);
  expect(walkOf(0.99)).toBeCloseTo(1, 3);
});

test('no neighbour hop walks faster than 10 m/s, measured on the real spring curve', () => {
  const longest = Math.max(...stops.slice(1).map((x, i) => x - (stops[i] ?? 0)));
  expect(longest).toBeCloseTo(11.4, 6);
  expect(walkPeakSpeed(longest)).toBeLessThanOrEqual(WALK.maxSpeed);
  const omega = 6.64 / CAMERA.travelS;
  const dt = 1 / 240;
  let peak = 0;
  let x = 0;
  for (let t = dt; t < CAMERA.travelS * 1.4; t += dt) {
    const leg = 1 - (1 + omega * t) * Math.exp(-omega * t);
    const nx = walkOf(leg) * longest;
    peak = Math.max(peak, (nx - x) / dt);
    x = nx;
  }
  expect(peak).toBeLessThanOrEqual(WALK.maxSpeed * 1.01);
  expect(CAMERA.travelS).toBeLessThanOrEqual(1.6);
});

test('near wings fade between 5 and 6 m/s; the strip runs only for jumps over one bed', () => {
  expect(wingOpacityOf(3)).toBe(1);
  expect(wingOpacityOf(6)).toBe(0);
  const o = { x: 0, y: 0, z: 0, w: 0 };
  expect(stripOf(0.5, 1, o).w).toBe(0);
  expect(stripOf(0.5, 2, o).w).toBe(1);
});

test('the rail passes through its keys and eases between them; portrait sets one height and moves each key by dz', () => {
  const rail = createRail(garden.rail);
  const p = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, fov: 0 };
  rail.sample(11.6, p);
  expect(p).toMatchObject({ x: 11.6, y: 2.4, z: 3.2, fov: 34 });
  expect(p.pitch).toBeCloseTo((-15 * Math.PI) / 180, 9);
  rail.sample(13, p);
  expect(p.z).toBeGreaterThan(3.2);
  expect(p.z).toBeLessThan(6.4);
  expect(rail.stopX('gruta')).toBeNaN();
  rail.setPortrait(true);
  rail.sample(11.6, p);
  expect(p).toMatchObject({ y: 2.3, fov: 42, yaw: 0 });
  expect(p.z).toBeCloseTo(2.8, 9);
});

test('world packs instance flags exactly as gl reads them', () => {
  expect(QUAD_FLAG).toEqual(GL_FLAG);
  for (const f of [0, 1, 4, 8, 13, 32, 44, 63]) expect(packPhase(7.5, f)).toBe(glPack(7.5, f));
});
