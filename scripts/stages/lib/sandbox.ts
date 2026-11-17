/// <reference types="node" />
// Pipeline sandbox: node scripts/stages/lib/sandbox.ts [sourceId ...]
// Runs cutout, sprite, normal and thumbs on real plates into .tmp/pipeline-test/ (never public/), with contact
// sheets on the night ground #181634 and 1:1 edge crops, so cut quality can be judged by eye. Default: the test set.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeFile, writeJson } from '../common.ts';
import { cutout, type CutHints } from '../cutout.ts';
import { normalMap, NORMAL_DEFAULTS } from '../normal.ts';
import { splitSprites, fitSprite } from '../sprite.ts';
import { thumb } from '../thumbs.ts';
import { raster, type Raster } from '../raster.ts';
import { writeImage } from './image.ts';

const OUT = '.tmp/pipeline-test';
const GROUND = '#181634';
const TEST_SET = [
  'cma_1959_14', 'cma_1965_291', 'cma_1943_138', 'cma-118176-japanese-iris', 'met-762064-fritillaria-imperialis',
  'butterfly-cramer-v1-n087', 'moth-huebner-v3-n014', 'com-paxton-nymphaea-rubra-98', 'wel-sabj375w-four-fern-fronds', 'haeckel_nepenthaceae',
];

interface Entry { id: string; file: string; cut?: CutHints }

function sources(): Map<string, Entry> {
  const map = new Map<string, Entry>();
  for (const f of readdirSync('archive/sources').filter((n) => n.endsWith('.json'))) for (const e of readJson<Entry[]>(join('archive/sources', f))) map.set(e.id, e);
  return map;
}

function fileFor(id: string, all: Map<string, Entry>): string {
  const e = all.get(id);
  if (e && existsSync(e.file)) return e.file;
  const hit = readdirSync('archive/raw', { recursive: true, encoding: 'utf8' }).find((p) => p.split('/').pop()?.startsWith(`${id}.`));
  if (!hit) throw new Error(`no source or raw file for ${id}`);
  return join('archive/raw', hit);
}

function sheet(files: string[], out: string, tile: string): void {
  execFileSync('magick', ['montage', ...files, '-background', GROUND, '-fill', '#d8d2f0', '-pointsize', '14', '-geometry', `${tile}+8+8`, '-tile', '5x', out]);
}

function main(): void {
  const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : TEST_SET;
  const all = sources();
  const report: unknown[] = [];
  const views: string[] = [];
  const zooms: string[] = [];
  const normals: string[] = [];
  const relits: string[] = [];
  for (const d of ['view', 'zoom']) mkdirSync(join(OUT, d), { recursive: true });
  for (const id of ids) {
    const t0 = performance.now();
    const cut = cutout(fileFor(id, all), all.get(id)?.cut ?? {});
    const tCut = performance.now() - t0;
    writeImage(join(OUT, 'cut', `${id}.png`), cut.image);
    const parts = splitSprites(cut.image);
    parts.forEach((part, k) => {
      const sprite = fitSprite(part.image, 'l');
      const name = `${id}.${k}`;
      writeImage(join(OUT, 'sprite', `${name}.png`), sprite);
      writeImage(join(OUT, 'normal', `${name}.png`), normalMap(sprite, NORMAL_DEFAULTS));
      if (k === 0) {
        normals.push(join(OUT, 'normal', `${name}.png`));
        writeImage(join(OUT, 'relit', `${name}.png`), relit(sprite, normalMap(sprite, NORMAL_DEFAULTS)));
        relits.push(join(OUT, 'relit', `${name}.png`));
      }
    });
    thumb(join(OUT, 'sprite', `${id}.0.png`), join(OUT, 'thumb', `${id}.avif`), 320);
    const view = join(OUT, 'view', `${id}.png`);
    execFileSync('magick', [join(OUT, 'cut', `${id}.png`), '-resize', '600x600', '-background', GROUND, '-flatten', '-set', 'label', `${id} ${cut.method} ${parts.length}p`, view]);
    const zoom = join(OUT, 'zoom', `${id}.png`);
    const [zx, zy] = edgePoint(cut.image.data, cut.image.w, cut.image.h);
    execFileSync('magick', [join(OUT, 'cut', `${id}.png`), '-crop', `360x360+${Math.max(0, zx - 180)}+${Math.max(0, zy - 180)}`, '+repage', '-background', GROUND, '-flatten', '-set', 'label', id, zoom]);
    views.push(view);
    zooms.push(zoom);
    const secs = (performance.now() - t0) / 1000;
    report.push({ id, method: cut.method, reason: cut.fallbackReason ?? '', quality: cut.quality, parts: parts.length, cutSeconds: +(tCut / 1000).toFixed(1), seconds: +secs.toFixed(1), tool: cut.tool });
    console.log(`${id}: ${cut.method}${cut.fallbackReason ? ` (${cut.fallbackReason})` : ''}, ${parts.length} parts, cov ${cut.quality.coverage.toFixed(3)} ragged ${cut.quality.ragged.toFixed(2)} leftover ${cut.quality.leftover.toFixed(3)} pale ${cut.quality.pale.toFixed(3)} seen ${cut.quality.seen.toFixed(2)}, ${secs.toFixed(1)} s`);
  }
  writeJson(join(OUT, 'report.json'), report);
  writeFile(join(OUT, '.gitignore'), '*\n');
  sheet(views, join(OUT, 'sheet-cut.png'), '300x300');
  sheet(zooms, join(OUT, 'sheet-edges.png'), '360x360');
  sheet(normals, join(OUT, 'sheet-normal.png'), '300x300');
  sheet(relits, join(OUT, 'sheet-relit.png'), '420x420');
  console.log(`sheets in ${OUT}/`);
}

const GROUND_RGB = [0x18, 0x16, 0x34] as const;
const LIGHT = ((x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
})(-0.7, 0.6, 0.45);

/** Preview of the cutout material: a low grazing light from the upper left over the normal map, composited on
 * the night ground, so the edge lift and line relief can be judged (pressed paper, not plastic). */
function relit(color: Raster, normal: Raster): Raster {
  const out = raster(color.w, color.h);
  for (let i = 0; i < color.w * color.h; i++) {
    const nx = normal.data[i * 4]! / 127.5 - 1;
    const ny = normal.data[i * 4 + 1]! / 127.5 - 1;
    const nz = normal.data[i * 4 + 2]! / 127.5 - 1;
    const shade = 0.35 + 0.9 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    const a = color.data[i * 4 + 3]! / 255;
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.min(255, Math.round(color.data[i * 4 + c]! * shade * a + GROUND_RGB[c]! * (1 - a)));
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** A point on the outline: the first opaque pixel scanning down the middle column band, for the 1:1 edge crop. */
function edgePoint(data: Uint8Array, w: number, h: number): [number, number] {
  for (let y = 0; y < h; y++) for (let x = Math.floor(w * 0.3); x < Math.floor(w * 0.7); x++) if (data[(y * w + x) * 4 + 3]! > 128) return [x, y];
  return [w >> 1, h >> 1];
}

main();
