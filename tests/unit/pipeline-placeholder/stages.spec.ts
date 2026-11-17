/// <reference types="node" />
import { expect, test } from '@playwright/test';
import { normalizeLicence } from '../../../scripts/stages/merge.ts';
import { shelfPack, type PackItem } from '../../../scripts/stages/pack.ts';
import { decodePng, encodePng, raster } from '../../../scripts/stages/raster.ts';

test('licence allowlist: PD, CC0, CC BY, CC BY-SA in; NC, ND and unclear out', () => {
  expect(normalizeLicence('Public Domain Mark 1.0')).toBe('PD');
  expect(normalizeLicence('Public domain (published 1817)')).toBe('PD');
  expect(normalizeLicence('CC0 1.0 (Met Open Access, public domain)')).toBe('CC0-1.0');
  expect(normalizeLicence('CC BY-SA 4.0')).toBe('CC-BY-SA-4.0');
  expect(normalizeLicence('CC BY 4.0')).toBe('CC-BY-4.0');
  expect(normalizeLicence('CC BY-NC 4.0')).toBeNull();
  expect(normalizeLicence('CC BY-ND 4.0')).toBeNull();
  expect(normalizeLicence('CC BY-NC-SA 4.0')).toBeNull();
  expect(normalizeLicence('All rights reserved')).toBeNull();
  expect(normalizeLicence('unclear')).toBeNull();
});

test('PNG round trip keeps every byte', () => {
  const r = raster(5, 3);
  for (let i = 0; i < r.data.length; i++) r.data[i] = (i * 37) & 0xff;
  expect(decodePng(encodePng(r)).data).toEqual(r.data);
});

test('shelf pack keeps the gutter, never overlaps and picks the smallest page', () => {
  const item = (id: string, w: number, h: number): PackItem => ({ id, color: raster(w, h), normal: raster(w, h), size: [1, 1], pivot: [0.5, 0], sources: ['code:placeholder'] });
  const packed = shelfPack([item('a', 100, 40), item('b', 30, 30), item('c', 200, 10)]);
  expect(packed).not.toBeNull();
  if (packed === null) return;
  expect([packed.w, packed.h]).toEqual([256, 128]);
  for (const p of packed.placed) for (const q of packed.placed) {
    if (p === q) continue;
    const apart = p.x + p.item.color.w + 16 <= q.x || q.x + q.item.color.w + 16 <= p.x || p.y + p.item.color.h + 16 <= q.y || q.y + q.item.color.h + 16 <= p.y;
    expect(apart).toBe(true);
  }
  expect(shelfPack([item('huge', 2040, 10)])).toBeNull();
});
