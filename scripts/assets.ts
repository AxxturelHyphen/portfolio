/// <reference types="node" />
// npm run assets [stage ...]: the incremental, cached asset pipeline (cook/ARCH.md section 3).
// Stages in order: vendor (Basis transcoder into public/basis/), placeholder (flat sprites for whatever a bed
// places that no recipe makes yet), sprites (the real archive sprites of archive/recipes/*.json), pack, encode,
// merge (archive/SOURCES.json, after the atlases so usedIn is current), credits. `sheets` (contact sheets of every
// real sprite on the night ground) runs only when named. With no argument every default stage runs; each one skips
// work whose inputs are unchanged (archive/work/cache.json). Ends with the per-bed payload and GPU memory report.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AtlasManifest } from '../src/types.ts';
import { runPlaceholder } from './placeholder.ts';
import { ATLAS_OUT, BED_DIR, CATALOG, Cache, PACK_DIR, bedFiles, hashInputs, readBeds, readJson, spritePng, type Catalog } from './stages/common.ts';
import { runCredits } from './stages/credits.ts';
import { encoderNote, runEncode } from './stages/encode.ts';
import { SOURCES_DIR, runMerge } from './stages/merge.ts';
import { pageFiles, runPack } from './stages/pack.ts';
import { RECIPE_DIR } from './stages/recipe.ts';
import { runSheets } from './stages/sheets.ts';
import { REAL_CATALOG, realPng, runSprites, type RealCatalog } from './stages/sprites.ts';

const STAGES = ['vendor', 'placeholder', 'sprites', 'pack', 'encode', 'merge', 'credits', 'sheets'] as const;
const ON_DEMAND: readonly Stage[] = ['sheets'];
type Stage = (typeof STAGES)[number];
const BASIS_SRC = 'node_modules/three/examples/jsm/libs/basis';
const BASIS_OUT = 'public/basis';
const PACK_CODE = ['scripts/stages/pack.ts', 'scripts/stages/raster.ts', 'scripts/stages/normal.ts', 'scripts/stages/common.ts', 'scripts/stages/recipe.ts'];
const MB = 2 ** 20;
const BED_BUDGET_MB = 2;
const GPU_BUDGET = { high: 128, low: 48 };
/** Render targets from the cook/ARCH.md section 4 allocation, until gl measures them. */
const TARGETS_MB = { high: 21, low: 8 };

function vendor(): string {
  mkdirSync(BASIS_OUT, { recursive: true });
  for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) copyFileSync(join(BASIS_SRC, f), join(BASIS_OUT, f));
  return `vendor: three's Basis transcoder copied to ${BASIS_OUT}/`;
}

function pack(cache: Cache): { line: string; ids: AtlasManifest['id'][] } {
  const cat = existsSync(CATALOG) ? readJson<Catalog>(CATALOG) : { sprites: {}, blooms: {} };
  const real = existsSync(REAL_CATALOG) ? readJson<RealCatalog>(REAL_CATALOG) : { sprites: {} };
  const sprites = [
    ...Object.keys(cat.sprites).flatMap((id) => [spritePng(id, 'sprite'), spritePng(id, 'normal')]),
    ...Object.keys(real.sprites).flatMap((id) => [realPng(id, 'sprite'), realPng(id, 'normal')]),
  ];
  const recipes = existsSync(RECIPE_DIR) ? readdirSync(RECIPE_DIR).map((f) => join(RECIPE_DIR, f)) : [];
  const hash = hashInputs([...bedFiles(), 'content/garden.json', CATALOG, REAL_CATALOG, ...recipes, ...sprites, ...PACK_CODE]);
  const prev = cache.get('pack:ids');
  const prevIds = prev === undefined ? [] : (JSON.parse(prev) as AtlasManifest['id'][]);
  const outputs = prevIds.flatMap((id) => [`${PACK_DIR}/${id}.json`, ...readJsonOr(`${PACK_DIR}/${id}.json`).pages.flatMap((_, p) => Object.values(pageFiles(id, p)))]);
  if (prevIds.length > 0 && cache.fresh('pack', hash, outputs)) return { line: `pack: ${prevIds.length} atlases cached`, ids: prevIds };
  const warnings: string[] = [];
  const ids = runPack(readBeds(), warnings).map((m) => m.id);
  for (const w of warnings) console.log(w);
  cache.set('pack', hash);
  cache.set('pack:ids', JSON.stringify(ids));
  return { line: `pack: ${ids.length} atlases (${ids.join(', ')})`, ids };
}

/** Every scouted source with its category (the folder its raw file lives in). */
function archiveSources(): { id: string; file: string; category: string }[] {
  if (!existsSync(SOURCES_DIR)) return [];
  return readdirSync(SOURCES_DIR).filter((f) => f.endsWith('.json')).flatMap((f) => readJson<{ id: string; file: string }[]>(join(SOURCES_DIR, f)).map((e) => ({ id: e.id, file: e.file, category: basename(f, '.json') })));
}

