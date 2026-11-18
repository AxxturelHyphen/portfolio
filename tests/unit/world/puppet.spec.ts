import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { AtlasManifest, QuadParams } from '../../../src/types.ts';
import {
  BACK_POSES, createGait, createPuppet, FIGURE, PINS, poseOf, SIDE_POSES, SLOT, stepGait, type FigureRects, type Gait, type Pose,
} from '../../../src/world/puppet.ts';

// The visitor's paper figure (cook/FIGURE_BUILD.md 4): pins, ground contact, the stepped gait and its views.

const manifest = JSON.parse(readFileSync(new URL('../../../public/atlas/roam.json', import.meta.url), 'utf8')) as AtlasManifest;
const rects = manifest.sprites as unknown as FigureRects;
/** One pixel of the figure at 1080 (1.35 m is about 197 px tall). */
const PX = FIGURE.topM / 197;
const DT = 1 / 60;
const DEG = Math.PI / 180;

/** World x, y of a sprite fraction on a written quad (the shader's corner, pivot, flip and turn). */
function at(q: QuadParams, f: readonly number[]): [number, number] {
  const flip = (q.uv[2] ?? 0) < (q.uv[0] ?? 0);
  const lx = ((flip ? 1 - f[0]! : f[0]!) - q.px) * q.w;
  const ly = (f[1]! - q.py) * q.h;
  const c = Math.cos(q.rot);
  const s = Math.sin(q.rot);
  return [q.x + c * lx - s * ly, q.y + s * lx + c * ly];
}
function expectAt(q: QuadParams, x: number, y: number): void {
  expect(Math.hypot(q.x - x, q.y - y)).toBeLessThan(PX);
}
const soleOf = (q: QuadParams, rectH: number): number => {
  const pad = 8 / (rectH * FIGURE.pagePx);
  return Math.min(at(q, [pad, pad])[1], at(q, [1 - pad, pad])[1]);
};

type Q11 = [QuadParams, QuadParams, QuadParams, QuadParams, QuadParams, QuadParams, QuadParams, QuadParams, QuadParams, QuadParams, QuadParams];

/** A gait holding a given view, pose and edge state. */
function gaitOf(view: Gait['view'], pose: number, idle: boolean, edge = false, dir = 1): Gait {
  return { ...createGait(), view, dir, pose, idle, edge };
}

const STATES: Gait[] = [];
for (const view of ['back', 'side', 'front'] as const) {
  for (const dir of [1, -1]) {
    STATES.push(gaitOf(view, 0, true, false, dir), gaitOf(view, 0, true, true, dir));
    for (let p = 0; p < 4; p++) STATES.push(gaitOf(view, p, false, false, dir));
  }
}

test('every part hangs from its parent pin within a pixel, in every pose, view, side and scale', () => {
  const puppet = createPuppet(rects);
  for (const g of STATES) {
    for (const k of [1, FIGURE.portraitK]) {
      const m = g.view === 'side' ? g.dir : -g.dir;
      puppet.place(g, 3, -2, k, m);
      const q = puppet.quads;
      const side = g.view === 'side';
      /** Slots of torso, head, hat, free arm and hand, carrying arm and hand, shin A, thigh A, shin B, thigh B. */
      const slots = side ? [7, 8, 9, 1, 2, 10, 11, 4, 3, 6, 5] : [7, 10, 11, 5, 8, 6, 9, 2, 1, 4, 3];
      const [torso, head, hat, freeArm, freeHand, crookArm, crookHand, shinA, thighA, shinB, thighB] = slots.map((i) => q[i]!) as Q11;
      const neck = at(torso, PINS.neck);
      expectAt(head, neck[0] + (side ? m * FIGURE.headFwdM * k : 0), neck[1]);
      const seat = at(head, PINS.hatSeat);
      expectAt(hat, seat[0] + (side ? m * (FIGURE.hatFwdM - FIGURE.headFwdM) * k : 0), seat[1]);
      const shoulderFree = at(torso, side ? PINS.sideShoulder : PINS.shoulderL);
      const shoulderCrook = at(torso, side ? PINS.sideShoulder : PINS.shoulderR);
      expectAt(freeArm, ...shoulderFree);
      expectAt(crookArm, ...shoulderCrook);
      expectAt(freeHand, ...at(freeArm, PINS.cuff));
      expectAt(crookHand, ...at(crookArm, PINS.cuffBent));
      if (!side) {
        expectAt(thighA, ...at(torso, PINS.hipL));
        expectAt(thighB, ...at(torso, PINS.hipR));
      } else {
        expectAt(thighA, torso.x - m * FIGURE.hipM * k, torso.y);
        expectAt(thighB, torso.x + m * FIGURE.hipM * k, torso.y);
      }
      expectAt(shinA, ...at(thighA, side ? PINS.kneeR : PINS.kneeL));
      expectAt(shinB, ...at(thighB, PINS.kneeR));
      const grip = at(crookHand, PINS.grip);
      expect(Math.hypot(grip[0] - puppet.grip[0]!, grip[1] - puppet.grip[1]!)).toBeLessThan(1e-4);
      const hA = side ? rects['fg/shin-r'].uv[3] - rects['fg/shin-r'].uv[1] : rects['fg/shin-l'].uv[3] - rects['fg/shin-l'].uv[1];
      const hB = rects['fg/shin-r'].uv[3] - rects['fg/shin-r'].uv[1];
      const soles = [soleOf(shinA, hA), soleOf(shinB, hB)];
      const p = poseOf(g);
      const feet = g.view === 'front' ? -1 : 1;
      const want = [feet * p.footA, feet * p.footB];
      const planted = Math.min(...want);
      for (let i = 0; i < 2; i++) {
        if (want[i] === planted) expect(Math.abs(soles[i]!), `${g.view} ${g.pose} planted sole on the ground line`).toBeLessThan(PX);
        else expect(soles[i]!).toBeGreaterThan(PX);
      }
      expect(Math.max(...soles)).toBeLessThan(0.1 * k);
      expect(at(hat, [0.5, 1])[1]).toBeLessThan((FIGURE.topM + 0.05) * k);
      expect(at(hat, [0.5, 1])[1]).toBeGreaterThan((FIGURE.topM - 0.12) * k);
    }
  }
});

