/// <reference types="node" />
// Shared paths, JSON io, bed loading and the incremental cache of the asset pipeline (cook/ARCH.md section 3).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BedId, BedScene, BloomDef, SpriteId } from '../../src/types.ts';

export const WORK = 'archive/work';
export const ATLAS_OUT = 'public/atlas';
export const CATALOG = `${WORK}/sprites.json`;
export const PACK_DIR = `${WORK}/pack`;
/** Pixels per world unit of the hi atlases; lo pages are half of this. */
export const PX_PER_UNIT = 128;
export const OVERVIEW_PX_PER_UNIT = 64;
export const MAX_PAGE = 2048;
export const GUTTER = 8;
/** Sprite ids in the shared atlas (moth, P1 placeholder only). */
export const SHARED_SPRITES: readonly SpriteId[] = ['moth'];

/** One cut sprite as the pack stage reads it: archive/work/{sprite,normal}/<file>.png plus its world metrics. */
export interface SpriteMeta { size: [number, number]; pivot: [number, number]; sources: string[] }
export interface Catalog { sprites: Record<SpriteId, SpriteMeta>; blooms: Record<string, BloomDef> }

/** An owner's own file or plate from archive/OWN.json. `id`, when given, names a plate the recipes may cut from. */
export interface OwnEntry { file: string; note: string; id?: string }

/** archive/OWN.json in any of its accepted shapes: ["path"], [{file, note, id?}], {own: [...]} or {files: [...]}. */
export function readOwn(): OwnEntry[] {
  if (!existsSync('archive/OWN.json')) return [];
  const v = readJson<unknown>('archive/OWN.json');
  const list = Array.isArray(v) ? v : ((v as { own?: unknown[]; files?: unknown[] }).own ?? (v as { files?: unknown[] }).files ?? []);
  return list.map((e) => {
    if (typeof e === 'string') return { file: e, note: '' };
    const o = e as { file?: unknown; note?: unknown; id?: unknown };
    return { file: String(o.file), note: String(o.note ?? ''), ...(typeof o.id === 'string' ? { id: o.id } : {}) };
  });
}

export const safeName = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, '_');
export const spritePng = (id: SpriteId, kind: 'sprite' | 'normal'): string => `${WORK}/${kind}/${safeName(id)}.png`;

export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function writeFile(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

export const writeJson = (path: string, v: unknown): void => writeFile(path, `${JSON.stringify(v, null, 1)}\n`);

/** archive/raw/<category>/<file>; entries may give the path relative to archive/raw/ or to their category folder. */
export function rawPath(file: string, category: string): string {
  if (file.startsWith('archive/')) return file;
  const inCategory = join('archive/raw', category, file);
  return existsSync(inCategory) ? inCategory : join('archive/raw', file);
}

export const BED_DIR = 'content/beds';

export function bedFiles(): string[] {
  return existsSync(BED_DIR) ? readdirSync(BED_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => join(BED_DIR, f)) : [];
}

function checkScene(s: BedScene, file: string): void {
  const bad = (why: string): never => {
    throw new Error(`${file}: ${why}`);
  };
  if (typeof s.id !== 'string') bad('id missing');
  if (!Array.isArray(s.layers) || !Array.isArray(s.slots)) bad('layers and slots must be arrays');
  if (!Array.isArray(s.bounds) || s.bounds.length !== 2) bad('bounds must be [x0, x1]');
  for (const l of s.layers) {
    if (!Number.isInteger(l.page) || l.page < 0) bad(`layer ${l.id}: page must be an integer >= 0`);
    for (const it of l.items) if (typeof it.sprite !== 'string' || typeof it.scale !== 'number') bad(`layer ${l.id}: item needs sprite and scale`);
  }
}

/** Every content/beds/*.json, in garden order when content/garden.json exists. */
export function readBeds(): BedScene[] {
  const beds = bedFiles().map((f) => {
    const s = readJson<BedScene>(f);
    checkScene(s, f);
    return s;
  });
  const order = existsSync('content/garden.json') ? readJson<{ order?: BedId[] }>('content/garden.json').order ?? [] : [];
  const rank = (id: BedId): number => (order.includes(id) ? order.indexOf(id) : order.length);
  return beds.sort((a, b) => rank(a.id) - rank(b.id));
}

/** Incremental cache, archive/work/cache.json: one input hash per work item; a hit also needs every output on disk. */
export class Cache {
  private readonly path = `${WORK}/cache.json`;
  private readonly map: Record<string, string>;
  hits = 0;
  misses = 0;

  constructor() {
    this.map = existsSync(this.path) ? readJson<Record<string, string>>(this.path) : {};
  }

  fresh(item: string, hash: string, outputs: readonly string[]): boolean {
    const ok = this.map[item] === hash && outputs.every((o) => existsSync(o));
    if (ok) this.hits++;
    else this.misses++;
    return ok;
  }

  get(item: string): string | undefined {
    return this.map[item];
  }

  set(item: string, hash: string): void {
    this.map[item] = hash;
  }

  save(): void {
    writeJson(this.path, this.map);
  }
}

/** Hash of a list of files (content) and strings, for cache keys. */
export function hashInputs(files: readonly string[], extra: readonly string[] = []): string {
  const h = createHash('sha256');
  for (const f of files) h.update(f).update(existsSync(f) ? readFileSync(f) : 'missing');
  for (const e of extra) h.update(e);
  return h.digest('hex');
}
