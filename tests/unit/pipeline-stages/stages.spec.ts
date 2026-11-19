/// <reference types="node" />
import { expect, test } from '@playwright/test';
import { changesOf, creditsOf, fontOf, holderOf } from '../../../scripts/stages/credits.ts';
import { linearPlanes } from '../../../scripts/stages/lib/color.ts';
import { refineEdges } from '../../../scripts/stages/lib/matte.ts';
import { distanceTo, mask } from '../../../scripts/stages/lib/morph.ts';
import type { MergedSource } from '../../../scripts/stages/merge.ts';
import { normalMap } from '../../../scripts/stages/normal.ts';
import { raster } from '../../../scripts/stages/raster.ts';
import { fitSprite, splitSprites } from '../../../scripts/stages/sprite.ts';

const disc = (w: number, h: number, cx: number, cy: number, r: number, rgb: [number, number, number], into = raster(w, h)) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - cx, y - cy) <= r) into.data.set([...rgb, 255], (y * w + x) * 4);
  return into;
};

test('distance transform is exact Euclidean', () => {
  const d = distanceTo(9, 9, (i) => i === 4 * 9 + 4);
  expect(d[4 * 9 + 4]).toBe(0);
  expect(d[4 * 9 + 7]).toBeCloseTo(3, 5);
  expect(d[0]).toBeCloseTo(Math.hypot(4, 4), 5);
});

test('edge un-mix recovers half coverage and the ink colour, not the paper', () => {
  const w = 8;
  const img = raster(w, 1);
  const paper = [240, 228, 200];
  const ink = [40, 60, 120];
  for (let x = 0; x < w; x++) img.data.set([...(x < 4 ? ink : paper), 255], x * 4);
  const mid = [0, 1, 2].map((c) => Math.round(Math.sqrt((((ink[c]! / 255) ** 2.2 + (paper[c]! / 255) ** 2.2) / 2)) * 255));
  img.data.set([...mid, 255], 4 * 4);
  const lin = linearPlanes(img);
  const bg = raster(w, 1);
  for (let x = 0; x < w; x++) bg.data.set([...paper, 255], x * 4);
  const m = mask(w, 1);
  for (let x = 0; x < 5; x++) m.m[x] = 1;
  const out = refineEdges(lin, linearPlanes(bg), m, { inside: 1.5, outside: 2, fallback: new Float32Array(w) });
  expect(out.alpha[0]).toBe(1);
  expect(out.alpha[4]).toBeGreaterThan(0.35);
  expect(out.alpha[4]).toBeLessThan(0.6);
  expect(out.color.c2[4]!).toBeGreaterThan(out.color.c0[4]!);
  expect(out.alpha[6]).toBe(0);
});

test('multi-specimen plates split by true distance, in reading order', () => {
  const plate = disc(200, 120, 40, 40, 20, [200, 40, 40]);
  disc(200, 120, 150, 40, 20, [40, 200, 40], plate);
  disc(200, 120, 95, 100, 15, [40, 40, 200], plate);
  const parts = splitSprites(plate);
  expect(parts.length).toBe(3);
  expect(parts.map((p) => p.image.data[((p.image.h >> 1) * p.image.w + (p.image.w >> 1)) * 4])).toEqual([200, 40, 40]);
  const sprite = fitSprite(parts[0]!.image, 'xs');
  expect(sprite.w).toBe(41 + 8);
  expect(sprite.data[3]).toBe(0);
});

test('normal map is flat outside and lifted toward the outside at the edge', () => {
  const r = disc(64, 64, 32, 32, 20, [128, 128, 128]);
  const n = normalMap(r, { bevelPx: 5, lumaHeight: 0.3, strength: 2 });
  expect([...n.data.subarray(0, 3)]).toEqual([128, 128, 255]);
  const right = (32 * 64 + 51) * 4;
  expect(n.data[right]!).toBeGreaterThan(140);
  const centre = (32 * 64 + 32) * 4;
  expect(Math.abs(n.data[centre]! - 128)).toBeLessThan(3);
});

