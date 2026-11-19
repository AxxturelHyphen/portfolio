import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import puerta from '../../../content/beds/puerta.json' with { type: 'json' };
import rosaleda from '../../../content/beds/rosaleda.json' with { type: 'json' };
import estanque from '../../../content/beds/estanque.json' with { type: 'json' };
import semillero from '../../../content/beds/semillero.json' with { type: 'json' };
import salida from '../../../content/beds/salida.json' with { type: 'json' };
import type { BedScene3 } from '../../../src/world/layout.ts';
import { createLampPool, findLamps, LAMPS, lampBedsOf, stepLamps } from '../../../src/world/lamps.ts';
import type { AtlasManifest, Clock, InstanceWriter, QuadParams, SpriteRect } from '../../../src/types.ts';
import { SLOT, type FigureRects } from '../../../src/world/puppet.ts';
import { CROOK_QUADS, createPendulum, createVisitorLantern, HELD, PENDULUM, stepPendulum, VISITOR_QUADS } from '../../../src/world/visitor.ts';

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

const ORDER = ['puerta', 'rosaleda', 'estanque', 'semillero', 'gruta', 'salida'] as const;
const LANTERNS = { puerta, rosaleda, estanque, semillero, salida } as const;
const lit = (lamps: Float32Array): number[] => [1, 2, 3, 4, 5].map((j) => lamps[j * 4 + 3]!);

test('every path bed burns lanterns under free roam, found with its neighbours, rail-only ones left out', () => {
  const pool = createLampPool();
  const lamps = new Float32Array(LAMPS.count * 4);
  for (const [bed, s] of Object.entries(LANTERNS)) expect(findLamps([scene(s)], pool, lamps), bed).toBeGreaterThanOrEqual(1);
  expect(findLamps([scene(puerta)], pool, lamps)).toBe(2);
  expect(pool.at[0]).toBeCloseTo(1.6, 5);
  expect(pool.at[1]).toBeGreaterThan(0.1);
  expect(findLamps([], pool, lamps)).toBe(0);
  const many = { layers: [{ items: Array.from({ length: 20 }, (_, i) => ({ sprite: 'sh/lantern-tin', x: i, y: 0, z: 0, scale: 1, h: 0.4 })) }] };
  expect(findLamps([scene(many)], pool, lamps)).toBe(LAMPS.candidates);
  expect(lampBedsOf(ORDER, 'puerta')).toEqual(['puerta', 'rosaleda']);
  expect(lampBedsOf(ORDER, 'semillero')).toEqual(['estanque', 'semillero', 'salida']);
  expect(lampBedsOf(ORDER, 'gruta')).toEqual(['gruta']);
});

test('the carried lantern is lamp 0 at full strength; the standing lamps nearest the visitor on screen burn', () => {
  const pool = createLampPool();
  const lamps = new Float32Array(LAMPS.count * 4);
  const row = { layers: [{ items: [0, 2, 4, 6, 8, 10, 12].map((x) => ({ sprite: 'sh/lantern-cage', x, y: 0, z: -2, scale: 1, h: 0.45 })) }] };
  expect(findLamps([scene(row)], pool, lamps)).toBe(7);
  const all = (): boolean => true;
  stepLamps(lamps, 5.5, 0.7, -1, pool, LAMPS.standing, all, DT, true);
  expect([...lamps.subarray(0, 4)].map((v) => Math.round(v * 100) / 100)).toEqual([5.5, 0.7, -1, 1]);
  expect(lit(lamps)).toEqual([1, 1, 1, 1, 1]);
  const burning = [1, 2, 3, 4, 5].map((j) => lamps[j * 4]!).sort((a, b) => a - b);
  expect(burning).toEqual([2, 4, 6, 8, 10]);
  stepLamps(lamps, 5.5, 0.7, -1, pool, LAMPS.standingLow, all, DT, true);
  expect(lit(lamps).filter((v) => v === 1)).toHaveLength(LAMPS.standingLow);
  expect(lit(lamps).reduce((a, b) => a + b, 0)).toBe(LAMPS.standingLow);
});

test('a lamp leaving the pick dims before another takes its slot, so no pool pops', () => {
  const pool = createLampPool();
  const lamps = new Float32Array(LAMPS.count * 4);
  const two = { layers: [{ items: [0, 20].map((x) => ({ sprite: 'sh/lantern-cage', x, y: 0, z: 0, scale: 1, h: 0.45 })) }] };
  findLamps([scene(two)], pool, lamps);
  stepLamps(lamps, 0, 0.7, 0, pool, 1, () => true, DT, true);
  expect(lamps[4]).toBe(0);
  expect(lamps[7]).toBe(1);
  stepLamps(lamps, 20, 0.7, 0, pool, 1, () => true, DT, false);
  expect(lamps[4]).toBe(0);
  expect(lamps[7]).toBeGreaterThan(0.9);
  for (let i = 0; i < 240; i++) stepLamps(lamps, 20, 0.7, 0, pool, 1, () => true, DT, false);
  expect(lamps[4]).toBe(20);
  expect(lamps[7]).toBeGreaterThan(0.99);
  for (let i = 0; i < 240; i++) stepLamps(lamps, 20, 0.7, 0, pool, 1, () => false, DT, false);
  expect(lamps[7]).toBe(0);
});