const readJsonOr = (p: string): AtlasManifest => (existsSync(p) ? readJson<AtlasManifest>(p) : { id: 'shared', hash: '', pages: [], sprites: {}, blooms: {} });

const gpuBytes = (m: AtlasManifest, lo: boolean): number => {
  const k = lo ? 0.25 : 1;
  // 8 bpp after transcode (BC7, ASTC 4x4, ETC2 RGBA), 4/3 for mips; normal pages are half the linear size.
  return m.pages.reduce((s, p) => s + p.w * p.h * k * (1 + 0.25) * (4 / 3), 0);
};

function report(ids: readonly AtlasManifest['id'][]): string[] {
  const lines: string[] = [];
  const all = ids.map((id) => readJson<AtlasManifest>(join(ATLAS_OUT, `${id}.json`)));
  const beds = all.filter((m) => m.id !== 'overview' && m.id !== 'shared');
  for (const m of beds) {
    const scene = join(BED_DIR, `${m.id}.json`);
    const meta = statSync(join(ATLAS_OUT, `${m.id}.json`)).size + (existsSync(scene) ? statSync(scene).size : 0);
    const hi = (meta + m.pages.reduce((s, p) => s + p.fileBytes.hi, 0)) / MB;
    const lo = (meta + m.pages.reduce((s, p) => s + p.fileBytes.lo, 0)) / MB;
    lines.push(`bed ${m.id}: payload hi ${hi.toFixed(3)} MB, lo ${lo.toFixed(3)} MB (budget ${BED_BUDGET_MB}) ${hi <= BED_BUDGET_MB ? 'ok' : 'OVER'}; GPU hi ${(gpuBytes(m, false) / MB).toFixed(2)} MB, lo ${(gpuBytes(m, true) / MB).toFixed(2)} MB; ${m.pages.length} pages`);
  }
  const fixed = all.filter((m) => m.id === 'overview' || m.id === 'shared');
  for (const m of fixed) lines.push(`${m.id}: payload ${((statSync(join(ATLAS_OUT, `${m.id}.json`)).size + m.pages.reduce((s, p) => s + p.fileBytes.hi, 0)) / MB).toFixed(3)} MB, GPU ${(gpuBytes(m, false) / MB).toFixed(2)} MB`);
  for (const tier of ['high', 'low'] as const) {
    const lo = tier === 'low';
    const top3 = beds.map((m) => gpuBytes(m, lo)).sort((a, b) => b - a).slice(0, 3).reduce((s, v) => s + v, 0);
    const total = (top3 + fixed.reduce((s, m) => s + gpuBytes(m, lo), 0)) / MB + TARGETS_MB[tier];
    lines.push(`GPU resident worst case ${tier}: ${total.toFixed(1)} MB of ${GPU_BUDGET[tier]} (3 largest beds + overview + shared + ${TARGETS_MB[tier]} MB targets) ${total <= GPU_BUDGET[tier] ? 'ok' : 'OVER'}`);
  }
  return lines;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !STAGES.includes(a as Stage));
  if (unknown.length > 0) throw new Error(`unknown stage ${unknown.join(', ')}; stages: ${STAGES.join(', ')}`);
  const run = (s: Stage): boolean => (args.length === 0 && !ON_DEMAND.includes(s)) || args.includes(s);
  const cache = new Cache();
  const t0 = performance.now();
  try {
    if (run('vendor')) console.log(vendor());
    if (bedFiles().length === 0) console.log(`assets: no ${BED_DIR}/*.json yet; only the shared atlas is built`);
    if (run('placeholder')) console.log(runPlaceholder(cache));
    if (run('sprites')) for (const l of runSprites(cache, archiveSources())) console.log(l);
    let ids: AtlasManifest['id'][] = [];
    if (run('pack')) {
      const r = pack(cache);
      ids = r.ids;
      console.log(r.line);
    }
    if (run('encode')) {
      if (ids.length === 0) ids = JSON.parse(cache.get('pack:ids') ?? '[]') as AtlasManifest['id'][];
      console.log(`encode: ${encoderNote()}`);
      await runEncode(cache, ids);
      for (const l of report(ids)) console.log(l);
    }
    if (run('merge')) console.log(runMerge(cache));
    if (run('credits')) console.log(runCredits());
    if (run('sheets')) console.log(runSheets());
  } finally {
    cache.save();
  }
  console.log(`assets ok in ${((performance.now() - t0) / 1000).toFixed(1)} s (cache ${cache.hits} hits, ${cache.misses} misses)`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