test('the contact shadow lies at the ground point, on the empty patch, and the hands stay at the grip', () => {
  const puppet = createPuppet(rects);
  puppet.place(gaitOf('back', 0, true), 3, -2, 1, 1);
  const shadow = puppet.quads[SLOT.shadow]!;
  expect([shadow.y, shadow.z, shadow.py]).toEqual([0, -2, 0]);
  expect(Math.abs(shadow.x - 3)).toBeLessThan(0.02);
  expect(Array.from(shadow.uv)).toEqual(rects['fg/void'].uv);
});

const mirrored = (p: Pose, back: boolean): Pose => ({
  ...p, hipA: back ? -p.hipB : p.hipB, hipB: back ? -p.hipA : p.hipA, footA: p.footB, footB: p.footA, kneeA: p.kneeB, kneeB: p.kneeA,
  torso: back ? -p.torso : p.torso, head: back ? -p.head : p.head,
});
const legs = (p: Pose): number[] => [p.hipA, p.hipB, p.footA, p.footB, p.kneeA, p.kneeB, p.torso, p.head, p.drop].map((v) => v + 0);

test('the third and fourth poses are the first and second mirrored', () => {
  expect(legs(BACK_POSES[2]!)).toEqual(legs(mirrored(BACK_POSES[0]!, true)));
  expect(legs(BACK_POSES[3]!)).toEqual(legs(mirrored(BACK_POSES[1]!, true)));
  expect(legs(SIDE_POSES[2]!)).toEqual(legs(mirrored(SIDE_POSES[0]!, false)));
  expect(legs(SIDE_POSES[3]!)).toEqual(legs(mirrored(SIDE_POSES[1]!, false)));
  expect(SIDE_POSES[2]!.free).toBe(-SIDE_POSES[0]!.free);
});

test('the carrying arm turns at most a degree between poses, so the lantern bobs on the steps without jitter', () => {
  const puppet = createPuppet(rects);
  for (const view of ['back', 'side'] as const) {
    const poses = view === 'back' ? BACK_POSES : SIDE_POSES;
    let prev: [number, number, number] | null = null;
    for (let i = 0; i <= poses.length; i++) {
      puppet.place(gaitOf(view, i % poses.length, false), 0, 0, 1, 1);
      const now: [number, number, number] = [puppet.grip[0]!, puppet.grip[1]!, puppet.quads[view === 'back' ? 6 : 10]!.rot];
      if (prev !== null) {
        expect(Math.abs(now[2] - prev[2])).toBeLessThanOrEqual(1 * DEG + 1e-9);
        expect(Math.hypot(now[0] - prev[0], now[1] - prev[1])).toBeLessThan(0.035);
      }
      prev = now;
    }
  }
});

/** Walks at (vx, vz) m/s for `s` seconds from time t0; returns each frame's tick and the drawn state. */
interface Frame { tick: number; key: string; edge: boolean; view: string }
function walk(g: Gait, t0: number, s: number, vx: number, vz: number, o: { frozen?: boolean; reduced?: boolean } = {}): Frame[] {
  const out: Frame[] = [];
  for (let t = t0; t < t0 + s; t += DT) {
    stepGait(g, t, DT, vx, vz, o.frozen ?? false, o.reduced ?? false);
    out.push({ tick: Math.floor(t * FIGURE.fps), key: `${g.view} ${g.dir} ${g.pose} ${g.idle} ${g.edge} ${g.shift}`, edge: g.edge, view: g.view });
  }
  return out;
}

