import { expect, test } from '@playwright/test';
import type { BloomDef, SlotView } from '../../../src/types.ts';
import { STEP_FPS } from '../../../src/core/motion.ts';
import { createFlower } from '../../../src/world/flower.ts';
import { LIFE, createFlowerLife, popOf } from '../../../src/world/flower.life.ts';
import { PROXIMITY } from '../../../src/world/proximity.ts';

const slot: SlotView = { id: 'rosaleda/a', kind: 'project', world: [10, 1.4, -1], hit: [1, 1], alt: 'a' };
const clockAt = (t: number, frozen = false) => ({ now: 0, dt: 1 / 60, t, frame: 0, frozen });

test('the bloom pop swells past its size, dips a little under, then settles', () => {
  expect(popOf(0)).toBe(0);
  expect(popOf(1)).toBe(0);
  let peak = 0;
  let dip = 0;
  for (let p = 0; p <= 1; p += 0.01) {
    peak = Math.max(peak, popOf(p));
    dip = Math.min(dip, popOf(p));
  }
  expect(peak).toBeCloseTo(LIFE.popPeak, 2);
  expect(dip).toBeLessThan(0);
  expect(dip).toBeGreaterThan(-LIFE.popPeak / 2);
});

test('an idle flower sways and breathes on the 12 fps clock; reduced motion keeps it still', () => {
  const life = createFlowerLife(slot, 0.3);
  const rots = new Set<number>();
  for (let f = 0; f < 120; f++) {
    const changed = life.step(clockAt(f / 60), null, 0, false);
    if (f > 0 && f % 5 !== 0) expect(changed).toBe(false);
    rots.add(life.rot);
    expect(Math.abs(life.rot)).toBeLessThanOrEqual(LIFE.swayRad);
  }
  expect(rots.size).toBeGreaterThan(10);
  expect(rots.size).toBeLessThanOrEqual(2 * STEP_FPS + 1);
  for (let f = 0; f < 60; f++) life.step(clockAt(f / 60), null, 0, true);
  expect(life.rot).toBe(0);
  expect(life.scale).toBe(1);
  expect(life.yaw).toBe(0);
});

test('a visitor within reach opens the flower toward them in about half a second, and it closes as they leave', () => {
  const life = createFlowerLife(slot, 0);
  const visitor = new Float32Array([slot.world[0] + 1.5, slot.world[2] + 0.5]);
  life.step(clockAt(0), visitor, 0, false);
  expect(life.near).toBe(true);
  for (let i = 1; i <= Math.ceil(LIFE.nearS * STEP_FPS); i++) life.step(clockAt(i / STEP_FPS), visitor, 0, false);
  expect(life.yaw).toBeGreaterThan(0.2);
  expect(life.yaw).toBeLessThanOrEqual(LIFE.turnMaxRad);
  expect(life.scale).toBeGreaterThan(1 + LIFE.nearScale - LIFE.breath * 1.2);
  visitor[0] = slot.world[0] + PROXIMITY.reachM + PROXIMITY.hysteresisM / 2;
  visitor[1] = slot.world[2];
  life.step(clockAt(2), visitor, 0, false);
  expect(life.near).toBe(true);
  visitor[0] = slot.world[0] + PROXIMITY.reachM + PROXIMITY.hysteresisM + 0.1;
  for (let i = 0; i <= Math.ceil(LIFE.nearS * STEP_FPS); i++) life.step(clockAt(2 + i / STEP_FPS), visitor, 0, false);
  expect(life.near).toBe(false);
  expect(life.yaw).toBeCloseTo(0, 6);
});

test('a project flower within reach opens like a focused one; frozen time settles its pop at once', () => {
  const bloom: BloomDef = { kind: 'rose', mode: 'frames', steps: 10, frames: [], rest: { idea: 0, wip: 0.4, shipped: 1 } };
  const visitor = new Float32Array([100, 100]);
  const f = createFlower({ slot, bloom, sprites: {}, scale: 1, env: { state: { reduced: false } }, hinge: 0, visitor });
  f.update(clockAt(0));
  const rest = f.openness;
  visitor[0] = slot.world[0];
  visitor[1] = slot.world[2] + 1;
  for (let i = 1; i <= 24; i++) f.update(clockAt(i / STEP_FPS));
  expect(f.openness).toBe(1);
  expect(rest).toBeLessThan(1);
  const life = createFlowerLife(slot, 0);
  life.step(clockAt(1, true), null, 0, false);
  const settled = life.scale;
  life.pop();
  life.step(clockAt(1, true), null, 0, false);
  expect(life.scale).toBe(settled);
});
