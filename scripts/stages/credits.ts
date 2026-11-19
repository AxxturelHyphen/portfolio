/// <reference types="node" />
// Credits stage: archive/SOURCES.json and public/fonts/LICENSES to src/content/credits.json, the data of the credits
// view (src/credits/). Only sources that ship (non-empty usedIn) are credited, grouped by the holder of the original,
// each with the full attribution line as printed, its licence, the link back to the record and what was changed.
// The fonts come from the licence texts that ship beside them; the owner's own files are listed apart.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeJson } from './common.ts';
import { SOURCES_OUT, type MergedSource, type SourcesFile } from './merge.ts';

export const CREDITS_OUT = 'src/content/credits.json';
const FONT_LICENCES = 'public/fonts/LICENSES';

/** What the pipeline did to a plate, in the words the credits view prints (content/strings.json credits.change.*). */
export type Change = 'cropped' | 'cutout' | 'tinted' | 'screened' | 'retouched';
export interface Credit { id: string; title: string; creator: string; license: string; licenseUrl: string; attribution: string; sourceUrl: string; changes: Change[]; usedIn: string[] }
export interface CreditsGroup { institution: string; items: Credit[] }
export interface FontCredit { family: string; copyright: string; license: string; licenseUrl: string; sourceUrl: string; file: string }
export interface CreditsFile { generated: string; groups: CreditsGroup[]; fonts: FontCredit[]; own: string[] }

/** One holder per museum or library: the merged records name the same one in several ways. */
const HOLDERS: readonly [RegExp, string][] = [
  [/Burgerbibliothek Bern/, 'Burgerbibliothek Bern'],
  [/Library of Congress/, 'Library of Congress'],
  [/Internet Archive/, 'Internet Archive'],
  [/National Gallery of Art/, 'National Gallery of Art, Washington'],
  [/Bibliotheque nationale de France/, 'Bibliotheque nationale de France'],
  [/Biodiversity Heritage Library/, 'Biodiversity Heritage Library'],
  [/Rijksmuseum/, 'Rijksmuseum, Amsterdam'],
  [/Cleveland Museum of Art/, 'The Cleveland Museum of Art'],
  [/^(Wikimedia Commons|Scan of Flora Batava)/, 'Wikimedia Commons'],
];

export function holderOf(institution: string): string {
  return HOLDERS.find(([re]) => re.test(institution))?.[1] ?? institution.trim();
}

const RECOLOURS = new Set(['tint', 'tile']);

/** The pipeline's edit log reduced to the kinds of change a licence asks to be told about, in a fixed order. */
export function changesOf(edits: MergedSource['edits']): Change[] {
  const out = new Set<Change>();
  for (const e of edits) {
    if (/\bcrop\b/.test(e.note)) out.add('cropped');
    if (e.stage === 'cutout' || e.stage === 'bloom' || e.stage === 'flags') out.add('cutout');
    if (RECOLOURS.has(e.stage) || (e.stage === 'sprite' && e.tool !== 'painted out')) out.add('tinted');
    if (e.stage === 'flags' || (e.stage === 'tile' && e.tool.startsWith('plate pass'))) out.add('screened');
    if (e.stage === 'sprite' && e.tool === 'painted out') out.add('retouched');
  }
  return (['cropped', 'cutout', 'tinted', 'screened', 'retouched'] as const).filter((c) => out.has(c));
}

/** A shipped OFL text: its first line is "Copyright <year> The <Family> Project Authors (<repository>)". */
export function fontOf(file: string, text: string): FontCredit | null {
  const m = /^Copyright (\d{4}) The (.+?) Project Authors \((https?:\/\/[^)]+)\)/.exec(text);
  if (m === null || !/SIL Open Font License, Version 1\.1/.test(text)) return null;
  const [, year = '', family = '', repo = ''] = m;
  return {
    family: family.replace(/-/g, ' '),
    copyright: `Copyright ${year} The ${family} Project Authors`,
    license: 'OFL-1.1',
    licenseUrl: 'https://openfontlicense.org',
    sourceUrl: repo.replace(/\.git$/, ''),
    file: `fonts/LICENSES/${file}`,
  };
}

function fontsIn(dir: string): FontCredit[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((f) => fontOf(f, readFileSync(join(dir, f), 'utf8')) ?? []);
}

/** Pure transform, sorted so the output is stable across runs. */
export function creditsOf(src: SourcesFile, fonts: readonly FontCredit[] = []): CreditsFile {
  const groups = new Map<string, Credit[]>();
  for (const s of src.sources) {
    if (s.usedIn.length === 0) continue;
    const item: Credit = { id: s.id, title: s.title, creator: s.creator, license: s.license, licenseUrl: s.licenseUrl, attribution: s.attribution, sourceUrl: s.sourceUrl, changes: changesOf(s.edits), usedIn: [...s.usedIn].sort() };
    const holder = holderOf(s.institution);
    groups.set(holder, [...(groups.get(holder) ?? []), item]);
  }
  return {
    generated: 'npm run assets (credits stage) from archive/SOURCES.json and public/fonts/LICENSES; do not edit by hand',
    groups: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([institution, items]) => ({ institution, items: items.sort((a, b) => a.id.localeCompare(b.id)) })),
    fonts: [...fonts],
    own: src.own.map((o) => o.note).sort(),
  };
}

/** Writes the credits file; returns the stage's log line. */
export function runCredits(out = CREDITS_OUT): string {
  if (!existsSync(SOURCES_OUT)) return `credits: no ${SOURCES_OUT} yet, run the merge stage first`;
  const c = creditsOf(readJson<SourcesFile>(SOURCES_OUT), fontsIn(FONT_LICENCES));
  writeJson(out, c);
  return `credits: ${c.groups.reduce((s, g) => s + g.items.length, 0)} sources from ${c.groups.length} holders, ${c.fonts.length} fonts, ${c.own.length} own files -> ${out}`;
}
