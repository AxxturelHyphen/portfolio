import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { projectsOf } from '../../../src/content/load.ts';
import { BED_IDS, bindSlots, keptLayers, validateBedScene, validateGarden } from '../../../src/world/scene.ts';
import type { BedId, Profile, Project } from '../../../src/types.ts';
import type { BedScene3 } from '../../../src/world/layout.ts';

// Build-time checks of content/garden.json and content/beds/*.json against cook/ART.md sections 1 and 2.

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
const garden = validateGarden(json('content/garden.json'));
const profile = json('content/profile.json') as Profile;
const scenes = Object.fromEntries(BED_IDS.map((b) => [b, validateBedScene(json(`content/beds/${b}.json`), b)])) as Record<BedId, BedScene3>;
const projectsFor = (b: BedId): Project[] => (b === 'rosaleda' || b === 'estanque' || b === 'semillero' ? projectsOf(b) : []);
const bind = (b: BedId, projects = projectsFor(b)) => bindSlots({ scene: scenes[b], projects, profile, lang: 'en' });
const items = (s: BedScene3) => s.layers.flatMap((l) => l.items);

test('garden layout: beds in order, grotto under the Semillero, rail shots S01 to S12, roam shots S13 to S18, ART film poses', () => {
  expect(garden.order).toEqual(['puerta', 'rosaleda', 'estanque', 'semillero', 'gruta', 'salida']);
  expect(garden.grutaHost).toBe('semillero');
  expect(Object.keys(garden.shots).sort()).toEqual(Array.from({ length: 18 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`));
  const shots: Record<string, { hash: string; visitor?: readonly number[] }> = garden.shots;
  expect(Object.keys(shots).filter((id) => shots[id]?.visitor !== undefined).sort(), 'roam shots name a visitor position').toEqual(['S13', 'S14', 'S15', 'S16', 'S17', 'S18']);
  expect(garden.shots['S11']?.viewport).toEqual([390, 844]);
  expect(garden.shots['S18']?.viewport).toEqual([390, 844]);
  // S03 and S08 are lens close-ups from the live Rosaleda stop; S04 and S06 are the live Estanque and Puerta stops.
  expect(garden.film['S03']).toEqual({ x: 11.6, y: 2.4, z: 3.2, pitch: -12, yaw: -1.7, fov: 10 });
  expect(garden.film['S04']).toEqual({ x: 21, y: 2.1, z: 7.2, pitch: -7, yaw: 0, fov: 34 });
  expect(garden.film['S05']).toEqual({ x: 30.06, y: 2.2, z: 7.64, pitch: -10, yaw: 0, fov: 13.7 });
  expect(garden.film['S06']).toEqual({ x: 1.7, y: 1.7, z: 1.2, pitch: -6, yaw: -10, fov: 44 });
  // S02 (cook/SHOTS.md C): camera at 2.2 m, tilted down 6 degrees, wide; the overview is that pose.
  expect(garden.overview).toEqual({ x: 22.5, y: 2.2, z: 8, pitch: -6, fov: 44 });
  expect(garden.film['S02']).toEqual({ ...garden.overview, yaw: 0 });
});

test('the rail has five bed stops and four gap keys; each bed pose is its key', () => {
  const keys = garden.rail.keys;
  expect(keys.map((k) => k.x)).toEqual([1.7, 5.4, 11.6, 15.4, 21.0, 26.0, 30.2, 36.2, 41.6]);
  expect(keys.filter((k) => k.bed !== undefined).map((k) => k.bed)).toEqual(['puerta', 'rosaleda', 'estanque', 'semillero', 'salida']);
  for (const k of keys) {
    if (k.bed === undefined) continue;
    expect(scenes[k.bed].pose).toEqual({ x: k.x, y: k.y, z: k.z, pitch: k.pitch, fov: k.fov });
  }
  expect(garden.rail.off.gruta).toEqual(garden.film['S12']);
});

test('every project binds to a slot of its bed, at its world position', () => {
  const bound = BED_IDS.flatMap((b) => bind(b).filter((v) => v.kind === 'project').map((v) => [v.project?.id, v.id]));
  expect(Object.fromEntries(bound)).toEqual({
    garagic: 'rosaleda/rose-a', 'php-playground': 'rosaleda/rose-b', 'adhd-guija': 'estanque/lily-a', 'ml-math': 'semillero/pod-a', 'ai-engineering': 'semillero/bud-a',
  });
  // The bloom's pedicel sits where the plate's flower was cut from the stem (R02 finding 1: no bloom in mid-air).
  expect(bind('rosaleda').find((v) => v.id === 'rosaleda/rose-a')?.world).toEqual([11.88, 1.39, -1.63]);
  const cards = bind('salida').filter((v) => v.kind === 'link');
  expect(cards.map((v) => v.id)).toEqual(['salida/postcard-a', 'salida/postcard-b', 'salida/postcard-c']);
  expect(BED_IDS.flatMap((b) => bind(b).filter((v) => v.kind === 'prop').map((v) => v.id))).toEqual(['puerta/portrait', 'estanque/sundial', 'semillero/ivy', 'gruta/coupe']);
});

test('more projects than slots fails with a readable error', () => {
  const extra = projectsFor('estanque').flatMap((p) => [p, { ...p, id: `${p.id}-2` }, { ...p, id: `${p.id}-3` }]);
  expect(() => bind('estanque', extra)).toThrow(/no free "lily" slot/);
});

test('Rosaleda follows ART 2.2: hero at its pot, at most 18 cutout sprites, gap vignettes at most 5', () => {
  const r = items(scenes.rosaleda);
  const hero = r.find((i) => i.sprite === 'ro/hero-a');
  expect(hero).toMatchObject({ x: 11.8, z: -1.5, hinge: -4, group: 'L', foot: 'pot' });
  const counted = new Set(r.filter((i) => i.wing !== true && !/^(w\/|v\/|sh\/(ivy|board|clump))/.test(i.sprite)).map((i) => i.sprite));
  expect(counted.size).toBeLessThanOrEqual(18);
  for (const id of ['gap-1', 'gap-2']) {
    const l = scenes.rosaleda.layers.find((x) => x.id === id);
    expect(new Set(l?.items.map((i) => i.sprite)).size, id).toBeLessThanOrEqual(5);
  }
  expect(r.filter((i) => i.wing === true).every((i) => i.z > 1)).toBe(true);
});

test('standing cutouts lean 8 degrees back; architecture and hanging pieces stand straight; no two Rosaleda neighbours share a hinge', () => {
  for (const b of BED_IDS) for (const i of items(scenes[b])) expect([0, 8], `${b} ${i.sprite}`).toContain(i.lean);
  const roses = items(scenes.rosaleda).filter((i) => i.sprite.startsWith('ro/comp') || i.sprite.startsWith('ro/rose') || i.sprite === 'ro/hero-a');
  expect(new Set(roses.map((i) => i.hinge)).size).toBe(roses.length);
});

test('low tier keeps every page group marked low', () => {
  for (const b of BED_IDS) {
    const low = keptLayers(scenes[b], 'low', 12);
    expect(low.every((l) => l.minTier === 'low'), b).toBe(true);
    expect(keptLayers(scenes[b], 'high', 12)).toEqual(scenes[b].layers);
  }
});
