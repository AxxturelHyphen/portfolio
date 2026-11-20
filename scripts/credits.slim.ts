import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { ATTRIBUTION } from '../src/credits/attribution.ts';
import type { Credit, CreditsFile } from './stages/credits.ts';

const CREDITS = /[\\/]src[\\/]content[\\/]credits\.json$/;

/** What the credits view prints of an entry: the attribution line only where the licence asks for it. */
function shown(c: Credit): Partial<Credit> {
  const { title, creator, license, licenseUrl, sourceUrl, changes, attribution } = c;
  return { title, creator, license, licenseUrl, sourceUrl, changes, ...(ATTRIBUTION.test(license) ? { attribution } : {}) };
}

/**
 * Vite plugin (build only): src/content/credits.json ships with only the fields the credits view reads. The record ids,
 * where each work is used and the stage's own notes stay in the source file for the pipeline and the licence check.
 */
export function creditsSlim(): Plugin {
  return {
    name: 'jardin-credits-slim',
    apply: 'build',
    enforce: 'pre',
    load(id) {
      if (!CREDITS.test(id)) return null;
      const file = JSON.parse(readFileSync(id, 'utf8')) as CreditsFile;
      const groups = file.groups.map((g) => ({ institution: g.institution, items: g.items.map(shown) }));
      return JSON.stringify({ groups, sounds: file.sounds.map(shown), fonts: file.fonts });
    },
  };
}
