/// <reference types="node" />
// Pack stage: per bed, one page per depth band (Layer.page) up to 2048 px, gutter 8 px, straight alpha with colour
// bled into the gutter. Writes archive/work/pack/<id>.<page>.{c,n}.png (normal at half linear size) and the
// manifest draft archive/work/pack/<id>.json that the encode stage completes into public/atlas/<id>.json.
// Also the low-res overview atlas (one flattened sprite per bed) and the shared atlas.
// UV convention: v = 0 is the bottom row of the page (the encoder flips Y), pivot is a fraction with y up.
import { readFileSync } from 'node:fs';
import type { AtlasManifest, AtlasPage, BedScene, SpriteId, SpriteRect } from '../../src/types.ts';
import { existsSync } from 'node:fs';
import { CATALOG, GUTTER, MAX_PAGE, OVERVIEW_PX_PER_UNIT, PACK_DIR, SHARED_SPRITES, readJson, spritePng, writeFile, writeJson, type Catalog } from './common.ts';
import { normalMap } from './normal.ts';
import { blit, decodePng, dilate, drawScaled, encodePng, fill, halve, raster, type Raster } from './raster.ts';
import { readRecipes, recipePageIds, type Recipe } from './recipe.ts';
import { REAL_CATALOG, realPng, type RealCatalog } from './sprites.ts';

/** A tile is a page of its own: one sprite over the whole page, no gutter, repeat-wrapped at runtime. */
export interface PackItem { id: SpriteId; color: Raster; normal: Raster; size: [number, number]; pivot: [number, number]; sources: string[]; tile?: boolean }
interface Placed { item: PackItem; x: number; y: number }

const MIN_PAGE = 64;
const pots = (): number[] => {
  const out: number[] = [];
  for (let s = MIN_PAGE; s <= MAX_PAGE; s *= 2) out.push(s);
  return out;
};

/** Skyline bottom-left packing of w x h boxes into one page; null when they do not fit. */
function skyline(boxes: readonly { w: number; h: number }[], W: number, H: number): { x: number; y: number }[] | null {
  let line: { x: number; y: number; w: number }[] = [{ x: 0, y: 0, w: W }];
  const out: { x: number; y: number }[] = [];
  for (const b of boxes) {
    let best: { i: number; x: number; y: number } | null = null;
    for (let i = 0; i < line.length; i++) {
      const x = line[i]!.x;
      if (x + b.w > W) break;
      let y = 0;
      let left = b.w;
      for (let j = i; j < line.length && left > 0; j++) {
        y = Math.max(y, line[j]!.y);
        left -= line[j]!.w;
      }
      if (y + b.h > H) continue;
      if (best === null || y < best.y || (y === best.y && x < best.x)) best = { i, x, y };
    }
    if (best === null) return null;
    out.push({ x: best.x, y: best.y });
    const top = { x: best.x, y: best.y + b.h, w: b.w };
    const next: typeof line = [];
    for (const seg of line) {
      const s0 = seg.x;
      const s1 = seg.x + seg.w;
      if (s1 <= top.x || s0 >= top.x + top.w) next.push(seg);
      else {
        if (s0 < top.x) next.push({ x: s0, y: seg.y, w: top.x - s0 });
        if (s1 > top.x + top.w) next.push({ x: top.x + top.w, y: seg.y, w: s1 - top.x - top.w });
      }
    }
    next.push(top);
    next.sort((a, c) => a.x - c.x);
    line = next.reduce<typeof line>((acc, seg) => {
      const last = acc[acc.length - 1];
      if (last !== undefined && last.y === seg.y && last.x + last.w === seg.x) last.w += seg.w;
      else acc.push({ ...seg });
      return acc;
    }, []);
  }
  return out;
}

const ORDERS: ((a: PackItem, b: PackItem) => number)[] = [
  (a, b) => b.color.h - a.color.h || b.color.w - a.color.w,
  (a, b) => b.color.w - a.color.w || b.color.h - a.color.h,
  (a, b) => b.color.w * b.color.h - a.color.w * a.color.h,
  (a, b) => Math.max(b.color.w, b.color.h) - Math.max(a.color.w, a.color.h),
];

/** Packs into the smallest power-of-two page that fits (skyline, several orders tried); null when 2048 x 2048 is not
 * enough. */
export function shelfPack(items: readonly PackItem[]): { w: number; h: number; placed: Placed[] } | null {
  const sizes = pots().flatMap((w) => pots().map((h) => ({ w, h }))).filter((s) => s.w >= s.h / 2 && s.h >= s.w / 2).sort((a, b) => a.w * a.h - b.w * b.h || a.h - b.h);
  for (const { w, h } of sizes) {
    for (const order of ORDERS) {
      const sorted = [...items].sort(order);
      const at = skyline(sorted.map((it) => ({ w: it.color.w + GUTTER * 2, h: it.color.h + GUTTER * 2 })), w, h);
      if (at !== null) return { w, h, placed: sorted.map((item, k) => ({ item, x: at[k]!.x + GUTTER, y: at[k]!.y + GUTTER })) };
    }
  }
  return null;
}

/** Placeholder catalog overlaid by the real one: a real sprite always wins over a placeholder of the same id. */
export interface Sprites { cat: Catalog; real: RealCatalog | null }

export function readSprites(): Sprites {
  const placeholder = existsSync(CATALOG) ? readJson<Catalog>(CATALOG) : { sprites: {}, blooms: {} };
  const real = existsSync(REAL_CATALOG) ? readJson<RealCatalog>(REAL_CATALOG) : null;
  return { cat: { sprites: { ...placeholder.sprites, ...real?.sprites }, blooms: { ...placeholder.blooms, ...real?.blooms } }, real };
}

