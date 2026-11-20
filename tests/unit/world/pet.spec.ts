import { expect, test } from '@playwright/test';
import { PET } from '../../../src/core/motion.ts';
import { createPet } from '../../../src/world/pet.ts';
import type { Clock, CutoutBatch, QuadParams } from '../../../src/types.ts';

// The Rosaleda cat (src/world/pet.ts): activated, it wakes and turns its head side toward the visitor by transforms of
// its own quad, then rests exactly as it was; reduced motion keeps it still.

function rig() {
  const quad: QuadParams = { x: 4.8, y: 0.47, z: -0.45, rot: 0, w: 0.6, h: 0.42, px: 0.275, py: 0, uv: [0, 0, 1, 1], sway: 0, phase: 0, lift: 0, facing: 0, tint: [1, 1, 1, 1] };
  const writes: { w: number; h: number; x: number }[] = [];
  const writer = { capacity: 1, count: 1, set: (_i: number, q: QuadParams) => void writes.push({ w: q.w, h: q.h, x: q.x }), commit: () => undefined };
  const pet = createPet({ slot: 'rosaleda/cat', batch: { writer } as unknown as CutoutBatch, at: 0, quad });
  return { quad, writes, pet };
}

const clock = (t: number): Clock => ({ now: t * 1000, dt: 1 / 60, t, frame: Math.round(t * 60), frozen: false });

test('a woken cat squashes, turns over toward a visitor on its tail side and settles back to its rest quad', () => {
  const { quad, writes, pet } = rig();
  const visitor = new Float32Array([7, 1]);
  pet.wake();
  for (let t = 0; t <= PET.wakeS + 0.2; t += 1 / 60) pet.update(clock(t), visitor, false);
  expect(Math.min(...writes.map((w) => w.h)), 'squash').toBeLessThan(0.42 * 0.9);
  expect(Math.min(...writes.map((w) => w.w)), 'turned over').toBeLessThan(0);
  expect(new Set(writes.map((w) => w.w)).size, 'stepped poses, not per frame').toBeLessThan(PET.wakeS * 12 + 2);
  expect({ w: quad.w, h: quad.h, x: quad.x, rot: quad.rot }).toEqual({ w: 0.6, h: 0.42, x: 4.8, rot: 0 });
});

test('the visitor walking up twitches it once; reduced motion keeps it still', () => {
  const a = rig();
  const near = new Float32Array([5.5, -0.2]);
  for (let t = 0; t <= 2; t += 1 / 60) a.pet.update(clock(t), near, false);
  const twitch = a.writes.length;
  expect(twitch).toBeGreaterThan(0);
  for (let t = 2; t <= 4; t += 1 / 60) a.pet.update(clock(t), near, false);
  expect(a.writes.length, 'once per approach').toBe(twitch);

  const b = rig();
  b.pet.wake();
  for (let t = 0; t <= 2; t += 1 / 60) b.pet.update(clock(t), near, true);
  expect(b.writes).toEqual([]);
});
