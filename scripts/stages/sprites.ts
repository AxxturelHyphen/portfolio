/// <reference types="node" />
// Sprites stage: the recipes (archive/recipes/*.json) to shipping sprites. Per plate one cut (classical key first,
// local ML matte only where it fails or where a look at the contact sheet forced it, logged), cached as
// archive/work/cut/<source>.png. Per job: crop, painted-out parts, re-pose, treatment (PK tint and rim, INK, MASK),
// trim and resize to its class, pressed-paper normal. Writes archive/work/real/{sprite,normal}/<id>.png, the real
// catalog archive/work/real.json and the edit log archive/work/edits.json that the merge stage attaches to sources.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { SpriteId } from '../../src/types.ts';
import { buildBloom } from './bloom.ts';
import { WORK, hashInputs, readJson, readOwn, safeName, writeFile, writeJson, type Cache, type Catalog, type SpriteMeta } from './common.ts';
import { CUT_MAX_SIDE, cutout, type CutHints } from './cutout.ts';
import { crop, readImage } from './lib/image.ts';
import { normalMap } from './normal.ts';
import { decodePng, encodePng, type Raster } from './raster.ts';
import { CLASS_PX, readRecipes, type Box4, type Job, type PlateOpts, type Recipe } from './recipe.ts';
import { cropPart, fitLong, lowestPoint, transform } from './shape.ts';
import { applyInk, applyMask, applyPaperRim, applyRemovals, applyTint, keepLargest, keepWhole } from './treat.ts';
import { alphaBounds } from './sprite.ts';
import { drawPaperCar } from './papercar.ts';
import { applyEngrave } from './engrave.ts';
import { applyCropMl, applyLumaKey, applyPolygon, defringe } from './jobmatte.ts';
import { buildFlags, buildTile } from './tiles.ts';

export const REAL = `${WORK}/real`;
export const REAL_CATALOG = `${WORK}/real.json`;
export const EDITS = `${WORK}/edits.json`;
export const realPng = (id: SpriteId, kind: 'sprite' | 'normal'): string => `${REAL}/${kind}/${safeName(id)}.png`;

export interface Edit { stage: string; tool: string; note: string }
export interface RealCatalog extends Catalog { methods: Record<string, { method: string; tool: string; reason: string }>; tiles: SpriteId[] }

const CUT_CODE = ['scripts/stages/cutout.ts', ...['color', 'image', 'matte', 'ml', 'morph', 'paper', 'quality'].map((f) => `scripts/stages/lib/${f}.ts`)];
const JOB_CODE = ['scripts/stages/sprites.ts', 'scripts/stages/treat.ts', 'scripts/stages/shape.ts', 'scripts/stages/bloom.ts', 'scripts/stages/normal.ts', 'scripts/stages/tiles.ts', 'scripts/stages/recipe.ts', 'scripts/stages/jobmatte.ts', 'scripts/stages/papercar.ts', 'scripts/stages/engrave.ts'];
const FEATHER_SHARE = 1 / 400;
export const SPRITE_PAD = 4;

interface SourceRec { id: string; file: string }
let sourceIndex: Map<string, string> | null = null;

/** Raw file of a source id, resolved like the merge stage does (archive/raw/<category>/<file>). */
export function sourceFile(id: string): string {
  const hit = sourceIndex?.get(id);
  if (hit !== undefined) return hit;
  throw new Error(`sprites: no raw file for source ${id}`);
}

export function indexSources(entries: readonly (SourceRec & { category: string })[]): void {
  sourceIndex = new Map();
  for (const e of entries) {
    const inCat = join('archive/raw', e.category, e.file);
    sourceIndex.set(e.id, e.file.startsWith('archive/') ? e.file : existsSync(inCat) ? inCat : join('archive/raw', e.file));
  }
  // The owner's own photographs (archive/OWN.json entries with an id) are plates too: no licence entry, declared instead.
  for (const o of readOwn()) if (o.id !== undefined) sourceIndex.set(o.id, o.file);
}

