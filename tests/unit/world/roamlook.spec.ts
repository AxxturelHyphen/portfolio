import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { AtlasManifest, BedId } from '../../../src/types.ts';
import { DRESS_KIND, DRESS_STRIDE, LAWN, buildGround, pathDistance } from '../../../src/world/ground.ts';
import type { BedScene3, Placement3, WorldLayout } from '../../../src/world/layout.ts';
import { builtIn } from '../../../src/world/mode.ts';

// The second roam look pass (cook/ROAM_LOOK.md D to G, and the blind judge's faults): nothing planted under free roam
// reads as stamped, no plant copies a project flower, and the planting keeps the path, the stands and the flowers open.

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
const garden = json('content/garden.json') as WorldLayout;
const PATH_BEDS: readonly BedId[] = ['puerta', 'rosaleda', 'estanque', 'semillero', 'salida'];
const scenes = PATH_BEDS.map((b) => json(`content/beds/${b}.json`) as BedScene3);
const WALL_BAND = garden.ground.wall.z + 0.8;
/** The roam stand points of S13 to S17 (content/garden.json shots). */
const SHOTS = (garden as unknown as { shots: Record<string, { visitor?: [number, number] }> }).shots;
const STANDS: [number, number][] = ['S13', 'S14', 'S15', 'S16', 'S17'].map((s) => SHOTS[s]?.visitor ?? [0, 0]);
/** Plates that stand as single plants in a bed; reed blades are leaves of one clump and are left out. */
const PLANT = /^(w\/|ro\/comp-|sh\/clump-|se\/physalis|sa\/daisy)/;
const TWIN = 1.2;
const points = garden.ground.path.points;

const standing = (it: Placement3): boolean => builtIn(it, 'roam') && it.flat !== true && it.fade !== true && it.z > WALL_BAND && PLANT.test(it.sprite);

test('no two copies of one plant plate stand within 1.2 m under roam, in the beds or on the lawn', () => {
  const plants = scenes.flatMap((s) => s.layers.flatMap((l) => l.items)).filter(standing);
  for (let i = 0; i < plants.length; i++) {
    for (let j = i + 1; j < plants.length; j++) {
      const a = plants[i] as Placement3;
      const b = plants[j] as Placement3;
      if (a.sprite !== b.sprite) continue;
      expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.sprite} at ${a.x}, ${a.z} and ${b.x}, ${b.z}`).toBeGreaterThanOrEqual(TWIN);
    }
  }
  const g = buildGround(garden.ground, garden.order.map((b: BedId) => json(`content/beds/${b}.json`) as BedScene3), 'high', 'roam');
  const lawn: [number, number, number][] = [];
  for (let i = 0; i < g.dressCount; i++) {
    const o = i * DRESS_STRIDE;
    const kind = g.dress[o + 2] ?? 0;
    if (kind >= DRESS_KIND.plant || (kind >= DRESS_KIND.edge + 3 && kind < DRESS_KIND.plant)) lawn.push([kind, g.dress[o] ?? 0, g.dress[o + 1] ?? 0]);
  }
  for (let i = 0; i < lawn.length; i++) {
    for (let j = i + 1; j < lawn.length; j++) {
      const [ka, xa, za] = lawn[i] as [number, number, number];
      const [kb, xb, zb] = lawn[j] as [number, number, number];
      if (ka === kb) expect(Math.hypot(xa - xb, za - zb), `lawn kind ${ka}`).toBeGreaterThanOrEqual(LAWN.twin - 1e-4);
    }
  }
});

test('nothing built under roam copies a project flower plate', () => {
  for (const s of scenes) {
    const m = json(`public/atlas/${s.id}.json`) as AtlasManifest;
    const project = new Set(Object.values(m.blooms).flatMap((b) => [...(b.frames ?? []), ...(b.petals ?? []).map((p) => p.sprite)]));
    for (const it of s.layers.flatMap((l) => l.items)) {
      if (it.only === 'roam') expect(project.has(it.sprite), `${s.id} ${it.sprite} at ${it.x}, ${it.z}`).toBe(false);
    }
  }
});

test('roam plants keep off the path, a metre round each stand point and off the project flowers', () => {
  for (const s of scenes) {
    for (const it of s.layers.flatMap((l) => l.items)) {
      if (it.only !== 'roam' || !standing(it)) continue;
      const at = `${s.id} ${it.sprite} at ${it.x}, ${it.z}`;
      expect(pathDistance(points, it.x, it.z), at).toBeGreaterThanOrEqual(garden.ground.path.width / 2 + 0.45);
      for (const [sx, sz] of STANDS) expect(Math.hypot(it.x - sx, it.z - sz), at).toBeGreaterThanOrEqual(1);
      for (const sl of s.slots) if (sl.kind === 'project') expect(Math.hypot(it.x - sl.x, it.z - sl.z), at).toBeGreaterThanOrEqual(0.8);
    }
  }
});

test('each stand has its fading foreground frames in the near corners, each of a different plate', () => {
  scenes.forEach((s, i) => {
    const [sx, sz] = STANDS[i] ?? [0, 0];
    const frames = s.layers.flatMap((l) => l.items).filter((it) => it.only === 'roam' && it.fade === true && it.z > sz + 3);
    expect(frames.length, s.id).toBeGreaterThan(0);
    expect(new Set(frames.map((f) => f.sprite)).size, s.id).toBe(frames.length);
    for (const f of frames) expect(Math.abs(f.x - sx), `${s.id} ${f.sprite}`).toBeGreaterThanOrEqual(2.8);
  });
});
