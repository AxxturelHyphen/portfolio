/// <reference types="node" />
// Credits stage: archive/SOURCES.json to src/content/credits.json, the data of the credits page in the Herbario.
// Only sources that ship (non-empty usedIn) are credited, grouped by institution, each with the full attribution
// line as printed, its licence and the link back to the record. The owner's own files are listed apart.
import { existsSync } from 'node:fs';
import { readJson, writeJson } from './common.ts';
import { SOURCES_OUT, type SourcesFile } from './merge.ts';

export const CREDITS_OUT = 'src/content/credits.json';

export interface Credit { id: string; title: string; creator: string; date: string; license: string; licenseUrl: string; attribution: string; sourceUrl: string; usedIn: string[] }
export interface CreditsGroup { institution: string; items: Credit[] }
export interface CreditsFile { generated: string; groups: CreditsGroup[]; own: string[] }

/** Pure transform, sorted so the output is stable across runs. */
export function creditsOf(src: SourcesFile): CreditsFile {
  const groups = new Map<string, Credit[]>();
  for (const s of src.sources) {
    if (s.usedIn.length === 0) continue;
    const item: Credit = { id: s.id, title: s.title, creator: s.creator, date: s.date, license: s.license, licenseUrl: s.licenseUrl, attribution: s.attribution, sourceUrl: s.sourceUrl, usedIn: [...s.usedIn].sort() };
    groups.set(s.institution, [...(groups.get(s.institution) ?? []), item]);
  }
  return {
    generated: 'npm run assets (credits stage) from archive/SOURCES.json; do not edit by hand',
    groups: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([institution, items]) => ({ institution, items: items.sort((a, b) => a.id.localeCompare(b.id)) })),
    own: src.own.map((o) => o.note).sort(),
  };
}

/** Writes the credits file; returns the stage's log line. */
export function runCredits(out = CREDITS_OUT): string {
  if (!existsSync(SOURCES_OUT)) return `credits: no ${SOURCES_OUT} yet, run the merge stage first`;
  const c = creditsOf(readJson<SourcesFile>(SOURCES_OUT));
  writeJson(out, c);
  return `credits: ${c.groups.reduce((s, g) => s + g.items.length, 0)} sources from ${c.groups.length} institutions, ${c.own.length} own files -> ${out}`;
}
