import { expect, test } from '@playwright/test';
import { PET } from '../../../src/core/motion.ts';
import { createPet } from '../../../src/world/pet.ts';
import type { Clock, CutoutBatch, QuadParams } from '../../../src/types.ts';

// The Rosaleda cat (src/world/pet.ts): activated, it wakes and turns its head side toward the visitor by transforms of
// its own quad, hops down, trots beside the visitor within the bed's edge, comes back and rests exactly as it was; its
// proxy's world point goes with it. Reduced motion keeps the wake alone.

function rig(edge: readonly [number, number] = [3, 9]) {
  const quad: QuadParams = { x: 4.8, y: 0.47, z: -0.45, rot: 0, w: 0.6, h: 0.42, px: 0.275, py: 0, uv: [0, 0, 1, 1], sway: 0, phase: 0, lift: 0, facing: 0, tint: [1, 1, 1, 1] };
  const writes: { w: number; h: number; x: number; y: number; z: number }[] = [];
  const anchor: [number, number, number] = [4.9, 0.68, -0.45];
  const anchors: [number, number, number][] = [];
  const writer = {
    capacity: 1, count: 1,
    set: (_i: number, q: QuadParams) => {
      writes.push({ w: q.w, h: q.h, x: q.x, y: q.y, z: q.z });
    },
    commit: () => undefined,
  };
  const pet = createPet({ slot: 'rosaleda/cat', batch: { writer } as unknown as CutoutBatch, at: 0, quad }, { edge, anchor });
  return { quad, writes, anchor, anchors, pet };
}

const clock = (t: number): Clock => ({ now: t * 1000, dt: 1 / 60, t, frame: Math.round(t * 60), frozen: false });
const REST = { w: 0.6, h: 0.42, x: 4.8, y: 0.47, z: -0.45, rot: 0 };
const restOf = (q: QuadParams) => ({ w: q.w, h: q.h, x: q.x, y: q.y, z: q.z, rot: q.rot });

test('reduced motion: a woken cat squashes, turns over toward a visitor on its tail side and settles, never leaving the bench', () => {
  const { quad, writes, pet } = rig();
  const visitor = new Float32Array([7, 1]);
  pet.wake();
  for (let t = 0; t <= PET.wakeS + 0.2; t += 1 / 60) pet.update(clock(t), visitor, true);
  expect(Math.min(...writes.map((w) => w.h)), 'squash').toBeLessThan(0.42 * 0.9);
  expect(Math.min(...writes.map((w) => w.w)), 'turned over').toBeLessThan(0);
  expect(new Set(writes.map((w) => w.w)).size, 'stepped poses, not per frame').toBeLessThan(PET.wakeS * 12 + 2);
  expect(writes.every((w) => w.y === 0.47 && w.z === -0.45), 'no hop').toBe(true);
  expect(restOf(quad)).toEqual(REST);
  expect(pet.busy).toBe(false);
});

test('woken by a visitor standing near, it hops down, trots beside it facing its way, comes back and curls up', () => {
  const { quad, writes, anchor, anchors, pet } = rig();
  const visitor = new Float32Array([7.5, 0.6]);
  pet.wake();
  let t = 0;
  for (; t <= 20 && (t < 1 || pet.busy); t += 1 / 60) {
    const n = writes.length;
    pet.update(clock(t), visitor, false);
    if (writes.length > n) anchors.push([anchor[0], anchor[1], anchor[2]]);
  }
  expect(t, 'back asleep within a walk').toBeLessThan(14);
  const ground = writes.filter((w) => w.y < 0.05);
  expect(ground.length, 'down on the ground').toBeGreaterThan(20);
  expect(Math.max(...writes.map((w) => w.y)), 'an arc above the bench').toBeGreaterThan(0.47);
  expect(Math.min(...ground.map((w) => w.h)), 'squash on landing').toBeLessThan(0.42 * 0.85);
  expect(new Set(ground.map((w) => w.y)).size, 'a stepped bob').toBe(2);
  expect(Math.max(...writes.map((w) => w.x)), 'beside the visitor, never on it').toBeLessThan(7.5 - 0.5 + 0.6);
  expect(Math.max(...writes.map((w) => w.x)), 'trots toward it').toBeGreaterThan(6);
  expect(Math.min(...ground.map((w) => w.z)), 'in front of its bench').toBeGreaterThanOrEqual(-0.45 + 0.44);
  expect(writes.some((w) => w.w < 0) && writes.some((w) => w.y < 0.05 && w.w > 0), 'turns to face its way').toBe(true);
  const far = writes.findIndex((w) => w.y < 0.05 && w.x > 6);
  expect(anchors[far]![2] - anchor[2], 'the proxy point goes with it').toBeCloseTo(writes[far]!.z + 0.45, 5);
  expect(anchor).toEqual([4.9, 0.68, -0.45]);
  expect(restOf(quad)).toEqual(REST);
});

test('a visitor walking away is followed only to the bed edge', () => {
  const { writes, pet } = rig([3, 6]);
  const visitor = new Float32Array([5.5, 0.6]);
  pet.wake();
  for (let t = 0; t <= 6; t += 1 / 60) {
    if (t > 3.5) visitor[0] = Math.min(15, 5.5 + (t - 3.5) * 3);
    pet.update(clock(t), visitor, false);
  }
  const pivot = writes.map((w) => (w.w < 0 ? w.x - 0.225 * 0.6 * 2 : w.x));
  expect(Math.max(...pivot), 'stops at the edge').toBeLessThanOrEqual(6 + 1e-6);
  expect(Math.max(...pivot)).toBeGreaterThan(5.8);
});

test('the visitor walking up twitches it once; reduced motion never twitches it', () => {
  const a = rig();
  const near = new Float32Array([5.5, -0.2]);
  for (let t = 0; t <= 2; t += 1 / 60) a.pet.update(clock(t), near, false);
  const twitch = a.writes.length;
  expect(twitch).toBeGreaterThan(0);
  for (let t = 2; t <= 4; t += 1 / 60) a.pet.update(clock(t), near, false);
  expect(a.writes.length, 'once per approach').toBe(twitch);

  const b = rig();
  for (let t = 0; t <= 2; t += 1 / 60) b.pet.update(clock(t), near, true);
  expect(b.writes).toEqual([]);
});
