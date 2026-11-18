import { expect, test } from '@playwright/test';
import garden from '../../../content/garden.json' with { type: 'json' };
import { ASSIST, createAssistWalk, pathArc } from '../../../src/world/assist.ts';
import { pathZ } from '../../../src/world/roam.ts';

// Assisted walking (cook/ROAM_PLAN.md section 3, P6): along the garden path at up to about 6 m/s with eased starts and
// stops; over more than one bed a walk out, one cut while the film strip runs, and a walk in to the stand point.

const points = garden.ground.path.points as [number, number][];
const DT = 1 / 60;
const at = (x: number): [number, number] => [x, pathZ(points, x)];

interface Run { xs: number[]; legs: number[]; jumps: number[]; frames: number }

function run(x0: number, x1: number, hops: number): Run {
  const w = createAssistWalk(points);
  w.start(x0, x1, hops);
  const out: Run = { xs: [w.x], legs: [0], jumps: [], frames: 0 };
  for (let f = 0; f < 2000 && w.active; f++) {
    w.step(DT);
    out.xs.push(w.x);
    out.legs.push(w.leg);
    if (w.jumped) out.jumps.push(out.xs.length - 1);
    out.frames++;
  }
  return out;
}

/** Ground speeds (m/s) between frames along the path, leaving out the frames that cut. */
function speeds(r: Run): number[] {
  const v: number[] = [];
  for (let i = 1; i < r.xs.length; i++) {
    if (r.jumps.includes(i)) continue;
    const [ax, az] = at(r.xs[i - 1]!);
    const [bx, bz] = at(r.xs[i]!);
    v.push(Math.hypot(bx - ax, bz - az) / DT);
  }
  return v;
}

test('arc length along the path runs both ways and holds at the ends', () => {
  const arc = pathArc(points);
  for (const x of [-0.2, 0, 5, 17.4, 33.5, 44, 45.2]) expect(arc.xAt(arc.arcAt(x))).toBeCloseTo(x, 6);
  expect(arc.arcAt(-5)).toBe(0);
  expect(arc.xAt(1e6)).toBeCloseTo(points[points.length - 1]![0], 9);
});

test('a neighbour walk follows the path at up to about 6 m/s, eases in and out, lands on the stand point', () => {
  for (const [x0, x1] of [[0, 10], [10, 20], [30, 42], [42, 30], [20, 10]] as const) {
    const r = run(x0, x1, 1);
    const v = speeds(r);
    expect(Math.max(...v), `${x0} to ${x1}: top speed`).toBeLessThanOrEqual(6.05);
    expect(Math.max(...v), `${x0} to ${x1}: walks briskly`).toBeGreaterThan(4.5);
    expect(v[0]!, 'starts from rest').toBeLessThan(0.6);
    expect(v[v.length - 1]!, 'stops at rest').toBeLessThan(0.6);
    expect(r.xs[r.xs.length - 1], 'lands on the stand point').toBe(x1);
    expect(r.jumps, 'no cut').toEqual([]);
    expect(Math.max(...r.legs), 'no film strip').toBe(0);
    expect(r.frames * DT, 'takes a few seconds').toBeGreaterThan(1.5);
    expect(r.frames * DT).toBeLessThan(4);
  }
});

test('over more than one bed: a walk out, one cut while the strip runs, a walk in; no visible step over 6 m/s', () => {
  const r = run(0, 30, 3);
  expect(r.jumps, 'one cut').toHaveLength(1);
  const cut = r.jumps[0]!;
  expect(r.legs[cut], 'the strip runs at the cut').toBeGreaterThan(0.2);
  expect(r.legs[cut]).toBeLessThan(0.8);
  expect(Math.max(...r.legs), 'the strip runs to its end').toBeGreaterThan(0.95);
  const stripFrom = r.legs.findIndex((l) => l > 0);
  const stripTo = r.legs.findLastIndex((l) => l > 0);
  const arc = pathArc(points);
  const out = arc.arcAt(r.xs[stripFrom]!) - arc.arcAt(0);
  const back = arc.arcAt(30) - arc.arcAt(r.xs[stripTo]!);
  expect(out, 'walked out a few steps before the strip').toBeCloseTo(ASSIST.outM, 0);
  expect(back, 'walks in a few steps after it').toBeCloseTo(ASSIST.inM, 0);
  expect(r.xs[cut]! - r.xs[cut - 1]!, 'the cut skips ahead').toBeGreaterThan(5);
  expect(Math.max(...speeds(r)), 'visible speed').toBeLessThanOrEqual(6.05);
  expect(r.xs[r.xs.length - 1]).toBe(30);
  const back2 = run(42, 20, 2);
  expect(back2.jumps, 'westward too').toHaveLength(1);
  expect(back2.xs[back2.xs.length - 1]).toBe(20);
});

test('frozen time and zero distance land at once; a short hop still eases and lands', () => {
  const w = createAssistWalk(points);
  w.start(0, 30, 3);
  w.step(Infinity);
  expect(w.active).toBe(false);
  expect(w.x).toBe(30);
  expect(w.u).toBe(1);
  w.start(12, 12, 1);
  expect(w.active, 'nothing to walk').toBe(false);
  expect(w.u).toBe(1);
  const r = run(12, 12.4, 1);
  expect(r.xs[r.xs.length - 1]).toBe(12.4);
  expect(Math.max(...speeds(r))).toBeLessThan(2);
});

test('cancel stops the walk and the strip at once', () => {
  const w = createAssistWalk(points);
  w.start(0, 30, 3);
  for (let i = 0; i < 40; i++) w.step(DT);
  expect(w.leg).toBeGreaterThan(0);
  w.cancel();
  expect(w.active).toBe(false);
  expect(w.hops).toBe(0);
  expect(w.leg).toBe(0);
});