test('a bed change keeps a burning lantern in its slot at its strength', () => {
  const pool = createLampPool();
  const lamps = new Float32Array(LAMPS.count * 4);
  findLamps([scene(rosaleda)], pool, lamps);
  stepLamps(lamps, 11.6, 0.7, -0.3, pool, LAMPS.standing, () => true, DT, true);
  const before = lit(lamps);
  findLamps([scene(rosaleda), scene(estanque)], pool, lamps);
  expect(lit(lamps)).toEqual(before);
});

// The figure's page (cook/FIGURE_BUILD.md 4): the visitor batch before and after it arrives.

const roam = JSON.parse(readFileSync(new URL('../../../public/atlas/roam.json', import.meta.url), 'utf8')) as AtlasManifest;
const sprite = (id: string): SpriteRect => roam.sprites[id as keyof typeof roam.sprites]!;

/** A writer that keeps copies of what was set, with the batch's fixed capacity. */
function fakeWriter(capacity: number): InstanceWriter & { quads: Map<number, QuadParams>; commits: number } {
  const quads = new Map<number, QuadParams>();
  let count = 0;
  return {
    capacity, quads, commits: 0,
    get count() { return count; },
    set count(n: number) { count = Math.min(capacity, Math.max(0, n)); },
    set(i, p) { quads.set(i, { ...p, uv: Array.from(p.uv), tint: Array.from(p.tint) }); },
    commit() { this.commits++; },
  };
}
const clock = (t: number, frozen = false): Clock => ({ now: t * 1000, dt: 1 / 60, t, frame: Math.round(t * 60), frozen });

test('the actor batch holds the figure: 14 instances, 6 until the roam page is in, the figure on the next step', () => {
  expect(VISITOR_QUADS).toBe(14);
  expect(CROOK_QUADS).toBe(6);
  const pos = new Float32Array([2, -1]);
  const v = createVisitorLantern(pos, null);
  const w = fakeWriter(VISITOR_QUADS);
  v.attach(w, sprite('fg/lantern'));
  v.resize(1920, 1080);
  v.frame(clock(1), false);
  expect([w.count, v.figure]).toEqual([CROOK_QUADS, false]);
  let shown = 0;
  v.attachFigure(roam.sprites as unknown as FigureRects, sprite('fg/lantern'), sprite('fg/crook'), () => shown++);
  v.frame(clock(1 + 0.2 / 60), false);
  expect([w.count, v.figure, shown]).toEqual([CROOK_QUADS, false, 0]);
  v.frame(clock(1 + 1 / 12), false);
  expect([w.count, v.figure, shown]).toEqual([VISITOR_QUADS, true, 1]);
  for (let i = 0; i < VISITOR_QUADS; i++) expect(w.quads.has(i)).toBe(true);
});

test('the held lantern hangs from the fist at its handle, its flame on the lantern', () => {
  const pos = new Float32Array([2, -1]);
  const v = createVisitorLantern(pos, null);
  const w = fakeWriter(VISITOR_QUADS);
  v.attach(w, sprite('fg/lantern'));
  v.resize(1920, 1080);
  v.attachFigure(roam.sprites as unknown as FigureRects, sprite('fg/lantern'), sprite('fg/crook'), () => undefined);
  for (let i = 0; i < 3; i++) v.frame(clock(12.5, true), false);
  const lamp = w.quads.get(SLOT.lantern)!;
  expect(lamp.w).toBeCloseTo(sprite('fg/lantern').size[0] * HELD.scaleWide, 6);
  expect(lamp.h).toBeCloseTo(sprite('fg/lantern').size[1] * HELD.scaleWide, 6);
  expect(v.flame[0]).toBeCloseTo(lamp.x, 6);
  expect(v.flame[2]).toBe(-1);
  expect(v.flame[1]).toBeGreaterThan(lamp.y);
  expect(v.flame[1]).toBeLessThan(lamp.y + lamp.h);
  const handle = w.quads.get(SLOT.handle)!;
  expect(handle.y).toBeGreaterThan(0.5);
  expect(Math.abs(v.flame[0]! - 2)).toBeLessThan(0.6);
});

test('until the page is in, and if it never comes, the lantern hangs on its planted crook as before', () => {
  const pos = new Float32Array([2, -1]);
  const v = createVisitorLantern(pos, null);
  const w = fakeWriter(VISITOR_QUADS);
  v.attach(w, sprite('fg/lantern'));
  v.resize(1920, 1080);
  for (let i = 0; i < 30; i++) v.frame(clock(12.5, true), false);
  expect([w.count, v.figure]).toEqual([CROOK_QUADS, false]);
  expect(w.quads.get(CROOK_QUADS - 1)!.w).toBeCloseTo(sprite('fg/lantern').size[0] * 1.4, 6);
  expect(w.quads.get(0)!.x).toBe(2);
});