const fileOf = (id: SpriteId, kind: 'sprite' | 'normal', s: Sprites): string => (s.real?.sprites[id] !== undefined ? realPng(id, kind) : spritePng(id, kind));

function loadItem(id: SpriteId, s: Sprites): PackItem {
  const meta = s.cat.sprites[id];
  if (meta === undefined) throw new Error(`pack: sprite "${id}" is in no catalog (${CATALOG}, ${REAL_CATALOG})`);
  const tile = s.real?.tiles.includes(id) === true;
  return { id, color: decodePng(readFileSync(fileOf(id, 'sprite', s))), normal: decodePng(readFileSync(fileOf(id, 'normal', s))), size: meta.size, pivot: meta.pivot, sources: meta.sources, tile };
}

export const pageFiles = (id: string, p: number): { c: string; n: string } => ({ c: `${PACK_DIR}/${id}.${p}.c.png`, n: `${PACK_DIR}/${id}.${p}.n.png` });

function writeAtlas(id: AtlasManifest['id'], pages: PackItem[][], blooms: AtlasManifest['blooms']): AtlasManifest {
  const sprites: Record<SpriteId, SpriteRect> = {};
  const outPages: AtlasPage[] = [];
  pages.forEach((items, p) => {
    const only = items[0];
    const packed = only?.tile === true ? { w: only.color.w, h: only.color.h, placed: [{ item: only, x: 0, y: 0 }] } : shelfPack(items);
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
        size: item.size, pivot: item.pivot, pad: item.tile === true ? 0 : GUTTER, sources: item.sources,
      };
    }
    if (only?.tile !== true) dilate(color, GUTTER);
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
export function bedPages(bed: BedScene, cat: Catalog, warnings: string[], recipe?: Recipe, elsewhere: ReadonlySet<SpriteId> = new Set()): { pages: SpriteId[][]; blooms: AtlasManifest['blooms'] } {
  const fromRecipe = recipe === undefined ? [] : recipePageIds(recipe);
  const count = Math.max(fromRecipe.length, bed.layers.reduce((m, l) => Math.max(m, l.page + 1), 0));
  const pages: Set<SpriteId>[] = Array.from({ length: count }, (_, p) => new Set(fromRecipe[p] ?? []));
  const pageOf = new Map<SpriteId, number>();
  fromRecipe.forEach((ids, p) => ids.forEach((id) => pageOf.set(id, p)));
  const put = (id: SpriteId, p: number, where: string): void => {
    if (elsewhere.has(id)) return;
    const was = pageOf.get(id);
    if (was !== undefined) {
      if (was !== p && !fromRecipe.some((ids) => ids.includes(id))) warnings.push(`pack WARN: ${bed.id} uses sprite "${id}" on pages ${was} and ${p} (${where}); a sprite lives on one page, kept on ${was}`);
      return;
    }
    pageOf.set(id, p);
    pages[p]?.add(id);
  };
  for (const l of bed.layers) for (const it of l.items) put(it.sprite, l.page, `layer ${l.id}`);
  const blooms: AtlasManifest['blooms'] = {};
  for (const r of recipe?.pages ?? []) for (const id of [...(r.blooms ?? []), ...(r.sequences ?? [])].map((b) => b.id)) if (cat.blooms[id] !== undefined) blooms[id] = cat.blooms[id]!;
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
function overviewItem(bed: BedScene, item: (id: SpriteId) => PackItem | undefined): PackItem {
  const [x0, x1] = bed.bounds;
  let y0 = 0;
  let y1 = 1;
  const boxes = bed.layers.flatMap((l) => l.items.map((it) => {
    const s = item(it.sprite);
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
  const sprites = readSprites();
  const { cat } = sprites;
  const recipes = new Map(readRecipes().map((r) => [r.atlas, r]));
  const cache = new Map<SpriteId, PackItem>();
  const item = (id: SpriteId): PackItem => {
    const hit = cache.get(id);
    if (hit !== undefined) return hit;
    const fresh = loadItem(id, sprites);
    cache.set(id, fresh);
    return fresh;
  };
  const atlases: AtlasManifest[] = [];
  const overview: PackItem[] = [];
  // A sprite packed in the shared atlas is never copied into a bed atlas: the world resolves it there.
  const inShared = new Set(recipes.get('shared') === undefined ? [] : recipePageIds(recipes.get('shared')!).flat());
  for (const bed of beds) {
    const { pages, blooms } = bedPages(bed, cat, warnings, recipes.get(bed.id), inShared);
    atlases.push(writeAtlas(bed.id, pages.map((ids) => ids.map(item)), blooms));
    overview.push(overviewItem(bed, item));
  }
  if (overview.length > 0) atlases.push(writeAtlas('overview', [overview], {}));
  // A recipe for no bed and not the shared atlas is a standalone page set (the kaleidoscope intro), packed as written.
  const bedIds = new Set<string>(beds.map((b) => b.id));
  for (const r of recipes.values()) {
    if (r.atlas === 'shared' || bedIds.has(r.atlas)) continue;
    atlases.push(writeAtlas(r.atlas, recipePageIds(r).map((ids) => ids.map(item)), {}));
  }
  const shared = recipes.get('shared');
  const bands = shared === undefined ? [[]] : recipePageIds(shared);
  const extra = SHARED_SPRITES.filter((id) => !bands.some((ids) => ids.includes(id)));
  const sharedPages = bands.map((ids, p) => (p === 0 ? [...extra, ...ids] : ids).map(item));
  for (const t of shared?.tiles ?? []) sharedPages.push([item(t.id)]);
  atlases.push(writeAtlas('shared', sharedPages, {}));
  return atlases;
}
