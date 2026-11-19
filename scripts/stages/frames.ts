/// <reference types="node" />
// Frames stage (npm run assets frames): the pictures the project film shows where the owner has no media yet. Each is
// a 16:9 crop of an archive flower plate, hand-tinted like old film stock, as a small AVIF in public/frames/, plus
// src/content/frames.json (project, file, source id, plate title, short name) that the film's lazy chunk imports.
// No plate repeats across projects, the Herbario specimens are left to the Herbario, and every word of a short
// name must appear in the plate's title, so a caption never says more than the source does. Encoding goes through
// the system ImageMagick with its AVIF coder, build time only.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { rawPath, writeJson } from './common.ts';

export const FRAME_OUT = 'public/frames';
export const FRAME_MANIFEST = 'src/content/frames.json';
const FRAME_W = 640;
const FRAME_H = 360;
const QUALITY = '56';
/** Hand tint: the plate's colour held back a little, then washed with the film stock's amber. */
const TINT = ['-modulate', '102,80,100', '-fill', '#c7ae82', '-colorize', '18%'];

/** A crop: centre (cx, cy) and width w, all as fractions of the plate; the height follows from 16:9. */
interface Crop { source: string; name: string; cx: number; cy: number; w: number }

/** Per project, in strip order: the plates its empty frames show (two each: the strip's shortest length). */
const PLATES: Readonly<Record<string, readonly Crop[]>> = {
  garagic: [
    { source: 'cma_1955_471', name: 'Rosa Gallica', cx: 0.52, cy: 0.24, w: 0.8 },
    { source: 'cma_1959_14', name: 'Cabbage Rose', cx: 0.52, cy: 0.36, w: 0.86 },
  ],
  'php-playground': [
    { source: 'cma_1965_293', name: 'Rosa Gallica Purpurea', cx: 0.5, cy: 0.24, w: 0.86 },
    { source: 'cma_1965_291', name: 'Rosa Damascena, subalba', cx: 0.5, cy: 0.24, w: 0.9 },
  ],
  'adhd-guija': [
    { source: 'com-victoria-regia-pl4-opening-stages', name: 'Victoria regia, plate 4', cx: 0.47, cy: 0.55, w: 0.8 },
    { source: 'com-victoria-regia-pl6-bud-opening', name: 'Victoria regia, plate 6', cx: 0.5, cy: 0.5, w: 0.86 },
  ],
  'ml-math': [
    { source: 'wel-zee8ph2h-chinese-lantern-watercolour', name: 'Chinese lantern', cx: 0.56, cy: 0.5, w: 0.86 },
    { source: 'wel-fkrcnr8h-magnolia-fruit', name: 'Magnolia', cx: 0.5, cy: 0.28, w: 0.9 },
  ],
  'ai-engineering': [
    { source: 'cma-132619-garden-hyacinth', name: 'Garden Hyacinth', cx: 0.5, cy: 0.22, w: 0.9 },
    { source: 'cma-118176-japanese-iris', name: 'Japanese Iris', cx: 0.47, cy: 0.18, w: 0.66 },
  ],
};

export interface FrameEntry { project: string; file: string; source: string; plateTitle: string; name: string }
interface SourceInfo { id: string; file: string; title: string; category: string }

const words = (s: string): string[] => s.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');

function size(file: string): [number, number] {
  const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', `${file}[0]`], { encoding: 'utf8' }).split(' ').map(Number);
  return [w!, h!];
}

/** The crop box in pixels, kept inside the plate. */
function box(c: Crop, w: number, h: number): string {
  const cw = Math.min(w, Math.round(c.w * w));
  const ch = Math.min(h, Math.round((cw * FRAME_H) / FRAME_W));
  const x = Math.min(w - cw, Math.max(0, Math.round(c.cx * w - cw / 2)));
  const y = Math.min(h - ch, Math.max(0, Math.round(c.cy * h - ch / 2)));
  return `${cw}x${ch}+${x}+${y}`;
}

export function runFrames(sources: readonly SourceInfo[], specimenSources: ReadonlySet<string>): string {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const seen = new Set<string>();
  mkdirSync(FRAME_OUT, { recursive: true });
  for (const f of readdirSync(FRAME_OUT)) rmSync(join(FRAME_OUT, f));
  const entries: FrameEntry[] = Object.entries(PLATES).flatMap(([project, crops]) => crops.map((c, i) => {
    const entry = byId.get(c.source);
    if (entry === undefined) throw new Error(`frames: source ${c.source} of ${project} has no entry`);
    if (seen.has(c.source) || specimenSources.has(c.source)) throw new Error(`frames: ${c.source} is already shown elsewhere`);
    seen.add(c.source);
    const missing = words(c.name).filter((w) => !words(entry.title).includes(w));
    if (missing.length > 0) throw new Error(`frames: name "${c.name}" of ${c.source} has words not in its title: ${missing.join(', ')}`);
    const raw = rawPath(entry.file, entry.category);
    if (!existsSync(raw)) throw new Error(`frames: plate ${raw} not found`);
    const file = `${project}-${i + 1}.avif`;
    const [w, h] = size(raw);
    execFileSync('magick', [`${raw}[0]`, '-crop', box(c, w, h), '+repage', '-filter', 'Triangle', '-resize', `${FRAME_W}x${FRAME_H}!`, ...TINT, '-strip', '-quality', QUALITY, join(FRAME_OUT, file)]);
    return { project, file, source: c.source, plateTitle: entry.title, name: c.name };
  }));
  writeJson(FRAME_MANIFEST, { frames: entries });
  return `frames: ${entries.length} plate frames in ${FRAME_OUT}/ with ${FRAME_MANIFEST}`;
}
