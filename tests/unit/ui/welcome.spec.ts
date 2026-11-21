import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { gapFree, hasGap, hintKeys, slipKeys, sentencesOf } from '../../../src/ui/welcome.rules.ts';

// The first visit's rules: only sentences of the headline without an owner gap show, a filled gap brings its sentence
// back by itself, and the movement hint follows the input and the way through the garden. Every key has both languages.

const strings = JSON.parse(readFileSync('content/strings.json', 'utf8')) as Record<'en' | 'es', Record<string, string>>;
const profile = JSON.parse(readFileSync('content/profile.json', 'utf8')) as { headline: Record<'en' | 'es', string> };

test('sentences split at a full stop and a space, never inside a gap', () => {
  expect(sentencesOf('One. Two [FILL: a. b] here. Three')).toEqual(['One.', 'Two [FILL: a. b] here.', 'Three']);
  expect(sentencesOf('Version 1.5 ships. Done.')).toEqual(['Version 1.5 ships.', 'Done.']);
  expect(sentencesOf('')).toEqual([]);
});

test('a sentence with an owner gap never shows; the others keep their order', () => {
  expect(gapFree('Developer, currently working [FILL: role]. Studying ML math.')).toBe('Studying ML math.');
  expect(gapFree('[FILL]')).toBe('');
  expect(gapFree('Only filled text.')).toBe('Only filled text.');
  expect(hasGap('[FILL: something]')).toBe(true);
  expect(hasGap('A filled line.')).toBe(false);
});

test('the shipped headline shows its gap-free sentences today, and the first one once the owner fills it', () => {
  expect(gapFree(profile.headline.en)).toBe('Studying ML math, heading toward AI engineering.');
  expect(gapFree(profile.headline.es)).toBe('Estudiando matemáticas de ML, en camino hacia la ingeniería de IA.');
  const filled = profile.headline.en.replace(/\[FILL[^\]]*\]/, 'at a studio');
  expect(gapFree(filled).startsWith('Developer, currently working at a studio.')).toBe(true);
});

test('the hint follows the input: keys or click on desktop, tap or drag on touch, and the rail has its own words', () => {
  expect(hintKeys(false, true)).toEqual(['welcome.keys', 'welcome.work']);
  expect(hintKeys(true, true)).toEqual(['welcome.touch', 'welcome.work']);
  expect(hintKeys(false, false)).toEqual(['welcome.railKeys', 'welcome.work']);
  expect(hintKeys(true, false)).toEqual(['welcome.railTouch', 'welcome.work']);
});

test('with the play layer on, the slip leaves how to move to the help card and only says where the work is', () => {
  expect(slipKeys(true, true, true)).toEqual(['welcome.work']);
  expect(slipKeys(false, true, true)).toEqual(['welcome.work']);
  expect(slipKeys(false, true, false)).toEqual(['welcome.keys', 'welcome.work']);
});

test('every first-visit and plan string exists in both languages, plain: no exclamation mark (tests/unit/rules.spec.ts bans em dashes everywhere)', () => {
  const keys = ['welcome.keys', 'welcome.touch', 'welcome.railKeys', 'welcome.railTouch', 'welcome.work', 'plan.tag', 'plan.label', 'mode.exit', 'section.projects'];
  for (const lang of ['en', 'es'] as const) {
    for (const key of keys) {
      const s = strings[lang][key];
      expect(s, `${lang} ${key}`).toBeTruthy();
      expect(s, `${lang} ${key}`).not.toMatch(/[!¡]/);
    }
  }
});
