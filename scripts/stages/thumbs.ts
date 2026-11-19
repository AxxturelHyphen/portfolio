/// <reference types="node" />
// Thumbs stage (npm run assets thumbs): one static specimen per project flower for the Herbario, cut from the same
// plates as the garden sprites, on a transparent ground, as AVIF in public/thumbs/, plus public/thumbs/manifest.json
// (project id, file, source id, plate title) for the UI. The plate title is the source entry's title verbatim.
// Encoding goes through the system ImageMagick with its AVIF coder, build time only.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readJson, writeJson } from './common.ts';
import { REAL_CATALOG, realPng, type RealCatalog } from './sprites.ts';

export const THUMB_OUT = 'public/thumbs';
/** Long side of a specimen thumbnail, px (never upscaled). */
const THUMB_PX = 480;
const QUALITY = '62';

/** The specimen sprite per project. */
const SPECIMENS: readonly { project: string; sprite: string }[] = [
  { project: 'garagic', sprite: 'ro/a-bloom-9' },
  { project: 'php-playground', sprite: 'ro/b-bloom-9' },
  { project: 'adhd-guija', sprite: 'es/lily-e' },
  { project: 'ml-math', sprite: 'se/pod-3' },
  { project: 'ai-engineering', sprite: 'se/bud-a' },
];

/** One AVIF of a sprite PNG fitted into size x size (never upscaled), alpha kept. */
export function thumb(spritePng: string, out: string, size: number): void {
  mkdirSync(dirname(out), { recursive: true });
  execFileSync('magick', [spritePng, '-filter', 'Triangle', '-resize', `${size}x${size}>`, '-quality', QUALITY, out]);
}

export interface ThumbEntry { project: string; file: string; source: string; plateTitle: string }
interface SourceInfo { id: string; title: string }

export function runThumbs(sources: readonly SourceInfo[]): string {
  if (!existsSync(REAL_CATALOG)) return 'thumbs: no real sprites yet';
  const cat = readJson<RealCatalog>(REAL_CATALOG);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const entries: ThumbEntry[] = SPECIMENS.map(({ project, sprite }) => {
    const meta = cat.sprites[sprite];
    if (meta === undefined) throw new Error(`thumbs: sprite ${sprite} for ${project} is not built`);
    const source = meta.sources[0]!;
    const file = `${project}.avif`;
    thumb(realPng(sprite, 'sprite'), join(THUMB_OUT, file), THUMB_PX);
    const entry = byId.get(source);
    if (entry === undefined) throw new Error(`thumbs: source ${source} of ${project} has no entry`);
    return { project, file, source, plateTitle: entry.title };
  });
  writeJson(join(THUMB_OUT, 'manifest.json'), { size: THUMB_PX, thumbs: entries });
  return `thumbs: ${entries.length} specimens in ${THUMB_OUT}/ with manifest.json`;
}
