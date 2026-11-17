/// <reference types="node" />
// Pack stage: per bed, one page per depth band (Layer.page) up to 2048 px, gutter 8 px, straight alpha with colour
// bled into the gutter. Writes archive/work/pack/<id>.<page>.{c,n}.png (normal at half linear size) and the
// manifest draft archive/work/pack/<id>.json that the encode stage completes into public/atlas/<id>.json.
// Also the low-res overview atlas (one flattened sprite per bed) and the shared atlas.
// UV convention: v = 0 is the bottom row of the page (the encoder flips Y), pivot is a fraction with y up.
import { readFileSync } from 'node:fs';
import type { AtlasManifest, AtlasPage, BedScene, SpriteId, SpriteRect } from '../../src/types.ts';
import { CATALOG, GUTTER, MAX_PAGE, OVERVIEW_PX_PER_UNIT, PACK_DIR, SHARED_SPRITES, readJson, spritePng, writeFile, writeJson, type Catalog } from './common.ts';
import { normalMap } from './normal.ts';
import { blit, decodePng, dilate, drawScaled, encodePng, fill, halve, raster, type Raster } from './raster.ts';

export interface PackItem { id: SpriteId; color: Raster; normal: Raster; size: [number, number]; pivot: [number, number]; sources: string[] }
interface Placed { item: PackItem; x: number; y: number }

const MIN_PAGE = 64;
const pots = (): number[] => {
  const out: number[] = [];
  for (let s = MIN_PAGE; s <= MAX_PAGE; s *= 2) out.push(s);
  return out;
};

/** Shelf packing into the smallest power-of-two page that fits; null when 2048 x 2048 is not enough. */
export function shelfPack(items: readonly PackItem[]): { w: number; h: number; placed: Placed[] } | null {
  const sorted = [...items].sort((a, b) => b.color.h - a.color.h || b.color.w - a.color.w);
  const sizes = pots().flatMap((w) => pots().map((h) => ({ w, h }))).filter((s) => s.w >= s.h / 2 && s.h >= s.w / 2).sort((a, b) => a.w * a.h - b.w * b.h || a.h - b.h);
  for (const { w, h } of sizes) {
    const placed: Placed[] = [];
    let x = 0;
    let y = 0;
    let shelf = 0;
    let ok = true;
    for (const item of sorted) {
      const cw = item.color.w + GUTTER * 2;
      const ch = item.color.h + GUTTER * 2;
      if (x + cw > w) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      if (cw > w || y + ch > h) {
        ok = false;
        break;
      }
      placed.push({ item, x: x + GUTTER, y: y + GUTTER });
      x += cw;
      shelf = Math.max(shelf, ch);
    }
    if (ok) return { w, h, placed };
  }
  return null;
}

function loadItem(id: SpriteId, cat: Catalog): PackItem {
  const meta = cat.sprites[id];
  if (meta === undefined) throw new Error(`pack: sprite "${id}" is not in ${CATALOG}`);
  return { id, color: decodePng(readFileSync(spritePng(id, 'sprite'))), normal: decodePng(readFileSync(spritePng(id, 'normal'))), size: meta.size, pivot: meta.pivot, sources: meta.sources };
}

export const pageFiles = (id: string, p: number): { c: string; n: string } => ({ c: `${PACK_DIR}/${id}.${p}.c.png`, n: `${PACK_DIR}/${id}.${p}.n.png` });

function writeAtlas(id: AtlasManifest['id'], pages: PackItem[][], blooms: AtlasManifest['blooms']): AtlasManifest {
  const sprites: Record<SpriteId, SpriteRect> = {};
  const outPages: AtlasPage[] = [];
  pages.forEach((items, p) => {
    const packed = shelfPack(items);
    if (packed === null) throw new Error(`pack: atlas ${id} page ${p} does not fit in ${MAX_PAGE}x${MAX_PAGE}`);
    const color = raster(packed.w, packed.h);
    const normal = raster(packed.w, packed.h);
    fill(normal, [128, 128, 255, 255]);
    for (const { item, x, y } of packed.placed) {
      blit(color, item.color, x, y);
      blit(normal, item.normal, x, y);
      sprites[item.id] = {
        page: p,
        uv: [x / packed.w, 1 - (y + item.color.h) / packed.h, (x + item.color.w) / packed.w, 1 - y / packed.h],
        size: item.size, pivot: item.pivot, pad: GUTTER, sources: item.sources,
      };
    }
    dilate(color, GUTTER);
    const f = pageFiles(id, p);
    writeFile(f.c, encodePng(color));
    writeFile(f.n, encodePng(halve(normal)));
    outPages.push({ w: packed.w, h: packed.h, color: { hi: `${id}.${p}.c.ktx2`, lo: `${id}.${p}.c.lo.ktx2` }, normal: { hi: `${id}.${p}.n.ktx2`, lo: `${id}.${p}.n.lo.ktx2` }, fileBytes: { hi: 0, lo: 0 } });
  });
  const draft: AtlasManifest = { id, hash: '', pages: outPages, sprites, blooms };
  writeJson(`${PACK_DIR}/${id}.json`, draft);
  return draft;
}

