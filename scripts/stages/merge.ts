/// <reference types="node" />
// Merge stage: archive/sources/*.json (SourceEntry[], one file per category) into archive/SOURCES.json with the
// licence allowlist (PD, CC0, CC BY, CC BY-SA; never NC or ND), attribution required, unique ids, the raw file on
// disk and its sha256. usedIn comes from the sprite sources of the shipped atlas manifests; own files from
// archive/OWN.json. Never hand-edit the output. An entry that breaks a rule is left out of SOURCES.json with a warning;
// it is an error when a shipped atlas uses it (licence-check then trusts SOURCES.json alone).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AtlasManifest } from '../../src/types.ts';
import { ATLAS_OUT, readJson, sha256, writeJson, type Cache } from './common.ts';
import { EDITS, type Edit } from './sprites.ts';

export interface SourceEntry { id: string; title: string; creator: string; date: string; institution: string; sourceUrl: string; license: string; licenseUrl: string; attribution: string; file: string; need: string }
export interface MergedSource extends SourceEntry { category: string; sha256: string; usedIn: string[]; edits: { stage: string; tool: string; note: string }[] }
export interface SourcesFile { generated: string; sources: MergedSource[]; own: { file: string; note: string }[] }

export const SOURCES_DIR = 'archive/sources';
export const SOURCES_OUT = 'archive/SOURCES.json';
const FIELDS = ['id', 'title', 'creator', 'date', 'institution', 'sourceUrl', 'license', 'licenseUrl', 'attribution', 'file', 'need'] as const;
/** May be empty: an unknown date stays unknown, and public domain has no licence deed to link. */
const MAY_BE_EMPTY = new Set<string>(['date', 'licenseUrl']);

/** Allowlisted licence as an SPDX id or 'PD', or null when it is not allowed (NC, ND, unclear, anything else). */
export function normalizeLicence(raw: string): string | null {
  const s = raw.trim();
  if (/\b(NC|ND)\b|non-?commercial|no-?deriv|all rights reserved|unclear|unknown/i.test(s)) return null;
  if (/^(public domain|PD\b)/i.test(s)) return 'PD';
  if (/^CC0\b/i.test(s)) return 'CC0-1.0';
  const by = /^CC[- ]BY(-SA)?[- ]([1-4]\.0)\b/i.exec(s);
  if (by !== null) return `CC-BY${by[1] !== undefined ? '-SA' : ''}-${by[2]}`;
  return null;
}

/** archive/raw/<category>/<file>; entries may give the path relative to archive/raw/ or to their category folder. */
function rawPath(file: string, category: string): string {
  if (file.startsWith('archive/')) return file;
  const inCategory = join('archive/raw', category, file);
  return existsSync(inCategory) ? inCategory : join('archive/raw', file);
}

function shipUse(): Map<string, Set<string>> {
  const use = new Map<string, Set<string>>();
  if (!existsSync(ATLAS_OUT)) return use;
  for (const f of readdirSync(ATLAS_OUT).filter((f) => f.endsWith('.json'))) {
    const m = readJson<AtlasManifest>(join(ATLAS_OUT, f));
    for (const [sprite, r] of Object.entries(m.sprites)) for (const id of r.sources) (use.get(id) ?? use.set(id, new Set()).get(id))?.add(sprite);
  }
  return use;
}

function readOwn(): { file: string; note: string }[] {
  if (!existsSync('archive/OWN.json')) return [];
  const v = readJson<unknown>('archive/OWN.json');
  const list = Array.isArray(v) ? v : ((v as { own?: unknown[]; files?: unknown[] }).own ?? (v as { files?: unknown[] }).files ?? []);
  return list.map((e) => (typeof e === 'string' ? { file: e, note: '' } : { file: String((e as { file?: unknown }).file), note: String((e as { note?: unknown }).note ?? '') }));
}

/** Throws with every problem at once; returns the summary line. */
export function runMerge(cache: Cache): string {
  const problems: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  const sources: MergedSource[] = [];
  const use = shipUse();
  const edits = existsSync(EDITS) ? readJson<Record<string, Edit[]>>(EDITS) : {};
  const files = existsSync(SOURCES_DIR) ? readdirSync(SOURCES_DIR).filter((f) => f.endsWith('.json')).sort() : [];
  for (const f of files) {
    const category = basename(f, '.json');
    const list = readJson<unknown>(join(SOURCES_DIR, f));
    if (!Array.isArray(list)) {
      problems.push(`${f}: must be an array of SourceEntry`);
      continue;
    }
    for (const raw of list as Record<string, unknown>[]) {
      const where = `${f} ${String(raw['id'])}`;
      const reject = (why: string): void => void (use.has(String(raw['id'])) ? problems : skipped).push(`${where}: ${why}`);
      const missing = FIELDS.filter((k) => typeof raw[k] !== 'string' || (!MAY_BE_EMPTY.has(k) && (raw[k] as string).trim() === ''));
      if (missing.length > 0) {
        reject(`missing ${missing.join(', ')}`);
        continue;
      }
      const e = Object.fromEntries(FIELDS.map((k) => [k, raw[k] as string])) as unknown as SourceEntry;
      if (seen.has(e.id)) problems.push(`${where}: duplicate id`);
      seen.add(e.id);
      const license = normalizeLicence(e.license);
      if (license === null) {
        reject(`licence "${e.license}" is not on the allowlist (PD, CC0, CC BY, CC BY-SA)`);
        continue;
      }
      if (license !== 'PD' && e.licenseUrl.trim() === '') {
        reject(`licence ${license} needs licenseUrl`);
        continue;
      }
      const file = rawPath(e.file, category);
      if (!existsSync(file)) {
        reject(`file ${file} not found`);
        continue;
      }
      const st = statSync(file);
      const key = `sha:${file}`;
      const stamp = `${st.size}:${st.mtimeMs}`;
      let digest = cache.fresh(key, stamp, []) ? (cache.get(`${key}:v`) ?? '') : '';
      if (digest === '') {
        digest = sha256(readFileSync(file));
        cache.set(key, stamp);
        cache.set(`${key}:v`, digest);
      }
      sources.push({ ...e, license, file, category, sha256: digest, usedIn: [...(use.get(e.id) ?? [])].sort(), edits: use.has(e.id) ? (edits[e.id] ?? []) : [] });
    }
  }
  if (problems.length > 0) throw new Error(`merge: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  for (const line of skipped) console.log(`merge: left out ${line}`);
  const out: SourcesFile = { generated: 'npm run assets (merge stage); do not edit by hand', sources, own: readOwn() };
  writeJson(SOURCES_OUT, out);
  const used = sources.filter((s) => s.usedIn.length > 0).length;
  return `merge: ${sources.length} sources from ${files.length} categories into ${SOURCES_OUT} (${used} used in atlases)`;
}
