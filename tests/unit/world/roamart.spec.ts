import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Mesh } from 'three';
import type { AtlasManifest, BedId, CutoutBatch, QuadParams } from '../../../src/types.ts';
import { buildBed } from '../../../src/world/bed.build.ts';
import { writeDressing } from '../../../src/world/dressing.ts';
import { DRESS_KIND, DRESS_STRIDE, LAWN, buildGround, pathZAt } from '../../../src/world/ground.ts';
import type { BedScene3, Placement3, WorldLayout } from '../../../src/world/layout.ts';
import type { WorldMode } from '../../../src/world/mode.ts';
import { QUAD_FLAG } from '../../../src/world/quadflags.ts';

// The roam art (cook/ROAM_ART.md 2): items marked `only` are built for one camera, and the near ground under free roam
// is planted as clusters with lit lanes between them, clear of the path band and the flower slots.

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
const garden = json('content/garden.json') as WorldLayout;
const scenes = garden.order.map((b: BedId) => json(`content/beds/${b}.json`) as BedScene3);
const shared = json('public/atlas/shared.json') as AtlasManifest;
const PATH_BEDS: readonly BedId[] = ['puerta', 'rosaleda', 'estanque', 'semillero', 'salida'];

/** A batch that keeps what is written to it, for reading the built quads back. */
function batchOf(written: QuadParams[]): (from: unknown, page: number, capacity: number) => CutoutBatch {
  return (_from, _page, capacity) => ({
    mesh: { add() {} } as unknown as Mesh,
    uniforms: {} as CutoutBatch['uniforms'],
    dispose() {},
    writer: { capacity, count: 0, set: (_i, q) => { written.push({ ...q, tint: Array.from(q.tint) }); }, commit() {} },
  });
}

function built(scene: BedScene3, mode: WorldMode): QuadParams[] {
  const written: QuadParams[] = [];
  const bed = { manifest: { id: scene.id, hash: '', pages: [], sprites: {}, blooms: {} } as AtlasManifest, tex: { color: [], normal: [], gpuBytes: 0 } };
  buildBed({
    scene, tier: 'high', maxLayers: 12, mode, bed, shared: { manifest: shared, tex: bed.tex }, slots: [],
    visited: () => false, reduced: { state: { reduced: false } }, createBatch: batchOf(written),
  });
  return written;
}

const item = (x: number, only?: WorldMode): Placement3 => ({
  sprite: 'v/can', x, y: 0, z: 1, scale: 1, h: 0.3, hinge: 0, lean: 8, size: 'small', group: 'M', foot: 'none', shadow: true, react: false,
  ...(only === undefined ? {} : { only }),
});
const scene = (items: Placement3[]): BedScene3 => ({ ...(scenes[0] as BedScene3), layers: [{ id: 'verge', z: 1, minTier: 'low', page: 0, items }], slots: [] });

test('an item marked rail is built on the rail only, one marked roam under roam only, an unmarked one in both', () => {
  const s = scene([item(1), item(2, 'rail'), item(3, 'roam')]);
  expect(built(s, 'rail').map((q) => q.x).sort()).toEqual([1, 2]);
  expect(built(s, 'roam').map((q) => q.x).sort()).toEqual([1, 3]);
});

test('every near wing of the path beds is a rail mask: none is built under roam, all are on the rail', () => {
  for (const b of PATH_BEDS) {
    const s = scenes.find((x) => x.id === b) as BedScene3;
    const wings = s.layers.flatMap((l) => l.items).filter((i) => i.wing === true);
    expect(wings.length, b).toBeGreaterThan(0);
    expect(wings.every((i) => i.only === 'rail'), b).toBe(true);
  }
});