/** Sprite ids per page of one bed; slot bloom frames go on the page of the layer nearest in z to the slot. */
export function bedPages(bed: BedScene, cat: Catalog, warnings: string[]): { pages: SpriteId[][]; blooms: AtlasManifest['blooms'] } {
  const count = bed.layers.reduce((m, l) => Math.max(m, l.page + 1), 0);
  const pages: Set<SpriteId>[] = Array.from({ length: count }, () => new Set());
  const pageOf = new Map<SpriteId, number>();
  const put = (id: SpriteId, p: number, where: string): void => {
    const was = pageOf.get(id);
    if (was !== undefined) {
      if (was !== p) warnings.push(`pack WARN: ${bed.id} uses sprite "${id}" on pages ${was} and ${p} (${where}); a sprite lives on one page, kept on ${was}`);
      return;
    }
    pageOf.set(id, p);
    pages[p]?.add(id);
  };
  for (const l of bed.layers) for (const it of l.items) put(it.sprite, l.page, `layer ${l.id}`);
  const blooms: AtlasManifest['blooms'] = {};
  for (const s of bed.slots) {
    if (s.bloom === undefined) continue;
    const def = cat.blooms[s.bloom];
    if (def === undefined) throw new Error(`pack: ${bed.id} slot ${s.id} names bloom "${s.bloom}" that is not in ${CATALOG}`);
    blooms[s.bloom] = def;
    const near = bed.layers.reduce<{ page: number; d: number }>((b, l) => (Math.abs(l.z - s.z) < b.d ? { page: l.page, d: Math.abs(l.z - s.z) } : b), { page: Math.max(0, count - 1), d: Infinity });
    if (pages.length === 0) pages.push(new Set());
    for (const id of [...(def.frames ?? []), ...(def.petals ?? []).map((p) => p.sprite)]) put(id, near.page, `slot ${s.id}`);
  }
  return { pages: pages.map((s) => [...s]), blooms };
}

/** The whole bed flattened far to near at OVERVIEW_PX_PER_UNIT, as one sprite with the bed-local origin as pivot. */
function overviewItem(bed: BedScene, items: Map<SpriteId, PackItem>): PackItem {
  const [x0, x1] = bed.bounds;
  let y0 = 0;
  let y1 = 1;
  const boxes = bed.layers.flatMap((l) => l.items.map((it) => {
    const s = items.get(it.sprite);
    if (s === undefined) throw new Error(`pack: overview of ${bed.id} misses sprite ${it.sprite}`);
    const w = s.size[0] * it.scale;
    const h = s.size[1] * it.scale;
    const bx = it.x - s.pivot[0] * w;
    const by = it.y - s.pivot[1] * h;
    y0 = Math.min(y0, by);
    y1 = Math.max(y1, by + h);
    return { s, bx, by, w, h, flip: it.flip === true };
  }));
  const pw = Math.max(8, Math.min(MAX_PAGE - GUTTER * 2, Math.ceil((x1 - x0) * OVERVIEW_PX_PER_UNIT)));
  const ph = Math.max(8, Math.min(MAX_PAGE - GUTTER * 2, Math.ceil((y1 - y0) * OVERVIEW_PX_PER_UNIT)));
  const k = pw / (x1 - x0);
  const color = raster(pw, ph);
  for (const b of boxes) drawScaled(color, b.s.color, (b.bx - x0) * k, (y1 - b.by - b.h) * k, b.w * k, b.h * k, b.flip);
  const sources = [...new Set(boxes.flatMap((b) => b.s.sources))];
  return { id: bed.id, color, normal: normalMap(color, { bevelPx: 2, lumaHeight: 0.1, strength: 2 }), size: [x1 - x0, y1 - y0], pivot: [-x0 / (x1 - x0), -y0 / (y1 - y0)], sources };
}

/** Writes every page PNG and manifest draft; returns the drafts in write order (beds, overview, shared). */
export function runPack(beds: readonly BedScene[], warnings: string[]): AtlasManifest[] {
  const cat = readJson<Catalog>(CATALOG);
  const cache = new Map<SpriteId, PackItem>();
  const item = (id: SpriteId): PackItem => {
    const hit = cache.get(id);
    if (hit !== undefined) return hit;
    const fresh = loadItem(id, cat);
    cache.set(id, fresh);
    return fresh;
  };
  const atlases: AtlasManifest[] = [];
  const overview: PackItem[] = [];
  for (const bed of beds) {
    const { pages, blooms } = bedPages(bed, cat, warnings);
    atlases.push(writeAtlas(bed.id, pages.map((ids) => ids.map(item)), blooms));
    overview.push(overviewItem(bed, cache));
  }
  if (overview.length > 0) atlases.push(writeAtlas('overview', [overview], {}));
  atlases.push(writeAtlas('shared', [SHARED_SPRITES.map(item)], {}));
  return atlases;
}
