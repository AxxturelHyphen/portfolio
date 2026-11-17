/// <reference types="node" />
// npm run compare -- S01,S03 [--round NN]
// One composite per up to 4 shots (reference left, render right, one row per shot), max 1568 px long side, JPEG q80,
// into cook/compare/rNN/. Pairing: cook/SHOTS.md if it exists (first R id on the shot's line that resolves to an
// image), else the first image ref in tests/shots.json. Refs live in cook/refs or refs. Builds the composite with
// cook/tools/side-by-side.mjs (ffmpeg). Also prints the color check deltas when cook/tools/color_check.py exists.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { loadShots, pickShots, type ShotDef } from '../tests/helpers/shots.ts';

const REF_DIRS = ['cook/refs', 'refs'];
const EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const ROWS_PER_SHEET = 4;
const MAX_SIDE = 1568;

function findRef(id: string): string | null {
  for (const dir of REF_DIRS) for (const e of EXTS) if (existsSync(`${dir}/${id}${e}`)) return `${dir}/${id}${e}`;
  return null;
}

interface Pair {
  id: string;
  ref: string;
  render: string;
  refCrop: string | null;
  renderCrop: string | null;
}

/** SHOTS.md section D table row for the shot: `| S03 | cook/refs/R03.png | ... --render-crop 420,0,1080,1080 |`. */
function pairing(shot: ShotDef): { ref: string | null; refCrop: string | null; renderCrop: string | null } {
  if (existsSync('cook/SHOTS.md')) {
    const md = readFileSync('cook/SHOTS.md', 'utf8');
    const d = md.slice(Math.max(0, md.indexOf('## D.')));
    for (const line of d.split('\n')) {
      const m = new RegExp(`^\\|\\s*${shot.id}\\s*\\|\\s*([^|\\s]+)\\s*\\|`).exec(line);
      if (m === null) continue;
      const rel = (m[1] ?? '').replace(/^cook\//, '');
      const direct = [rel, `cook/${rel}`].find((f) => existsSync(f));
      const ref = direct ?? findRef((m[1] ?? '').replace(/^.*\/refs\//, '').replace(/\.[a-z]+$/, ''));
      // Crops appear in the Note column of D, and for S03/S04 in prose ("same render crop").
      const note = line;
      return { ref, refCrop: /--ref-crop\s+([\d,]+)/.exec(note)?.[1] ?? null, renderCrop: /--render-crop\s+([\d,]+)/.exec(note)?.[1] ?? (/same render crop/.test(note) ? '420,0,1080,1080' : null) };
    }
  }
  return { ref: shot.refs.map(findRef).find((x) => x !== null) ?? null, refCrop: null, renderCrop: null };
}

function cropTo(src: string, crop: string | null, dst: string): string {
  if (crop === null) return src;
  const py = ['import sys', 'from PIL import Image', 'x,y,w,h=[int(v) for v in sys.argv[3].split(",")]', 'Image.open(sys.argv[1]).convert("RGB").crop((x,y,x+w,y+h)).save(sys.argv[2])'].join('\n');
  const r = spawnSync('python3', ['-I', '-c', py, src, dst, crop], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`crop failed: ${r.stderr.split('\n')[0]}`);
  return dst;
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

function colorCheck(pairs: Pair[]): void {
  if (!existsSync('cook/tools/color_check.py')) {
    console.log('color check: cook/tools/color_check.py absent');
    return;
  }
  for (const p of pairs) {
    const r = spawnSync('python3', ['-I', 'cook/tools/color_check.py', p.ref, p.render, ...(p.refCrop !== null ? ['--ref-crop', p.refCrop] : []), ...(p.renderCrop !== null ? ['--render-crop', p.renderCrop] : [])], { encoding: 'utf8' });
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

  const pairs: Pair[] = [];
  const missing: string[] = [];
  for (const s of shots) {
    const render = `cook/stills/r${round}/${s.id}.png`;
    const pr = pairing(s);
    const ref = pr.ref;
    if (!existsSync(render)) missing.push(`${s.id}: no render ${render}`);
    else if (ref === null) missing.push(`${s.id}: no image reference (${s.refs.join(',')})`);
    else pairs.push({ id: s.id, ref, render, refCrop: pr.refCrop, renderCrop: pr.renderCrop });
  }
  for (const m of missing) console.log(`skip ${m}`);
  if (pairs.length === 0) {
    console.log('compare: nothing to compare');
    return 1;
  }

  for (let i = 0; i < pairs.length; i += ROWS_PER_SHEET) {
    const chunk = pairs.slice(i, i + ROWS_PER_SHEET);
    const name = String.fromCharCode(97 + i / ROWS_PER_SHEET);
    const tmp = `${out}/.${name}.png`;
    // Cell box 696x392 (16:9), two cells per row: 1392 px wide, 392 px per row, so four rows stay inside 1568.
    const files = chunk.flatMap((p) => [cropTo(p.ref, p.refCrop, `${out}/.${p.id}.ref.png`), cropTo(p.render, p.renderCrop, `${out}/.${p.id}.render.png`)]);
    const r = spawnSync('node', ['cook/tools/side-by-side.mjs', '--out', tmp, '--height', '392', ...files], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.log(`FAIL ${name}: ${(r.stderr || r.stdout).split('\n')[0]}`);
      return 1;
    }
    toJpeg(tmp, `${out}/${name}.jpg`);
    rmSync(tmp, { force: true });
    for (const p of chunk) for (const k of ['ref', 'render']) rmSync(`${out}/.${p.id}.${k}.png`, { force: true });
    console.log(`wrote ${out}/${name}.jpg (${chunk.map((p) => `${p.id}: ${p.ref}`).join(', ')})`);
  }
  colorCheck(pairs);
  return missing.length > 0 ? 2 : 0;
}

process.exit(main());
