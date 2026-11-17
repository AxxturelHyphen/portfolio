import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { projectsOf } from '../../../src/content/load.ts';
import { BED_IDS, bindSlots, keptLayers, validateBedScene, validateGarden } from '../../../src/world/scene.ts';
import type { BedId, BedScene, Profile, Project } from '../../../src/types.ts';

// Build-time checks of content/garden.json and content/beds/*.json (cook/ARCH.md 2.6): schema, slot binding with
// the real projects (more projects than slots fails here, so in npm run check), tier filtering.

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
const garden = validateGarden(json('content/garden.json'));
const profile = json('content/profile.json') as Profile;
const scenes = Object.fromEntries(BED_IDS.map((b) => [b, validateBedScene(json(`content/beds/${b}.json`), b)])) as Record<BedId, BedScene>;
const projectsFor = (b: BedId): Project[] => (b === 'rosaleda' || b === 'estanque' || b === 'semillero' ? projectsOf(b) : []);
const bind = (b: BedId, projects = projectsFor(b)) =>
  bindSlots({ scene: scenes[b], anchorX: garden.anchors[b], projects, profile, lang: 'en' });

test('garden layout: six beds in order, the grotto hosted by the Semillero, shots S01 to S12', () => {
  expect(garden.order).toEqual(['puerta', 'rosaleda', 'estanque', 'semillero', 'gruta', 'salida']);
  expect(garden.grutaHost).toBe('semillero');
  expect(Object.keys(garden.shots).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`));
  for (const s of Object.values(garden.shots)) expect(s.t).toBeGreaterThanOrEqual(0);
  expect(garden.shots['S11']?.viewport).toEqual([390, 844]);
});

test('every project binds to a slot of its bed', () => {
  const bound = BED_IDS.flatMap((b) => bind(b).filter((v) => v.kind === 'project').map((v) => [v.project?.id, v.id]));
  expect(Object.fromEntries(bound)).toEqual({
    garagic: 'rosaleda/rose-a',
    'php-playground': 'rosaleda/rose-b',
    'adhd-guija': 'estanque/lily-a',
    'ml-math': 'semillero/pod-a',
    'ai-engineering': 'semillero/bud-a',
  });
});

test('slot views carry world positions, links and props', () => {
  const rose = bind('rosaleda').find((v) => v.id === 'rosaleda/rose-a');
  expect(rose?.world).toEqual([garden.anchors.rosaleda + 1, 1.6, -1.2]);
  const cards = bind('salida').filter((v) => v.kind === 'link');
  expect(cards.map((v) => v.id)).toEqual(['salida/postcard-a', 'salida/postcard-b', 'salida/postcard-c']);
  expect(cards[0]?.href).toBe(profile.links.find((l) => l.key === 'github')?.href);
  expect(cards[1]?.href, '[FILL] hrefs are not links').toBeUndefined();
  const props = BED_IDS.flatMap((b) => bind(b).filter((v) => v.kind === 'prop').map((v) => v.id));
  expect(props).toEqual(['puerta/portrait', 'estanque/sundial', 'semillero/ivy', 'gruta/coupe']);
});

test('more projects than slots fails with a readable error', () => {
  const extra = projectsFor('estanque').flatMap((p) => [p, { ...p, id: `${p.id}-2` }, { ...p, id: `${p.id}-3` }]);
  expect(() => bind('estanque', extra)).toThrow(/no free "lily" slot/);
});

test('low tier keeps the walls and foreground and drops optional far layers first', () => {
  for (const b of BED_IDS) {
    const all = scenes[b].layers;
    const low = keptLayers(scenes[b], 'low', 4);
    expect(low.length, b).toBeLessThanOrEqual(Math.max(4, all.filter((l) => l.minTier === 'low').length));
    expect(low.every((l) => l.minTier === 'low'), b).toBe(true);
    expect(low.at(-1), `${b} keeps its foreground`).toBe(all.at(-1));
    expect(keptLayers(scenes[b], 'high', 7)).toEqual(all);
  }
});

test('beds that are not the grotto end in a foreground layer that hides streaming', () => {
  for (const b of BED_IDS.filter((x) => x !== 'gruta')) {
    const near = scenes[b].layers.at(-1);
    expect(near?.z, b).toBe(0);
    expect(near?.minTier, b).toBe('low');
  }
});

test('the grotto sits behind the host wall: every host layer is behind the grotto camera', () => {
  const cam = scenes.gruta.pose.z;
  const host = scenes[garden.grutaHost];
  expect(host.layers.every((l) => l.z > cam), 'host layers are clipped from inside the grotto').toBe(true);
  expect(scenes.gruta.layers.every((l) => l.z < cam)).toBe(true);
});
