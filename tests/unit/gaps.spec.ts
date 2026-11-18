import { expect, test } from '@playwright/test';
import { lookup } from '../../src/content/i18n.ts';
import { loadContent } from '../../src/content/load.ts';
import { BLANK_GAPS, renderCaseBody, renderCaseHead } from '../../src/content/herbario/case.ts';
import { blank, onlyFill, text } from '../../src/content/herbario/html.ts';

// Owner gaps ([FILL] and [FILL: note]) in the garden's cards follow the Herbario without its notes: a gap inside a
// sentence is a quiet blank, a field that is nothing but a gap is left out with its heading, a gap link is not
// rendered. The Herbario keeps its marks.

const content = loadContent();

test('a gap inside a sentence is an empty quiet blank; the note never shows', () => {
  const html = blank('Released on Spotify. [FILL: owner confirms it goes in]');
  expect(html).toBe('Released on Spotify. <span class="h-fill"></span>');
  expect(text('a [FILL: note]')).toBe('a <span class="h-fill">[FILL: note]</span>');
});

test('only a field that is nothing but gaps counts as one', () => {
  expect(onlyFill('[FILL]')).toBe(true);
  expect(onlyFill(' [FILL: short screen recording] ')).toBe(true);
  expect(onlyFill('Spotify [FILL]')).toBe(false);
  expect(onlyFill('')).toBe(false);
});

test('the garden panel shows no gap mark, no empty section and no gap link, in both languages', () => {
  for (const l of ['en', 'es'] as const) {
    const s = (k: string): string => lookup(content.strings, l, k);
    for (const p of content.projects) {
      const html = renderCaseHead(p, l, s, 't', BLANK_GAPS) + renderCaseBody(p, l, s, BLANK_GAPS);
      expect(html, p.id).not.toContain('[FILL');
      expect(html, p.id).not.toMatch(/<div class="c-text"><p><span class="h-fill"><\/span><\/p>/);
      expect(html, p.id).not.toMatch(/<dd><span class="h-fill"><\/span><\/dd>/);
      expect(html, p.id).not.toMatch(/<ul class="[^"]*"><\/ul>/);
    }
  }
});

test('the Herbario case keeps its marks', () => {
  const s = (k: string): string => lookup(content.strings, 'en', k);
  const marked = content.projects.map((p) => renderCaseBody(p, 'en', s)).join('');
  expect(marked).toContain('<span class="h-fill">[FILL');
});