test('credits list only shipped sources, grouped and sorted', () => {
  const base = { title: 't', creator: 'c', date: 'd', sourceUrl: 'u', license: 'CC0-1.0', licenseUrl: 'l', attribution: 'a', file: 'f', need: 'n', category: 'k', sha256: 's', edits: [] };
  const sources: MergedSource[] = [
    { ...base, id: 'b', institution: 'Z', usedIn: ['x'] },
    { ...base, id: 'a', institution: 'Z', usedIn: ['y', 'w'] },
    { ...base, id: 'c', institution: 'A', usedIn: [] },
  ];
  const c = creditsOf({ generated: '', sources, own: [] });
  expect(c.groups.map((g) => g.institution)).toEqual(['Z']);
  expect(c.groups[0]!.items.map((i) => i.id)).toEqual(['a', 'b']);
  expect(c.groups[0]!.items[0]!.usedIn).toEqual(['w', 'y']);
});

test('credits list the recordings the garden plays apart from the images, each marked as cut', () => {
  const base = { title: 't', creator: 'c', date: 'd', sourceUrl: 'u', license: 'PD', licenseUrl: '', attribution: 'a', file: 'f', need: 'n', category: 'k', sha256: 's', edits: [] };
  const sources: MergedSource[] = [
    { ...base, id: 'owl', institution: 'Internet Archive', usedIn: ['sound:owl'] },
    { ...base, id: 'bird', institution: 'Internet Archive', usedIn: ['sound:nightingale'] },
    { ...base, id: 'plate', institution: 'Internet Archive', usedIn: ['x'] },
    { ...base, id: 'unused', institution: 'Internet Archive', usedIn: [] },
  ];
  const c = creditsOf({ generated: '', sources, own: [] });
  expect(c.sounds.map((s) => s.id)).toEqual(['bird', 'owl']);
  expect(c.sounds.every((s) => s.changes.join() === 'trimmed')).toBe(true);
  expect(c.groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(['plate']);
});

test('credits name one holder per museum, tell what changed, and read the fonts from their OFL texts', () => {
  expect(holderOf('Rijksmuseum, Amsterdam (via Wikimedia Commons)')).toBe('Rijksmuseum, Amsterdam');
  expect(holderOf('Scan of Flora Batava via Wikimedia Commons')).toBe('Wikimedia Commons');
  expect(holderOf(' Poly Haven ')).toBe('Poly Haven');
  expect(changesOf([
    { stage: 'sprite', tool: 'painted out', note: 'x: 0.1,0.1,0.2,0.2' },
    { stage: 'tint', tool: 'OKLab hue-selected re-tint', note: 'x: all toward #5d6c71' },
    { stage: 'cutout', tool: 'hand garbage matte', note: 'x: classical, crop 0.1,0.2,0.8,0.9' },
  ])).toEqual(['cropped', 'cutout', 'tinted', 'retouched']);
  expect(changesOf([{ stage: 'tile', tool: 'plate pass: 5 tone steps', note: 'tile/wall' }])).toEqual(['tinted', 'screened']);
  expect(changesOf([])).toEqual([]);
  const ofl = 'Copyright 2022 The Kalnia Project Authors (https://github.com/fridamedrano/Kalnia-Typeface.git)\n\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.';
  expect(fontOf('Kalnia-OFL.txt', ofl)).toEqual({
    family: 'Kalnia', copyright: 'Copyright 2022 The Kalnia Project Authors', license: 'OFL-1.1',
    licenseUrl: 'https://openfontlicense.org', sourceUrl: 'https://github.com/fridamedrano/Kalnia-Typeface', file: 'fonts/LICENSES/Kalnia-OFL.txt',
  });
  expect(fontOf('Other.txt', 'MIT licence')).toBeNull();
});
