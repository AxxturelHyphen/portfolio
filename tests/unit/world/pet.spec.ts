import { expect, test } from '@playwright/test';
import { PET } from '../../../src/core/motion.ts';
import { createPet } from '../../../src/world/pet.ts';
import { createLeash, LEASH_KEY, type Leash } from '../../../src/world/pet.leash.ts';
import type { Clock, CutoutBatch, QuadParams } from '../../../src/types.ts';

// The Rosaleda cat (src/world/pet.ts, pet.follow.ts, pet.leash.ts): activated in free roam it wakes, hops down and
// follows the visitor for good, across the garden, behind and beside them, out of the pond and inside the walls,
// never turning or moving on a jitter; a reload keeps it following, start over puts it back to sleep exactly as it
// was. Reduced motion follows without the bob or the hop; frozen time keeps it asleep; the rail keeps the wake alone.

type Write = { w: number; h: number; x: number; y: number; z: number; rot: number };

function store(initial: string | null = null) {
  const kv = new Map<string, string>();
  if (initial !== null) kv.set(LEASH_KEY, initial);
  return { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v), kv };
}

function rig(leash: Leash = createLeash(store())) {
  const quad: QuadParams = { x: 4.8, y: 0.47, z: -0.45, rot: 0, w: 0.6, h: 0.42, px: 0.275, py: 0, uv: [0, 0, 1, 1], sway: 0, phase: 0, lift: 0, facing: 0, tint: [1, 1, 1, 1] };
  const writes: Write[] = [];
  const anchor: [number, number, number] = [4.9, 0.68, -0.45];
  const writer = {
    capacity: 1, count: 1,
    set: (_i: number, q: QuadParams) => {
      writes.push({ w: q.w, h: q.h, x: q.x, y: q.y, z: q.z, rot: q.rot });
    },
    commit: () => undefined,
  };
  const pet = createPet({ slot: 'rosaleda/cat', batch: { writer } as unknown as CutoutBatch, at: 0, quad }, { edge: [3, 9], anchor }, leash);
  return { quad, writes, anchor, pet, leash };
}

const clock = (t: number, frozen = false): Clock => ({ now: t * 1000, dt: 1 / 60, t, frame: Math.round(t * 60), frozen });
const REST = { w: 0.6, h: 0.42, x: 4.8, y: 0.47, z: -0.45, rot: 0 };
const restOf = (q: QuadParams) => ({ w: q.w, h: q.h, x: q.x, y: q.y, z: q.z, rot: q.rot });
/** The cat's ground point (its pivot as if not turned over) from a write. */
const pivotX = (w: Write): number => (w.w < 0 ? w.x - 0.225 * 0.6 * 2 : w.x);

/** Runs the pet from t0 to t1 at 60 fps; `move` may walk the visitor first. */
function run(r: ReturnType<typeof rig>, visitor: Float32Array | null, t0: number, t1: number, reduced = false, move?: (t: number) => void): number {
  let t = t0;
  for (; t <= t1; t += 1 / 60) {
    move?.(t);
    r.pet.update(clock(t), visitor, reduced);
  }
  return t;
}

test('on the rail a woken cat squashes, turns over toward the camera side and settles, never leaving the bench', () => {
  const r = rig();
  r.pet.wake();
  run(r, null, 0, PET.wakeS + 0.2);
  expect(Math.min(...r.writes.map((w) => w.h)), 'squash').toBeLessThan(0.42 * 0.9);
  expect(r.writes.every((w) => w.y === 0.47 && w.z === -0.45), 'no hop').toBe(true);
  expect(restOf(r.quad)).toEqual(REST);
  expect(r.leash.on, 'the rail ties no leash').toBe(false);
  expect(r.pet.busy).toBe(false);
});

test('clicked in free roam it wakes, hops down, ties its leash and follows with a two-height bob; the proxy point goes with it', () => {
  const r = rig();
  const visitor = new Float32Array([7.5, 0.6]);
  r.pet.wake();
  run(r, visitor, 0, 6);
  expect(r.leash.on).toBe(true);
  expect(Math.max(...r.writes.map((w) => w.y)), 'an arc above the bench').toBeGreaterThan(0.47);
  const ground = r.writes.filter((w) => w.y < 0.05);
  expect(Math.min(...ground.map((w) => w.h)), 'squash on landing').toBeLessThan(0.42 * 0.85);
  // The two heights of the trot's bob, not the last instants of the hop passing through.
  const heights = new Map<number, number>();
  for (const w of ground) heights.set(w.y, (heights.get(w.y) ?? 0) + 1);
  expect([...heights].filter(([, n]) => n >= 3).length, 'a two-height bob').toBe(2);
  const last = r.writes[r.writes.length - 1]!;
  expect(Math.hypot(pivotX(last) - 7.5, last.z - 0.6), 'a step or two from the visitor').toBeLessThan(1.6);
  expect(Math.hypot(pivotX(last) - 7.5, last.z - 0.6), 'never on them').toBeGreaterThan(0.5);
  expect(r.anchor[2] - -0.45, 'the proxy point went with it').toBeCloseTo(last.z + 0.45, 5);
  expect(r.anchor[0], 'and along x').toBeGreaterThan(5.5);
});

