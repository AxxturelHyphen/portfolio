/// <reference types="node" />
// Pipeline output checks: run after `npm run assets`. Manifests match the beds, files exist with the recorded sizes,
// every KTX2 file transcodes with three's own Basis transcoder (the one shipped in public/basis/), and v = 0 is the
// bottom row (each sprite's alpha rows match its source sprite, flipped).
import { expect, test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spritePng } from '../../../scripts/stages/common.ts';
import { decodePng } from '../../../scripts/stages/raster.ts';
import type { AtlasManifest, BedScene } from '../../../src/types.ts';

interface KTX2File { isValid(): number; getWidth(): number; getHeight(): number; getLevels(): number; getHasAlpha(): boolean; startTranscoding(): number;
  getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number; transcodeImage(dst: Uint8Array, level: number, layer: number, face: number, format: number, alpha: number, c0: number, c1: number): number; close(): void; delete(): void }
interface Basis { KTX2File: new (data: Uint8Array) => KTX2File; initializeBasis(): void }
const RGBA32 = 13;
const ATLAS = 'public/atlas';
const manifests = existsSync(ATLAS) ? readdirSync(ATLAS).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ATLAS, f), 'utf8')) as AtlasManifest) : [];
const beds = existsSync('content/beds') ? readdirSync('content/beds').map((f) => JSON.parse(readFileSync(join('content/beds', f), 'utf8')) as BedScene) : [];

async function basis(): Promise<Basis> {
  const factory = createRequire(import.meta.url)(join(process.cwd(), 'public/basis/basis_transcoder.js')) as (o: object) => Promise<Basis>;
  const wasmBinary = readFileSync('public/basis/basis_transcoder.wasm');
  const m = await factory({ wasmBinary });
  m.initializeBasis();
  return m;
}

function transcode(b: Basis, file: string): { w: number; h: number; levels: number; rgba: Uint8Array } {
  const k = new b.KTX2File(new Uint8Array(readFileSync(file)));
  try {
    expect(k.isValid(), file).toBeTruthy();
    expect(k.startTranscoding(), file).toBeTruthy();
    const rgba = new Uint8Array(k.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32));
    expect(k.transcodeImage(rgba, 0, 0, 0, RGBA32, 0, -1, -1), file).toBeTruthy();
    return { w: k.getWidth(), h: k.getHeight(), levels: k.getLevels(), rgba };
  } finally {
    k.close();
    k.delete();
  }
}

test.skip(manifests.length === 0, 'run npm run assets first');

test('every bed has a manifest whose pages and sprites cover its layers and blooms', () => {
  for (const bed of beds) {
    const m = manifests.find((x) => x.id === bed.id);
    expect(m, bed.id).toBeDefined();
    if (m === undefined) continue;
    // A layer item resolves in its bed's atlas, else in the shared atlas, else draws the placeholder sprite.
    const shared = manifests.find((x) => x.id === 'shared');
    for (const l of bed.layers) {
      for (const it of l.items) {
        const found = m.sprites[it.sprite] ?? shared?.sprites[it.sprite] ?? m.sprites['placeholder'] ?? shared?.sprites['placeholder'];
        expect(found, `${bed.id} ${it.sprite}`).toBeDefined();
      }
    }
    for (const s of bed.slots) if (s.bloom !== undefined) for (const f of m.blooms[s.bloom]?.frames ?? ['missing']) expect(m.sprites[f], `${bed.id} ${f}`).toBeDefined();
  }
  expect(manifests.some((m) => m.id === 'overview')).toBe(true);
  expect(manifests.some((m) => m.id === 'shared')).toBe(true);
});

test('sprite rects are inside their page with a gutter of at least 8 px and list their sources', () => {
  for (const m of manifests) {
    for (const [id, r] of Object.entries(m.sprites)) {
      // Tileable textures are a whole page each (uv 0..1, no gutter) and sample with repeat wrapping.
      if (id.startsWith('tile/')) {
        expect(r.uv).toEqual([0, 0, 1, 1]);
        continue;
      }
      const page = m.pages[r.page];
      expect(page, `${m.id} ${id}`).toBeDefined();
      if (page === undefined) continue;
      expect(r.pad).toBeGreaterThanOrEqual(8);
      expect(r.uv[0] * page.w).toBeGreaterThanOrEqual(r.pad - 1e-6);
      expect(r.uv[1] * page.h).toBeGreaterThanOrEqual(r.pad - 1e-6);
      expect(r.uv[2]).toBeLessThanOrEqual(1);
      expect(r.uv[3]).toBeLessThanOrEqual(1);
      expect(r.uv[0]).toBeLessThan(r.uv[2]);
      expect(r.uv[1]).toBeLessThan(r.uv[3]);
      expect(r.sources.length).toBeGreaterThan(0);
    }
  }
});

test('page files exist, fileBytes match and every KTX2 transcodes with mips; v = 0 is the bottom row', async () => {
  const b = await basis();
  for (const m of manifests) {
    expect(m.hash).toMatch(/^[0-9a-f]{16}$/);
    m.pages.forEach((p, i) => {
      const at = (f: string): string => join(ATLAS, f);
      expect(statSync(at(p.color.hi)).size + statSync(at(p.normal.hi)).size).toBe(p.fileBytes.hi);
      expect(statSync(at(p.color.lo)).size + statSync(at(p.normal.lo)).size).toBe(p.fileBytes.lo);
      const c = transcode(b, at(p.color.hi));
      expect([c.w, c.h]).toEqual([p.w, p.h]);
      expect(c.levels).toBe(Math.log2(Math.max(p.w, p.h)) + 1);
      expect([transcode(b, at(p.color.lo)).w, transcode(b, at(p.normal.hi)).w, transcode(b, at(p.normal.lo)).w]).toEqual([p.w / 2, p.w / 2, p.w / 4]);
      for (const [id, r] of Object.entries(m.sprites)) {
        if (r.page !== i || m.id === 'overview' || !existsSync(spritePng(id, 'sprite'))) continue;
        const src = decodePng(readFileSync(spritePng(id, 'sprite')));
        const x0 = Math.round(r.uv[0] * p.w);
        const y0 = Math.round(r.uv[1] * p.h);
        // Only a source cut at the packed size is the sprite on the page; older stage files of other sizes are not.
        if (src.w !== Math.round((r.uv[2] - r.uv[0]) * p.w) || src.h !== Math.round((r.uv[3] - r.uv[1]) * p.h)) continue;
        let diff = 0;
        // Row j of the transcoded data counts up from the page bottom; the source PNG is stored top row first.
        for (let j = 0; j < src.h; j++) {
          let a = 0;
          let s = 0;
          for (let k = 0; k < src.w; k++) {
            a += c.rgba[((y0 + j) * p.w + x0 + k) * 4 + 3] ?? 0;
            s += src.data[((src.h - 1 - j) * src.w + k) * 4 + 3] ?? 0;
          }
          diff += Math.abs(a - s) / src.w;
        }
        expect(diff / src.h, `${m.id} ${id} alpha rows`).toBeLessThan(12);
      }
    });
  }
});
