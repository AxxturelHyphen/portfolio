/// <reference types="node" />
// Sound stage (on demand, needs ffmpeg with libopus): each recipe of src/audio/sounds.ts from
// archive/raw/textures/audio/ to public/audio/<source id>.webm. Mono, band-limited, a loop crossfaded tail into head
// with equal-power curves so it repeats without a seam, a set of clips packed with short silences, then levelled
// (a bed to a mean level, a one-shot set to a peak) and encoded to Opus. Two ffmpeg passes per file: measure, encode.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CLIP_FADE_S, CLIP_GAP_S, SOUNDS, fileOf, type SoundId, type SoundRecipe } from '../../src/audio/sounds.ts';

const RAW_DIR = 'archive/raw/textures/audio';
const PUBLIC = 'public';
/** Highest peak a levelled bed may reach (dBFS). */
const BED_CEILING_DB = -1;

const f3 = (v: number): string => v.toFixed(3);

/** The filter graph that cuts and shapes one recipe; its output pad is [o]. */
export function graphOf(r: SoundRecipe): string {
  const [hp, lp] = r.band;
  const head = `[0:a]aformat=channel_layouts=mono,aresample=48000,highpass=f=${hp},highpass=f=${hp},lowpass=f=${lp}`;
  const [loop] = r.cuts;
  if (r.loopFade !== undefined && loop !== undefined) {
    const [a, b] = loop;
    const fade = r.loopFade;
    return `${head},asplit=2[x][y];`
      + `[x]atrim=${f3(a)}:${f3(b - fade)},asetpts=PTS-STARTPTS,afade=t=in:d=${f3(fade)}:curve=qsin[h];`
      + `[y]atrim=${f3(b - fade)}:${f3(b)},asetpts=PTS-STARTPTS,afade=t=out:d=${f3(fade)}:curve=qsin[t];`
      + '[h][t]amix=inputs=2:normalize=0:duration=first[o]';
  }
  const n = r.cuts.length;
  const pads = r.cuts.map((_, i) => `[s${i}]`).join('');
  const clips = r.cuts.map(([a, b], i) => {
    const dur = b - a;
    return `[s${i}]atrim=${f3(a)}:${f3(b)},asetpts=PTS-STARTPTS,afade=t=in:d=${f3(CLIP_FADE_S.in)},`
      + `afade=t=out:st=${f3(dur - CLIP_FADE_S.out)}:d=${f3(CLIP_FADE_S.out)},apad=pad_dur=${f3(CLIP_GAP_S)}[c${i}]`;
  });
  return `${head},asplit=${n}${pads};${clips.join(';')};${r.cuts.map((_, i) => `[c${i}]`).join('')}concat=n=${n}:v=0:a=1[o]`;
}

function ffmpeg(args: string[]): string {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr ?? '').split('\n').filter(Boolean).slice(-3).join(' | ')}`);
  return r.stderr ?? '';
}

/** Gain in dB that brings the measured levels to the recipe's target. */
export function gainOf(r: SoundRecipe, mean: number, peak: number): number {
  if ('mean' in r.level) return Math.min(r.level.mean - mean, BED_CEILING_DB - peak);
  return r.level.peak - peak;
}

function encode(id: SoundId): string {
  const r = SOUNDS[id];
  const raw = join(RAW_DIR, r.raw);
  if (!existsSync(raw)) throw new Error(`sound: ${raw} not found`);
  const graph = graphOf(r);
  const log = ffmpeg(['-i', raw, '-filter_complex', `${graph};[o]volumedetect[m]`, '-map', '[m]', '-f', 'null', '-']);
  const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(log)?.[1]);
  const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(log)?.[1]);
  if (!Number.isFinite(mean) || !Number.isFinite(peak)) throw new Error(`sound: could not measure ${id}`);
  const gain = gainOf(r, mean, peak);
  const out = join(PUBLIC, fileOf(id));
  mkdirSync(join(PUBLIC, 'audio'), { recursive: true });
  ffmpeg([
    '-i', raw, '-filter_complex', `${graph};[o]volume=${gain.toFixed(2)}dB[v]`, '-map', '[v]', '-map_metadata', '-1', '-fflags', '+bitexact',
    '-c:a', 'libopus', '-b:a', `${r.kbps}k`, '-vbr', 'on', '-application', 'audio', '-ac', '1', '-f', 'webm', out,
  ]);
  return `${id} ${(statSync(out).size / 1024).toFixed(0)} KB (gain ${gain.toFixed(1)} dB)`;
}

/** Writes every shipped sound; returns the stage's log line. */
export function runSound(): string {
  const lines = (Object.keys(SOUNDS) as SoundId[]).map(encode);
  return `sound: ${lines.join(', ')}`;
}
