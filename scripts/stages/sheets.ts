/// <reference types="node" />
// Contact sheets (npm run assets sheets): every real sprite on the night ground #181634, at its on-screen size at a
// 1080p bed key (1 m = 277 px, the Rosaleda key's 3.9 m frame) and at twice that, plus the relit normal preview,
// into archive/work/sheets/. For judging cuts by eye; never shipped.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORK, readJson, writeFile } from './common.ts';
import { decodePng, encodePng, raster } from './raster.ts';
import { REAL_CATALOG, realPng, type RealCatalog } from './sprites.ts';

const OUT = `${WORK}/sheets`;
const GROUND = '#181634';
const PX_PER_M = 277;
const MAX_PX = 300;
const PER_SHEET = 18;
const LIGHT = [-0.62, 0.55, 0.56] as const;

function relit(id: string, out: string): void {
  const c = decodePng(readFileSync(realPng(id, 'sprite')));
  const n = decodePng(readFileSync(realPng(id, 'normal')));
  const r = raster(c.w, c.h);
  const g = [0x18, 0x16, 0x34];
  for (let i = 0; i < c.w * c.h; i++) {
    const d = (n.data[i * 4]! / 127.5 - 1) * LIGHT[0] + (n.data[i * 4 + 1]! / 127.5 - 1) * LIGHT[1] + (n.data[i * 4 + 2]! / 127.5 - 1) * LIGHT[2];
    const shade = 0.3 + 0.95 * Math.max(0, d);
    const a = c.data[i * 4 + 3]! / 255;
    for (let k = 0; k < 3; k++) r.data[i * 4 + k] = Math.min(255, Math.round(c.data[i * 4 + k]! * shade * a + g[k]! * (1 - a)));
    r.data[i * 4 + 3] = 255;
  }
  writeFile(out, encodePng(r));
}

function montage(files: string[], labels: string[], out: string, cols: number): void {
  const args = files.flatMap((f, k) => ['-label', labels[k]!, f]);
  execFileSync('magick', ['montage', ...args, '-background', GROUND, '-fill', '#d8d2f0', '-pointsize', '13', '-geometry', '+10+10', '-tile', `${cols}x`, out], { maxBuffer: 1 << 28 });
}

export function runSheets(): string {
  if (!existsSync(REAL_CATALOG)) return 'sheets: no real sprites yet';
  const cat = readJson<RealCatalog>(REAL_CATALOG);
  const ids = Object.keys(cat.sprites).filter((id) => !cat.tiles.includes(id)).sort();
  mkdirSync(join(OUT, 'tmp'), { recursive: true });
  const at1: string[] = [];
  const at2: string[] = [];
  const lit: string[] = [];
  for (const id of ids) {
    const h = cat.sprites[id]!.size[1];
    const safe = id.replace(/\//g, '_');
    for (const [k, list] of [[1, at1], [2, at2]] as const) {
      const f = join(OUT, 'tmp', `${safe}.${k}.png`);
      // Capped so a 6 m tree does not swamp the sheet; the label keeps the true on-screen height.
      const px = Math.min(MAX_PX * k, Math.max(24, Math.round(h * PX_PER_M * k)));
      execFileSync('magick', [realPng(id, 'sprite'), '-filter', 'Triangle', '-resize', `x${px}`, '-background', GROUND, '-flatten', f]);
      list.push(f);
    }
    const f = join(OUT, 'tmp', `${safe}.lit.png`);
    relit(id, f);
    execFileSync('magick', [f, '-resize', '320x320>', f]);
    lit.push(f);
  }
  const labels = ids.map((id) => `${id} ${Math.round(cat.sprites[id]!.size[1] * PX_PER_M)}px`);
  for (let p = 0; p * PER_SHEET < ids.length; p++) {
    const part = (l: string[]): string[] => l.slice(p * PER_SHEET, (p + 1) * PER_SHEET);
    montage(part(at1), part(labels), join(OUT, `onscreen-${p}.png`), 6);
    montage(part(at2), part(labels), join(OUT, `onscreen-2x-${p}.png`), 4);
  }
  montage(lit, ids, join(OUT, 'relit.png'), 6);
  for (const t of cat.tiles) execFileSync('magick', [realPng(t, 'sprite'), '-resize', '512x512', '(', '+clone', ')', '+append', '(', '+clone', ')', '-append', join(OUT, 'tmp', `${t.replace(/\//g, '_')}.tile.png`)]);
  if (cat.tiles.length > 0) montage(cat.tiles.map((t) => join(OUT, 'tmp', `${t.replace(/\//g, '_')}.tile.png`)), cat.tiles, join(OUT, 'tiles.png'), 3);
  writeFile(join(OUT, '.gitignore'), '*\n');
  return `sheets: ${ids.length} sprites, ${cat.tiles.length} tiles -> ${OUT}/{onscreen-N,onscreen-2x-N,relit,tiles}.png`;
}