test('the walk advances only on twos of 12 fps, at most one pose a tick, one pose per stride share', () => {
  const g = createGait();
  const frames = walk(g, 0, 3, 1.6, -0.1);
  let changes = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i]!.key === frames[i - 1]!.key) continue;
    changes++;
    expect(frames[i]!.tick).not.toBe(frames[i - 1]!.tick);
  }
  const poses = new Set<number>();
  const h = createGait();
  let steps = 0;
  let last = h.pose;
  for (let t = 0; t < 3; t += DT) {
    stepGait(h, t, DT, 0.1, -1.6, false, false);
    if (!h.idle && h.pose !== last) steps++;
    last = h.pose;
    poses.add(h.pose);
  }
  expect(poses.size).toBe(4);
  expect(steps).toBeGreaterThan((1.6 * 2.9) / FIGURE.strideM - 3);
  expect(steps).toBeLessThan((1.6 * 3) / FIGURE.strideM + 2);
  expect(changes).toBeGreaterThan(0);
  const fast = createGait();
  walk(fast, 0, 0.5, 0, -3.2);
  const ticks = walk(fast, 0.5, 1, 0, -3.2);
  const fastChanges = ticks.filter((f, i) => i > 0 && f.key !== ticks[i - 1]!.key).length;
  expect(fastChanges).toBeLessThanOrEqual(FIGURE.fps);
});

test('the view turns to the side past 62.5 degrees and back under 47.5, on a tick, edge-on for one tick', () => {
  const g = createGait();
  const at = (deg: number): [number, number] => [Math.sin(deg * DEG) * 1.5, -Math.cos(deg * DEG) * 1.5];
  walk(g, 0, 1, ...at(55));
  expect(g.view).toBe('back');
  const turn = walk(g, 1, 1, ...at(65));
  expect(g.view).toBe('side');
  expect(g.dir).toBe(1);
  const edgeTicks = new Set(turn.filter((f) => f.edge).map((f) => f.tick));
  expect(edgeTicks.size).toBe(1);
  expect(turn.find((f) => f.edge)?.view).toBe('side');
  walk(g, 2, 1, ...at(50));
  expect(g.view).toBe('side');
  walk(g, 3, 1, ...at(45));
  expect(g.view).toBe('back');
  walk(g, 4, 1, ...at(-70));
  expect([g.view, g.dir]).toEqual(['side', -1]);
});

test('walking south toward the lens turns the figure to the front, never a profile or a backward walk', () => {
  const g = createGait();
  walk(g, 0, 1, -1.5, 0);
  expect([g.view, g.dir]).toEqual(['side', -1]);
  walk(g, 1, 1.5, 0, 1.5);
  expect(g.view).toBe('front');
  walk(g, 2.5, 1, 0.6, 1.5);
  expect(g.view).toBe('front');
  walk(g, 3.5, 2, 0, 0);
  expect([g.view, g.idle]).toEqual(['front', true]);
  walk(g, 5.5, 1, 1.5, 0.5);
  expect([g.view, g.dir]).toEqual(['side', 1]);
});

test('standing: the idle pose, the back view at once after a profile, and the idle shift held for seconds', () => {
  const g = createGait();
  walk(g, 0, 1, 1.5, 0);
  expect(g.view).toBe('side');
  const stand = walk(g, 1, 12, 0, 0);
  expect(stand[Math.ceil((FIGURE.idleAfterS + 0.1) / DT)]!.view).toBe('back');
  expect(g.idle).toBe(true);
  expect(g.view).toBe('back');
  const shifts = stand.filter((f, i) => i > 0 && f.key !== stand[i - 1]!.key && f.key.startsWith('back')).length;
  expect(shifts).toBeGreaterThanOrEqual(2);
  expect(shifts).toBeLessThanOrEqual(6);
});

test('reduced motion keeps one standing pose: no cycle, no edge-on tick, no shift', () => {
  const g = createGait();
  const frames = walk(g, 0, 3, 1.5, -0.2, { reduced: true });
  expect(frames.every((f) => f.key.endsWith(' 0 true false 0'))).toBe(true);
  walk(g, 3, 12, 0, 0, { reduced: true });
  expect([g.idle, g.edge, g.shift, g.pose]).toEqual([true, false, 0, 0]);
});

test('frozen time gives the pose for heading and speed at once, the same on every run', () => {
  const run = (vx: number, vz: number): string => {
    const g = createGait();
    const puppet = createPuppet(rects);
    walk(g, 12.5, 0.2, vx, vz, { frozen: true });
    puppet.place(g, 1, 1, 1, g.view === 'side' ? g.dir : 1);
    return JSON.stringify(puppet.quads.map((q) => [q.x, q.y, q.rot, q.w, q.h, Array.from(q.uv)]));
  };
  expect(run(2, 0)).toBe(run(2, 0));
  const g = createGait();
  walk(g, 12.5, 0.2, 2, 0, { frozen: true });
  expect([g.view, g.dir, g.pose, g.idle, g.edge]).toEqual(['side', 1, 0, false, false]);
  walk(g, 12.5, 0.2, 0, 0, { frozen: true });
  expect(g.idle).toBe(true);
  const still = createGait();
  walk(still, 12.5, 0.2, 0, 0, { frozen: true });
  expect([still.view, still.idle]).toEqual(['back', true]);
});
