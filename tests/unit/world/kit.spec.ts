import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { AtlasManifest, BedId, SpriteRect } from '../../../src/types.ts';
import { CLUMP_STRIDE, ROAM_BANDS, WALL_STRIDE, buildGround, pathDistance, shadowLengthAt, wallHeightAt } from '../../../src/world/ground.ts';
import { builtIn } from '../../../src/world/mode.ts';
import type { BedScene3, WorldLayout } from '../../../src/world/layout.ts';
import { MEMORY_KEY, createMemory, type KeyValue } from '../../../src/world/memory.ts';
import { placedSize, resolveSprite } from '../../../src/world/sprites.ts';

// Ground kit, garden memory and sprite fallback: pure parts of the world, no GPU.

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
const garden = json('content/garden.json') as WorldLayout;
const scenes = garden.order.map((b: BedId) => json(`content/beds/${b}.json`) as BedScene3);

test('clumps: at most 150 (80 on low), every cutout foot marked clump gets two, wall heights follow ART', () => {
  const high = buildGround(garden.ground, scenes, 'high');
  const low = buildGround(garden.ground, scenes, 'low');
  expect(high.clumpCount).toBeLessThanOrEqual(150);
  expect(high.clumpCount).toBeGreaterThan(100);
  expect(low.clumpCount).toBeLessThanOrEqual(80);
  const feet = scenes.flatMap((s) => s.layers.flatMap((l) => l.items)).filter((i) => i.foot === 'clump' && builtIn(i, 'rail')).length;
  expect(high.clumps.length).toBe(high.clumpCount * CLUMP_STRIDE);
  expect(high.clumpCount).toBeGreaterThanOrEqual(feet * 2);
  expect(high.wall.length).toBe(high.wallCount * WALL_STRIDE);
  expect(wallHeightAt(garden.ground, 10)).toBe(3.2);
  expect(wallHeightAt(garden.ground, 21)).toBe(1.2);
  expect(wallHeightAt(garden.ground, 40)).toBe(1.1);
  expect(shadowLengthAt(garden.ground, garden.anchors, 11)).toBe(0.5);
  expect(shadowLengthAt(garden.ground, garden.anchors, 42)).toBe(1.1);
});

test('free roam adds its grass bands: mostly along the path edges, never on the path, in the pond or past the end walls', () => {
  for (const tier of ['high', 'low'] as const) {
    const rail = buildGround(garden.ground, scenes, tier, 'rail');
    const roam = buildGround(garden.ground, scenes, tier, 'roam');
    const base = roam.clumpCount - ROAM_BANDS[tier];
    expect(base, tier).toBeLessThanOrEqual(garden.ground.clumps[tier]);
    expect(roam.clumpCount, tier).toBeGreaterThan(rail.clumpCount);
    expect(base, tier).toBeGreaterThan(0);
    expect(buildGround(garden.ground, scenes, tier, 'roam').dress).toEqual(roam.dress);
    const half = garden.ground.path.width / 2;
    const p = garden.ground.pond;
    let edge = 0;
    for (let i = base; i < roam.clumpCount; i++) {
      const x = roam.clumps[i * CLUMP_STRIDE]!;
      const z = roam.clumps[i * CLUMP_STRIDE + 1]!;
      const d = pathDistance(garden.ground.path.points, x, z);
      expect(d).toBeGreaterThanOrEqual(half + ROAM_BANDS.edgeOff[0] - 1e-6);
      expect(((x - p.x) / p.rx) ** 2 + ((z - p.z) / p.rz) ** 2).toBeGreaterThan(1);
      expect(x > garden.ground.enclosure.x[0] && x < garden.ground.enclosure.x[1]).toBe(true);
      if (d < half + ROAM_BANDS.edgeOff[1] + 0.3) edge++;
    }
    expect(edge / ROAM_BANDS[tier]).toBeGreaterThan(0.5);
  }
});

function store(initial: string | null, fail = false): KeyValue & { data: string | null } {
  return {
    data: initial,
    getItem() { if (fail) throw new Error('blocked'); return this.data; },
    setItem(_k, v) { if (fail) throw new Error('blocked'); this.data = v; },
  };
}

test('the garden remembers visited flowers across visits and survives blocked storage', () => {
  const s = store(null);
  const a = createMemory(s);
  const heard: string[] = [];
  a.onVisit((id) => heard.push(id));
  expect(a.visit('garagic')).toBe(true);
  expect(a.visit('garagic')).toBe(false);
  expect(heard).toEqual(['garagic']);
  expect(JSON.parse(s.data ?? '[]')).toEqual(['garagic']);
  expect(createMemory(s).visited('garagic')).toBe(true);
  const blocked = createMemory(store(null, true));
  expect(blocked.visit('x')).toBe(true);
  expect(blocked.visited('x')).toBe(true);
  expect(createMemory(store('{not json')).visited('x')).toBe(false);
  expect(MEMORY_KEY).toBe('jardin.visited');
});

const rect = (page: number, w: number, h: number): SpriteRect => ({ page, uv: [0, 0, 1, 1], size: [w, h], pivot: [0.5, 0], pad: 8, sources: [] });
const bedM = { id: 'rosaleda', hash: '', pages: [], sprites: { 'ro/hero-a': rect(1, 1, 2), tall: rect(0, 1, 5), small: rect(0, 0.4, 0.5), band: rect(0, 9, 2), 'rose.f0': rect(1, 1, 1) }, blooms: { rose: { kind: 'rose', mode: 'frames', steps: 2, frames: ['rose.f0'], rest: { idea: 0, wip: 0, shipped: 1 } } } } as AtlasManifest;
const sharedM = { id: 'shared', hash: '', pages: [], sprites: { 'sh/pot-a': rect(0, 1, 1) }, blooms: {} } as AtlasManifest;

test('sprites resolve in the right atlas and a missing id draws nothing (no stand-in, no placeholder)', () => {
  expect(resolveSprite('ro/hero-a', bedM, sharedM)).toMatchObject({ from: 'bed' });
  expect(resolveSprite('sh/pot-a', bedM, sharedM)).toMatchObject({ from: 'shared' });
  expect(resolveSprite('ro/missing', bedM, sharedM)).toBeNull();
  const withPlaceholder = { ...sharedM, sprites: { ...sharedM.sprites, placeholder: rect(0, 1, 1) } };
  expect(resolveSprite('v/bench', bedM, withPlaceholder)).toBeNull();
  expect(placedSize(rect(0, 2, 1), undefined, 1.3, 1, [0, 0])).toEqual([1.3, 0.65]);
  expect(placedSize(rect(0, 2, 1), 0.5, undefined, 2, [0, 0])).toEqual([2, 1]);
});