const toBox = (b: Box4): [number, number, number, number] => [b[0], b[1], b[2] - b[0], b[3] - b[1]];

interface CutOut { image: Raster; method: string; tool: string; reason: string }

function plateCut(cache: Cache, source: string, o: PlateOpts, mem: Map<string, CutOut>): CutOut {
  const hit = mem.get(source);
  if (hit !== undefined) return hit;
  const file = sourceFile(source);
  const st = statSync(file);
  const hash = hashInputs(CUT_CODE, [source, `${st.size}:${st.mtimeMs}`, JSON.stringify(o)]);
  const out = `${WORK}/cut/${safeName(source)}.png`;
  const key = `cut:${source}`;
  let res: CutOut;
  if (cache.fresh(key, hash, [out])) {
    const meta = JSON.parse(cache.get(`${key}:meta`) ?? '{}') as Omit<CutOut, 'image'>;
    res = { image: decodePng(readFileSync(out)), method: meta.method, tool: meta.tool, reason: meta.reason };
  } else {
    const hints: CutHints = { drop: (o.drop ?? []).map(toBox) };
    if (o.side !== undefined) hints.side = o.side;
    if (o.method === 'classical' || o.method === 'ml') hints.method = o.method;
    const t0 = performance.now();
    const c = o.method === 'raw' ? rawPlate(file, o.side) : cutout(file, hints);
    const reason = o.method !== undefined ? `forced: ${o.why ?? 'by recipe'}` : (c.fallbackReason ?? '');
    res = { image: c.image, method: c.method, tool: c.tool, reason };
    writeFile(out, encodePng(c.image));
    cache.set(key, hash);
    cache.set(`${key}:meta`, JSON.stringify({ method: res.method, tool: res.tool, reason }));
    console.log(`  cut ${source}: ${c.method}${reason ? ` (${reason})` : ''} ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  mem.set(source, res);
  return res;
}

/** No key: the plate as decoded, fully opaque (for luminance masks of dark aquatint masses). */
function rawPlate(file: string, side = CUT_MAX_SIDE): { image: Raster; method: 'raw'; tool: string; fallbackReason?: string } {
  return { image: readImage(file, side), method: 'raw', tool: 'no key; alpha from luminance in the MASK treatment' };
}

const longOf = (j: Job, w: number, h: number): number => (j.size === 'native' ? Math.max(w, h) + SPRITE_PAD * 2 : typeof j.size === 'number' ? j.size : CLASS_PX[j.size]);

/** One job to its final sprite raster and world metrics (before the normal map). */
export function jobRaster(j: Job, cut: Raster, plate: PlateOpts): { color: Raster; meta: Omit<SpriteMeta, 'sources'> } {
  let part = cropPart(cut, j.crop);
  const toLocal = (fx: number, fy: number): [number, number] => [fx * cut.w - Math.round(j.crop[0] * cut.w), fy * cut.h - Math.round(j.crop[1] * cut.h)];
  if (j.ml === true) applyCropMl(part);
  if (j.matte !== undefined) applyPolygon(part, j.matte, toLocal, Math.max(1, Math.round(Math.max(part.w, part.h) * FEATHER_SHARE)));
  if (j.lumaKey !== undefined) applyLumaKey(part, j.lumaKey);
  if (j.ml === true || j.matte !== undefined || j.lumaKey !== undefined) defringe(part);
  applyRemovals(part, j.remove ?? [], toLocal);
  if (j.whole !== undefined) keepWhole(part, j.whole);
  if (j.largest === true) keepLargest(part, 0.5);
  if (j.rotate !== undefined || j.warp !== undefined || j.flip === true) part = transform(part, j.rotate ?? 0, j.warp ?? [0, 0], j.flip === true);
  for (const t of j.tint ?? []) applyTint(part, t);
  if (j.engrave !== undefined) applyEngrave(part, j.engrave);
  if (j.treat === 'INK') part = applyInk(part, j.ink ?? { line: '#1b1a3a', wash: '#7b6648', washAlpha: 0.35 }, j.minExtent ?? 0);
  if (j.treat === 'MASK') {
    part = applyMask(part, j.mask ?? { color: '#1b1a3a', blur: 3 });
    if (j.largest === true) keepLargest(part, 0.3);
  }
  const contentH = part.h;
  const color = fitLong(part, longOf(j, part.w, part.h), SPRITE_PAD);
  if (j.treat === undefined || j.treat === 'PK') applyPaperRim(color);
  const inner = color.h - SPRITE_PAD * 2;
  const mpp = j.h !== undefined ? j.h / inner : j.w !== undefined ? j.w / (color.w - SPRITE_PAD * 2) : ((plate.plateH ?? 1) * (contentH / cut.h)) / inner;
  const pivot = j.pivot ?? [lowestPoint(color) / color.w, SPRITE_PAD / color.h];
  return { color, meta: { size: [+(color.w * mpp).toFixed(4), +(color.h * mpp).toFixed(4)], pivot: [+pivot[0].toFixed(4), +pivot[1].toFixed(4)] } };
}

const bevelFor = (j: Job, r: Raster): number => j.bevel ?? Math.max(2, Math.round(Math.max(r.w, r.h) / 200));

function writeSprite(id: SpriteId, color: Raster, bevel: number, flat = false): void {
  writeFile(realPng(id, 'sprite'), encodePng(color));
  writeFile(realPng(id, 'normal'), encodePng(normalMap(color, { bevelPx: bevel, lumaHeight: flat ? 0.1 : 0.35, strength: flat ? 1.2 : 2.2, detailPx: 3 })));
}

/** Runs every recipe; returns the log lines. */
export function runSprites(cache: Cache, sources: readonly (SourceRec & { category: string })[]): string[] {
  indexSources(sources);
  const recipes = readRecipes();
  const prev = existsSync(REAL_CATALOG) ? readJson<RealCatalog>(REAL_CATALOG) : null;
  const cat: RealCatalog = { sprites: {}, blooms: {}, methods: {}, tiles: [] };
  const edits: Record<string, Edit[]> = {};
  const log = (src: string, e: Edit): void => void (edits[src] ??= []).push(e);
  const mem = new Map<string, CutOut>();
  const code = hashInputs(JOB_CODE);
  let built = 0;
  let cached = 0;
  const lines: string[] = [];
  const keep = (id: SpriteId, key: string, hash: string, meta: SpriteMeta, make: () => void): void => {
    const outs = [realPng(id, 'sprite'), realPng(id, 'normal')];
    const was = prev?.sprites[id];
    if (was !== undefined && cache.fresh(key, hash, outs)) {
      cat.sprites[id] = was;
      cached++;
      return;
    }
    make();
    cat.sprites[id] = meta;
    cache.set(key, hash);
    built++;
  };
  for (const r of recipes) {
    for (const page of r.pages) {
      for (const j of page.jobs) runJob(r, j);
      for (const b of page.blooms ?? []) {
        const plate = r.plates[b.full.source] ?? {};
        const cut = plateCut(cache, b.full.source, plate, mem);
        const hash = hashInputs([`${WORK}/cut/${safeName(b.full.source)}.png`], [code, JSON.stringify(b), cache.get(`cut:${b.full.source}`) ?? '']);
        const ids = [`${b.prefix}-7`, `${b.prefix}-8`, `${b.prefix}-9`];
        const allFresh = ids.every((id) => prev?.sprites[id] !== undefined && cache.fresh(`job:${id}`, hash, [realPng(id, 'sprite'), realPng(id, 'normal')]));
        if (allFresh) {
          for (const id of ids) cat.sprites[id] = prev!.sprites[id]!;
          cached += 3;
        } else {
          const { color, meta } = jobRaster(b.full, cut.image, plate);
          const frames = buildBloom(color, b.ring);
          frames.forEach((f, k) => {
            // Each frame is trimmed to its own content; its pivot moves with it, so the frames still register.
            const [bx, by, bw, bh] = alphaBounds(f);
            const x0 = Math.max(0, bx - SPRITE_PAD);
            const y0 = Math.max(0, by - SPRITE_PAD);
            const tw = Math.min(f.w, bx + bw + SPRITE_PAD) - x0;
            const th = Math.min(f.h, by + bh + SPRITE_PAD) - y0;
            const trimmed = crop(f, x0, y0, tw, th);
            const mpp = meta.size[0] / f.w;
            const px = meta.pivot[0] * f.w - x0;
            const py = meta.pivot[1] * f.h - (f.h - y0 - th);
            writeSprite(ids[k]!, trimmed, bevelFor(b.full, trimmed));
            cat.sprites[ids[k]!] = { size: [+(tw * mpp).toFixed(4), +(th * mpp).toFixed(4)], pivot: [+(px / tw).toFixed(4), +(py / th).toFixed(4)], sources: [b.full.source] };
            cache.set(`job:${ids[k]!}`, hash);
          });
          built += 3;
        }
        log(b.full.source, { stage: 'bloom', tool: 'nested layers cut along petal edges (polar edge path)', note: `${ids.join(', ')}: heart and middle ring, guards tucked, the plate (ring ${b.ring})` });
        cat.blooms[b.id] = { kind: b.kind, mode: 'frames', steps: b.stages.length + 3, frames: [...b.stages, ...ids], rest: b.rest };
      }
      for (const q of page.sequences ?? []) {
        const missing = q.frames.filter((id) => !page.jobs.some((j) => j.id === id));
        if (missing.length > 0) throw new Error(`sprites: sequence ${q.id} names frames no job on its page makes: ${missing.join(', ')}`);
        cat.blooms[q.id] = { kind: q.kind, mode: 'frames', steps: q.frames.length, frames: q.frames, rest: q.rest };
      }
      if (page.flags !== undefined) {
        const f = page.flags;
        const ids = Array.from({ length: f.count }, (_, k) => `${f.prefix}-${k + 1}`);
        const hash = hashInputs([sourceFile(f.source)], [code, JSON.stringify(f)]);
        if (ids.every((id) => prev?.sprites[id] !== undefined && cache.fresh(`job:${id}`, hash, [realPng(id, 'sprite'), realPng(id, 'normal')]))) {
          for (const id of ids) cat.sprites[id] = prev!.sprites[id]!;
          cached += ids.length;
        } else {
          buildFlags(f, sourceFile(f.source)).forEach((s, k) => {
            writeFile(realPng(ids[k]!, 'sprite'), encodePng(s.color));
            writeFile(realPng(ids[k]!, 'normal'), encodePng(s.normal));
            cat.sprites[ids[k]!] = { size: s.size, pivot: [0.5, 0.5], sources: [f.source] };
            cache.set(`job:${ids[k]!}`, hash);
          });
          built += ids.length;
        }
        log(f.source, { stage: 'flags', tool: 'stones segmented along the dark joints, plate pass', note: `${ids.join(', ')}` });
      }
    }
    for (const t of r.tiles ?? []) {
      const hash = hashInputs([sourceFile(t.source), ...(t.normalFile ? [t.normalFile] : [])], [code, JSON.stringify(t)]);
      keep(t.id, `tile:${t.id}`, hash, { size: [t.metres, t.metres], pivot: [0, 0], sources: [t.source] }, () => {
        const { color, normal } = buildTile(t, sourceFile(t.source));
        writeFile(realPng(t.id, 'sprite'), encodePng(color));
        writeFile(realPng(t.id, 'normal'), encodePng(normal));
      });
      cat.tiles.push(t.id);
      log(t.source, { stage: 'tile', tool: t.stock ? 'resize and grade' : 'plate pass: 5 tone steps, 3-angle line screen, gradient map, tint slipped 2 px', note: `${t.id}: ${t.size} px tile for ${t.metres} m, GM ${t.gm.join('/')}` });
    }
    lines.push(`sprites: ${r.atlas}: ${r.pages.length} pages`);
  }

  function runJob(r: Recipe, j: Job): void {
    const plate = r.plates[j.source] ?? {};
    const cut: CutOut = j.drawn === 'paper-car' ? { image: drawPaperCar(sourceFile(j.source)), method: 'drawn', tool: 'code-drawn paper cut on the card stock (ImageMagick)', reason: '' } : plateCut(cache, j.source, plate, mem);
    const hash = hashInputs([], [code, JSON.stringify(j), JSON.stringify(plate.plateH ?? null), cache.get(`cut:${j.source}`) ?? '']);
    let meta: SpriteMeta | null = null;
    keep(j.id, `job:${j.id}`, hash, { size: [0, 0], pivot: [0, 0], sources: [j.source] }, () => {
      const out = jobRaster(j, cut.image, plate);
      writeSprite(j.id, out.color, bevelFor(j, out.color), j.treat === 'MASK');
      meta = { ...out.meta, sources: [j.source] };
    });
    if (meta !== null) cat.sprites[j.id] = meta;
    cat.methods[j.id] = { method: cut.method, tool: cut.tool, reason: cut.reason };
    log(j.source, { stage: 'cutout', tool: cut.tool, note: `${j.id}: ${cut.method}${cut.reason ? ` (${cut.reason})` : ''}, crop ${j.crop.join(',')}` });
    if ((j.remove ?? []).length > 0) log(j.source, { stage: 'sprite', tool: 'painted out', note: `${j.id}: ${(j.remove ?? []).map((m) => `${m.box.join(',')}${m.keep ? ` keeping ${m.keep}` : ''}`).join('; ')}` });
    for (const t of j.tint ?? []) log(j.source, { stage: 'tint', tool: 'OKLab hue-selected re-tint', note: `${j.id}: ${t.hue ?? 'all'} ${t.gm ? `GM ${t.gm.join('/')}` : ''}${t.toward ? `toward ${t.toward}` : ''}${t.sat !== undefined ? ` S under ${t.sat}` : ''}, amount ${t.amount ?? 0.6}` });
    if (j.engrave !== undefined) log(j.source, { stage: 'sprite', tool: 'hand-tinted print pass: tone steps, line screen, gradient map, chalk grain', note: `${j.id}: GM ${j.engrave.gm.join('/')}, pitch ${j.engrave.pitch} px` });
    if (j.ml === true) log(j.source, { stage: 'cutout', tool: 'local ML matte on the crop (rembg birefnet-general), edge defringed', note: `${j.id}: painted ground, paper key cannot separate it` });
    if (j.matte !== undefined) log(j.source, { stage: 'cutout', tool: 'hand garbage matte', note: `${j.id}: polygon of ${j.matte.length} points` });
    if (j.lumaKey !== undefined) log(j.source, { stage: 'cutout', tool: 'luminance key (LK)', note: `${j.id}: ${j.lumaKey.join(' to ')}` });
    if (j.treat === 'INK' || j.treat === 'MASK') log(j.source, { stage: 'sprite', tool: j.treat, note: `${j.id}: ${JSON.stringify(j.ink ?? j.mask ?? {})}` });
  }

  writeJson(REAL_CATALOG, cat);
  writeJson(EDITS, edits);
  const ml = Object.values(cat.methods).filter((m) => m.method === 'ml').length;
  lines.push(`sprites: ${Object.keys(cat.sprites).length} real sprites (${built} built, ${cached} cached), ${Object.keys(cat.blooms).length} blooms, ${cat.tiles.length} tiles; cut method per sprite: ${Object.keys(cat.methods).length - ml} classical, ${ml} ML`);
  return lines;
}
