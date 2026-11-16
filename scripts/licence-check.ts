/// <reference types="node" />
// npm run licence: fails when a shipped image, audio or video file (public/, dist/) is not accounted for, or when a
// font has no licence text. Exit 1 with one line per problem, else one ok line.
//
// A shipped file is accounted for when one of these holds:
//  1. Owner's own file: declared in archive/OWN.json. Accepted shapes: ["path", ...], [{file, note}], {own:[...]} or
//     {files:[...]}. A path may end with * (prefix match). Paths are repo relative; dist/x counts as public/x.
//  2. Atlas page: named by a public/atlas/<id>.json manifest (AtlasManifest) whose sprites each list `sources`
//     ids, and every id has an entry with a licence in archive/SOURCES.json or archive/sources/*.json.
//  3. Direct entry: a source entry whose `shipped` field (string or list) names the file, or whose id equals the
//     file's base name without extensions.
// An entry counts only with a non-empty `license` (or `licence`) that is not NC, ND, all rights reserved or unclear.
// Fonts: public/fonts/LICENSES/ must hold a licence text whose name starts with the font family.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const MEDIA = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.ico', '.ktx2', '.mp3', '.ogg', '.wav', '.flac', '.m4a', '.opus', '.aac', '.mp4', '.webm']);
const FONT = new Set(['.woff2', '.woff', '.ttf', '.otf']);
const BAD_LICENCE = /\b(NC|ND)\b|non-?commercial|no-?deriv|all rights reserved|unclear|unknown|\[FILL\]/i;

type Json = Record<string, unknown>;
const problems: string[] = [];
const fail = (file: string, why: string): void => void problems.push(`licence FAIL ${file}: ${why}`);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
const norm = (p: string): string => p.replace(/^\.?\//, '').replace(/^dist\//, 'public/');

// Sources: archive/SOURCES.json (merged) and archive/sources/*.json (per category, arrays of SourceEntry).
const entries = new Map<string, Json>();
function addEntries(v: unknown, where: string): void {
  const list = Array.isArray(v) ? v : Array.isArray((v as Json | null)?.['sources']) ? ((v as Json)['sources'] as unknown[]) : [];
  for (const e of list) {
    if (typeof e !== 'object' || e === null) continue;
    const id = (e as Json)['id'];
    if (typeof id === 'string') entries.set(id, e as Json);
    else fail(where, 'source entry without id');
  }
}
if (existsSync('archive/SOURCES.json')) addEntries(readJson('archive/SOURCES.json'), 'archive/SOURCES.json');
for (const f of walk('archive/sources').filter((f) => f.endsWith('.json'))) addEntries(readJson(f), f);

function licenceProblem(id: string): string | null {
  const e = entries.get(id);
  if (e === undefined) return `source "${id}" has no entry in archive/SOURCES.json or archive/sources/*.json`;
  const lic = e['license'] ?? e['licence'];
  if (typeof lic !== 'string' || lic.trim() === '') return `source "${id}" has no licence`;
  if (BAD_LICENCE.test(lic)) return `source "${id}" has licence "${lic}"`;
  return null;
}

// Owner's own files.
const own: string[] = [];
if (existsSync('archive/OWN.json')) {
  const v = readJson('archive/OWN.json') as unknown;
  const list = Array.isArray(v) ? v : ((v as Json)['own'] ?? (v as Json)['files'] ?? []);
  for (const e of list as unknown[]) {
    const f = typeof e === 'string' ? e : (e as Json | null)?.['file'];
    if (typeof f === 'string') own.push(norm(f));
  }
}
const isOwn = (p: string): boolean => own.some((o) => (o.endsWith('*') ? p.startsWith(o.slice(0, -1)) : o === p));

// Atlas manifests: shipped page file to the source ids of every sprite on the bed.
const atlasSources = new Map<string, Set<string>>();
for (const f of walk('public/atlas').filter((f) => f.endsWith('.json'))) {
  const m = readJson(f) as { pages?: { color?: Record<string, string>; normal?: Record<string, string> }[]; sprites?: Record<string, { sources?: string[] }> };
  const ids = new Set<string>();
  for (const s of Object.values(m.sprites ?? {})) for (const id of s.sources ?? []) ids.add(id);
  for (const page of m.pages ?? []) {
    for (const v of [...Object.values(page.color ?? {}), ...Object.values(page.normal ?? {})]) {
      atlasSources.set(norm(join('public/atlas', v)), ids);
      atlasSources.set(norm(v), ids);
    }
  }
}

function checkMedia(file: string): void {
  const p = norm(file);
  if (isOwn(p)) return;
  const set = atlasSources.get(p);
  if (set !== undefined) {
    if (set.size === 0) return fail(file, 'atlas page whose sprites list no sources');
    for (const id of set) {
      const why = licenceProblem(id);
      if (why !== null) return fail(file, why);
    }
    return;
  }
  const base = basename(p).replace(/\..*$/, '');
  for (const [id, e] of entries) {
    const shipped = e['shipped'];
    const names = Array.isArray(shipped) ? shipped : typeof shipped === 'string' ? [shipped] : [];
    if (names.some((n) => typeof n === 'string' && norm(n) === p) || id === base) {
      const why = licenceProblem(id);
      if (why !== null) fail(file, why);
      return;
    }
  }
  fail(file, 'no entry in archive/SOURCES.json, archive/sources/*.json or archive/OWN.json');
}

function checkFont(file: string): void {
  const dir = 'public/fonts/LICENSES';
  const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const texts = existsSync(dir) ? readdirSync(dir) : [];
  const fam = squash(basename(file).replace(/\..*$/, ''));
  const ok = texts.some((t) => {
    const family = squash(t.replace(/-?(OFL|LICENSE|LICENCE|Apache|MIT)[^/]*$/i, ''));
    return family.length >= 3 && fam.startsWith(family) && statSync(join(dir, t)).size > 200;
  });
  if (!ok) fail(file, `no licence text in ${dir}/ for this font family`);
}

const shipped = [...walk('public'), ...walk('dist')].filter((f) => !norm(f).startsWith('public/fonts/LICENSES/'));
const seen = new Set<string>();
let checked = 0;
for (const f of shipped) {
  const ext = extname(f).toLowerCase();
  const key = norm(f);
  if (MEDIA.has(ext) && !seen.has(key)) {
    seen.add(key);
    checked++;
    checkMedia(f);
  } else if (FONT.has(ext) && !seen.has(key)) {
    seen.add(key);
    checked++;
    checkFont(f);
  }
}
// Hashed build outputs in dist/assets that come from CSS or JS imports cannot map to public/: they are checked by their own path.
if (problems.length > 0) {
  for (const p of problems) console.log(p);
  console.log(`licence FAIL: ${problems.length} problem${problems.length === 1 ? '' : 's'} in ${checked} shipped files`);
  process.exit(1);
}
console.log(`licence ok: ${checked} shipped images, sounds and fonts accounted for (${entries.size} source entries, ${own.length} own declarations)`);
