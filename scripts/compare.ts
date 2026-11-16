/// <reference types="node" />
// npm run compare -- S01,S03 [--round NN]
// One composite per up to 3 shots (reference left, render right, one row per shot), max 1568 px long side, JPEG q80,
// into cook/compare/rNN/. Pairing: cook/SHOTS.md if it exists (first R id on the shot's line that resolves to an
// image), else the first image ref in tests/shots.json. Refs live in cook/refs or refs. Builds the composite with
// cook/tools/side-by-side.mjs (ffmpeg). Also prints the color check deltas when cook/tools/color_check.py exists.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { loadShots, pickShots, type ShotDef } from '../tests/helpers/shots.ts';

const REF_DIRS = ['cook/refs', 'refs'];
const EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const ROWS_PER_SHEET = 3;
const MAX_SIDE = 1568;

function findRef(id: string): string | null {
  for (const dir of REF_DIRS) for (const e of EXTS) if (existsSync(`${dir}/${id}${e}`)) return `${dir}/${id}${e}`;
  return null;
}

/** SHOTS.md pairing: any line mentioning the shot id, in order of appearance of R ids. */
function pairing(shot: ShotDef): string[] {
  if (!existsSync('cook/SHOTS.md')) return shot.refs;
  for (const line of readFileSync('cook/SHOTS.md', 'utf8').split('\n')) {
    if (!new RegExp(`\\b${shot.id}\\b`).test(line)) continue;
    const ids = line.match(/\b[RV]\d\d[a-z]?\b/g);
    if (ids !== null && ids.length > 0) return ids;
  }
  return shot.refs;
}

function toJpeg(png: string, jpg: string): void {
  const py = [
    'import sys',
    'from PIL import Image',
    'im=Image.open(sys.argv[1]).convert("RGB")',
    `im.thumbnail((${MAX_SIDE},${MAX_SIDE}))`,
    'im.save(sys.argv[2],"JPEG",quality=80,optimize=True)',
  ].join('\n');
  const r = spawnSync('python3', ['-I', '-c', py, png, jpg], { encoding: 'utf8' });
  if (r.status === 0) return;
  const f = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', png, '-vf', `scale='min(${MAX_SIDE},iw)':'min(${MAX_SIDE},ih)':force_original_aspect_ratio=decrease`, '-q:v', '5', jpg], { encoding: 'utf8' });
  if (f.status !== 0) throw new Error(`jpeg conversion failed: ${f.stderr.split('\n')[0]}`);
}

function colorCheck(pairs: { id: string; ref: string; render: string }[]): void {
  if (!existsSync('cook/tools/color_check.py')) {
    console.log('color check: cook/tools/color_check.py absent');
    return;
  }
  for (const p of pairs) {
    const r = spawnSync('python3', ['-I', 'cook/tools/color_check.py', p.ref, p.render], { encoding: 'utf8' });
    // The tool prints grids; the one-line deltas are the frame means and the mean lines.
    const lines = (r.stdout + r.stderr).split('\n').map((l) => l.trim()).filter((l) => /frame means|saturation ref|brightness ref|\bmean\b/.test(l));
    const out = lines.join(' | ');
    console.log(`color ${p.id}: ${out || `exit ${r.status}`}`);
  }
}

function main(): number {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--round');
  const list = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--round');
  const all = loadShots();
  const shots = pickShots(list ?? all.map((s) => s.id).join(','), all);
  let round = ri >= 0 ? String(argv[ri + 1] ?? '').padStart(2, '0') : '';
  if (round === '') {
    const rounds = existsSync('cook/stills') ? spawnSync('ls', ['cook/stills'], { encoding: 'utf8' }).stdout.split('\n').flatMap((d) => (/^r(\d+)$/.test(d) ? [Number(d.slice(1))] : [])) : [];
    round = String(rounds.length > 0 ? Math.max(...rounds) : 1).padStart(2, '0');
  }
  const out = `cook/compare/r${round}`;
  mkdirSync(out, { recursive: true });

  const pairs: { id: string; ref: string; render: string }[] = [];
  const missing: string[] = [];
  for (const s of shots) {
    const render = `cook/stills/r${round}/${s.id}.png`;
    const ref = pairing(s).map(findRef).find((x) => x !== null) ?? null;
    if (!existsSync(render)) missing.push(`${s.id}: no render ${render}`);
    else if (ref === null) missing.push(`${s.id}: no image reference for ${pairing(s).join(',')}`);
    else pairs.push({ id: s.id, ref, render });
  }
  for (const m of missing) console.log(`skip ${m}`);
  if (pairs.length === 0) {
    console.log('compare: nothing to compare');
    return 1;
  }

  for (let i = 0; i < pairs.length; i += ROWS_PER_SHEET) {
    const chunk = pairs.slice(i, i + ROWS_PER_SHEET);
    const name = chunk.length === 1 ? (chunk[0]?.id ?? '') : `${chunk[0]?.id}-${chunk[chunk.length - 1]?.id}`;
    const tmp = `${out}/.${name}.png`;
    // Cell box 782x440 (16:9), two cells per row: 1564 px wide, 440 px per row, so three rows stay inside 1568.
    const files = chunk.flatMap((p) => [p.ref, p.render]);
    const r = spawnSync('node', ['cook/tools/side-by-side.mjs', '--out', tmp, '--height', '440', ...files], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.log(`FAIL ${name}: ${(r.stderr || r.stdout).split('\n')[0]}`);
      return 1;
    }
    toJpeg(tmp, `${out}/${name}.jpg`);
    rmSync(tmp, { force: true });
    console.log(`wrote ${out}/${name}.jpg (${chunk.map((p) => `${p.id}: ${p.ref}`).join(', ')})`);
  }
  colorCheck(pairs);
  return missing.length > 0 ? 2 : 0;
}

process.exit(main());