/** Standing lawn plants: x, z, height. */
function lawnPlants(): [number, number, number][] {
  const g = buildGround(garden.ground, scenes, 'high', 'roam');
  const out: [number, number, number][] = [];
  for (let i = 0; i < g.dressCount; i++) {
    const o = i * DRESS_STRIDE;
    const kind = g.dress[o + 2] ?? 0;
    expect(kind, 'no leafy plant under roam').not.toBe(DRESS_KIND.leafy);
    if (kind >= DRESS_KIND.plant) out.push([g.dress[o] ?? 0, g.dress[o + 1] ?? 0, g.dress[o + 4] ?? 0]);
  }
  return out;
}

/** Plants joined when closer than `gap`: the clusters as the eye groups them. */
function clustersOf(plants: readonly [number, number, number][], gap: number): number[][] {
  const group = plants.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : root(group[i] ?? i));
  for (let i = 0; i < plants.length; i++) {
    for (let j = i + 1; j < plants.length; j++) {
      const [ax, az] = plants[i] ?? [0, 0];
      const [bx, bz] = plants[j] ?? [0, 0];
      if (Math.hypot(ax - bx, az - bz) < gap) group[root(j)] = root(i);
    }
  }
  const by = new Map<number, number[]>();
  plants.forEach((_, i) => by.set(root(i), [...(by.get(root(i)) ?? []), i]));
  return [...by.values()];
}

test('the roam lawn: plants 0.25 to 1.1 m in fewer clusters of at most 7 that frame the projects and the path, lanes of 1.5 m between, the path band and slots clear', () => {
  const plants = lawnPlants();
  const edge = garden.ground.path.width / 2 + LAWN.clear;
  for (const [x, z, h] of plants) {
    expect(h).toBeGreaterThanOrEqual(0.25);
    expect(h).toBeLessThanOrEqual(1.1);
    expect(z).toBeLessThanOrEqual(LAWN.farZ);
    expect(z - pathZAt(garden.ground.path.points, x)).toBeGreaterThanOrEqual(edge - 1e-4);
    for (const s of scenes) for (const sl of s.slots) expect(Math.hypot(sl.x - x, sl.z - z), `${s.id}/${sl.id}`).toBeGreaterThanOrEqual(LAWN.slotClear - 1e-4);
  }
  const clusters = clustersOf(plants, LAWN.lane);
  expect(Math.max(...clusters.map((c) => c.length))).toBeLessThanOrEqual(LAWN.few + LAWN.more - 1);
  expect(clusters.length / garden.ground.length).toBeGreaterThan(0.15);
  expect(clusters.length / garden.ground.length, 'fewer, prettier: clean ground between the groups').toBeLessThan(0.5);
  const projects = scenes.flatMap((s) => s.slots.filter((sl) => sl.kind === 'project').map((sl) => sl.x));
  const framing = clusters.filter((c) => c.some((i) => {
    const [x, z] = plants[i] ?? [0, 0];
    return projects.some((px) => Math.abs(px - x) < 3) || z - pathZAt(garden.ground.path.points, x) < edge + 1.5;
  }));
  expect(framing.length / clusters.length, 'most groups frame a project flower or the path edge').toBeGreaterThan(0.6);
  expect(plants.some(([, , h]) => h > 0.9)).toBe(true);
});

test('the roam dressing has no silhouette and no night tint; the rail dressing is left as it was', () => {
  const tints: number[][] = [];
  let flagged = 0;
  const written: QuadParams[] = [];
  writeDressing(buildGround(garden.ground, scenes, 'high', 'roam'), shared, (page, capacity) => batchOf(written)('shared', page, capacity));
  for (const q of written) {
    if ((Math.floor(q.phase / 8) & QUAD_FLAG.silhouette) !== 0) flagged++;
    tints.push(Array.from(q.tint).slice(0, 3));
  }
  expect(written.length).toBeGreaterThan(0);
  expect(flagged).toBe(0);
  expect(Math.min(...tints.flat())).toBeGreaterThan(0.5);
  const rail = buildGround(garden.ground, scenes, 'high', 'rail');
  expect(buildGround(garden.ground, scenes, 'high')).toEqual(rail);
});
