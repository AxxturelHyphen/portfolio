/// <reference types="node" />
// Encode stage: every packed page to KTX2 (Basis ETC1S, mipmaps, Y flipped so v = 0 is the bottom row), colour as
// sRGB, normal as linear with the normal-map preset; each also as a half-size .lo file. Completes the manifest
// drafts with fileBytes and a content hash into public/atlas/<id>.json and removes stale atlas files.
// Encoder: the ktx2-encoder npm package (Basis Universal compiled to wasm), so output is identical on every machine;
// a system ktx, toktx or basisu binary is only reported, never used.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ktx2 from 'ktx2-encoder';
import type { IEncodeOptions } from 'ktx2-encoder';
import type { AtlasManifest } from '../../src/types.ts';
import { ATLAS_OUT, PACK_DIR, hashInputs, readJson, sha256, writeFile, writeJson, type Cache } from './common.ts';
import { pageFiles } from './pack.ts';
import { decodePng, halve, type Raster } from './raster.ts';

const TOOL = `ktx2-encoder@${readJson<{ version: string }>('node_modules/ktx2-encoder/package.json').version}`;
const COLOR = { isUASTC: false, qualityLevel: 160, compressionLevel: 2, generateMipmap: true, isYFlip: true, isPerceptual: true, isSetKTX2SRGBTransferFunc: true, isKTX2File: true } as const;
const NORMAL = { isUASTC: false, qualityLevel: 200, compressionLevel: 2, generateMipmap: true, isYFlip: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false, isNormalMap: true, isKTX2File: true } as const;

/** Names a system KTX2 encoder on PATH, for the log only. */
export function systemEncoder(): string | null {
  for (const bin of ['ktx', 'toktx', 'basisu']) if (spawnSync('which', [bin], { encoding: 'utf8' }).status === 0) return bin;
  return null;
}

export const encoderNote = (): string => {
  const sys = systemEncoder();
  return `${TOOL} (wasm, deterministic on every machine${sys === null ? '; no system ktx, toktx or basisu found' : `; system ${sys} present but not used`})`;
};

/** tsc resolves the package's browser typings; Node loads its node entry, which exports NodeBasisEncoder. */
interface BasisEncoder { init(): Promise<unknown>; encode(data: Uint8Array, o: Partial<IEncodeOptions>): Promise<Uint8Array> }
const { NodeBasisEncoder } = ktx2 as unknown as { NodeBasisEncoder: new () => BasisEncoder };
let encoder: BasisEncoder | null = null;

/** The wasm module binds its status printer to console.log on init; init it once with a silent console.log. */
async function quietEncoder(): Promise<BasisEncoder> {
  if (encoder !== null) return encoder;
  const log = console.log;
  console.log = (): void => undefined;
  try {
    const e = new NodeBasisEncoder();
    await e.init();
    encoder = e;
    return e;
  } finally {
    console.log = log;
  }
}

async function encode(r: Raster, normal: boolean): Promise<Uint8Array> {
  const e = await quietEncoder();
  return e.encode(new Uint8Array(0), { ...(normal ? NORMAL : COLOR), enableDebug: false, imageDecoder: () => Promise.resolve({ width: r.w, height: r.h, data: r.data }) });
}

async function encodePage(cache: Cache, png: string, hiOut: string, loOut: string, normal: boolean): Promise<void> {
  const key = `encode:${hiOut}`;
  const hash = hashInputs([png], [TOOL, JSON.stringify(normal ? NORMAL : COLOR)]);
  if (cache.fresh(key, hash, [hiOut, loOut])) return;
  const hi = decodePng(readFileSync(png));
  writeFile(hiOut, await encode(hi, normal));
  writeFile(loOut, await encode(halve(hi), normal));
  cache.set(key, hash);
}

/** Encodes the pages of every draft in archive/work/pack/<id>.json and writes the final manifests. */
export async function runEncode(cache: Cache, ids: readonly AtlasManifest['id'][]): Promise<AtlasManifest[]> {
  const out: AtlasManifest[] = [];
  const keep = new Set<string>();
  for (const id of ids) {
    const m = readJson<AtlasManifest>(`${PACK_DIR}/${id}.json`);
    const files: string[] = [];
    for (let p = 0; p < m.pages.length; p++) {
      const page = m.pages[p];
      if (page === undefined) continue;
      const src = pageFiles(id, p);
      const at = (f: string): string => join(ATLAS_OUT, f);
      await encodePage(cache, src.c, at(page.color.hi), at(page.color.lo), false);
      await encodePage(cache, src.n, at(page.normal.hi), at(page.normal.lo), true);
      page.fileBytes = { hi: statSync(at(page.color.hi)).size + statSync(at(page.normal.hi)).size, lo: statSync(at(page.color.lo)).size + statSync(at(page.normal.lo)).size };
      files.push(at(page.color.hi), at(page.color.lo), at(page.normal.hi), at(page.normal.lo));
    }
    m.hash = sha256(JSON.stringify({ ...m, hash: '' }) + files.map((f) => sha256(readFileSync(f))).join('')).slice(0, 16);
    writeJson(join(ATLAS_OUT, `${id}.json`), m);
    for (const f of [...files, join(ATLAS_OUT, `${id}.json`)]) keep.add(f);
    out.push(m);
  }
  if (existsSync(ATLAS_OUT)) for (const f of readdirSync(ATLAS_OUT)) if (!keep.has(join(ATLAS_OUT, f)) && /\.(ktx2|json)$/.test(f)) rmSync(join(ATLAS_OUT, f));
  return out;
}