test('it follows far past its bed, behind the walking visitor, and keeps out of the pond and inside the walls', () => {
  const r = rig();
  r.leash.area = { minX: 0, maxX: 44, back: -2, front: 3, pond: { x: 14, z: 0.4, rx: 1.5, rz: 1 } };
  const visitor = new Float32Array([6.5, 0.8]);
  r.pet.wake();
  let t = run(r, visitor, 0, 5);
  const from = r.writes.length;
  const behind: number[] = [];
  t = run(r, visitor, t, t + 8, false, (s) => {
    visitor[0] = Math.min(24, 6.5 + (s - 5) * 3);
    visitor[1] = 0.8 + Math.sin(s) * 0.4;
  });
  const trail = r.writes.slice(from);
  for (const w of trail) {
    const e = ((pivotX(w) - 14) / 1.5) ** 2 + ((w.z - 0.4) / 1) ** 2;
    expect(e, 'out of the pond').toBeGreaterThanOrEqual(1);
    expect(w.z).toBeGreaterThanOrEqual(-2);
    expect(w.z).toBeLessThanOrEqual(3);
  }
  run(r, visitor, t, t + 3, false, () => behind.push(visitor[0]! - pivotX(r.writes[r.writes.length - 1]!)));
  const last = r.writes[r.writes.length - 1]!;
  expect(pivotX(last), 'far past the bed edge (9)').toBeGreaterThan(20);
  expect(Math.min(...behind), 'behind the visitor, never ahead').toBeGreaterThan(0);
  expect(trail.some((w) => w.w < 0) || trail.some((w) => w.w > 0), 'its card faces its way').toBe(true);
});

test('a visitor jittering by a few centimetres moves nothing: no step, no turn of the card', () => {
  const r = rig();
  const visitor = new Float32Array([8, 0.7]);
  r.pet.wake();
  let t = run(r, visitor, 0, 9);
  const settled = r.writes[r.writes.length - 1]!;
  const n = r.writes.length;
  t = run(r, visitor, t, t + 4, false, (s) => {
    visitor[0] = 8 + Math.sin(s * 17) * 0.04;
    visitor[1] = 0.7 + Math.cos(s * 13) * 0.04;
  });
  const after = r.writes.slice(n);
  expect(after.every((w) => Math.sign(w.w) === Math.sign(settled.w)), 'the card never turns').toBe(true);
  expect(after.every((w) => pivotX(w) === pivotX(settled) && w.z === settled.z), 'nor steps').toBe(true);
  expect(r.pet.busy, 'at rest the loop may idle').toBe(false);
});

test('a reload keeps it following; start over sends it back to sleep exactly as it was', () => {
  const kv = store('1');
  const r = rig(createLeash(kv));
  const visitor = new Float32Array([12, 1]);
  run(r, visitor, 0, 4);
  const last = r.writes[r.writes.length - 1]!;
  expect(last.y, 'on the ground, without waking on the bench first').toBeLessThan(0.05);
  expect(pivotX(last)).toBeGreaterThan(9);
  r.leash.release();
  run(r, visitor, 4, 4.2);
  expect(restOf(r.quad)).toEqual(REST);
  expect(kv.kv.get(LEASH_KEY)).toBe('0');
  expect(r.anchor).toEqual([4.9, 0.68, -0.45]);
});

test('reduced motion follows without the hop or the bob; frozen time keeps it asleep', () => {
  const r = rig();
  const visitor = new Float32Array([8, 0.8]);
  r.pet.wake();
  run(r, visitor, 0, 9, true);
  expect(r.writes.every((w) => w.y === 0.47 || w.y === 0), 'no hop arc, no bob').toBe(true);
  expect(r.writes.some((w) => w.y === 0), 'yet down and following').toBe(true);
  expect(r.writes.every((w) => w.rot === 0), 'no flick').toBe(true);

  const f = rig(createLeash(store('1')));
  for (let t = 0; t <= 2; t += 1 / 60) f.pet.update(clock(t, true), visitor, false);
  expect(f.writes).toEqual([]);
});

test('falling well behind and catching up chirps, at most every 20 s', () => {
  const r = rig();
  const visitor = new Float32Array([7, 0.6]);
  r.pet.wake();
  let t = run(r, visitor, 0, 5);
  visitor[0] = 14;
  t = run(r, visitor, t, t + 5);
  expect(r.leash.chirps).toBe(1);
  visitor[0] = 22;
  t = run(r, visitor, t, t + 5);
  expect(r.leash.chirps, 'not again within 20 s').toBe(1);
  visitor[0] = 30;
  run(r, visitor, t + 20, t + 26);
  expect(r.leash.chirps).toBe(2);
});

test('the visitor walking up twitches it once; reduced motion never twitches it', () => {
  const a = rig();
  const near = new Float32Array([5.5, -0.2]);
  run(a, near, 0, 2);
  const twitch = a.writes.length;
  expect(twitch).toBeGreaterThan(0);
  run(a, near, 2, 4);
  expect(a.writes.length, 'once per approach').toBe(twitch);

  const b = rig();
  run(b, near, 0, 2, true);
  expect(b.writes).toEqual([]);
});
