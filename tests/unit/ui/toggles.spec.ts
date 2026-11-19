import { expect, test } from '@playwright/test';
import strings from '../../../content/strings.json' with { type: 'json' };
import { renderToggles } from '../../../src/ui/toggles.ts';
import type { Strings } from '../../../src/types.ts';

const S = strings as Strings;

test('the panel bar renders the same controls with ids of its own', () => {
  const page = renderToggles(S, 'en', 'cv.pdf');
  const bar = renderToggles(S, 'en', 'cv.pdf', 'pn');
  expect(page).toContain('id="tg-note"');
  expect(bar).toContain('id="pn-note"');
  expect(bar).toContain('aria-describedby="pn-note"');
  expect(bar).not.toMatch(/(id|aria-describedby)="tg-note"/);
  for (const html of [page, bar]) {
    expect(html).toContain('data-mode="garden"');
    expect(html).toContain('class="tg-cv"');
    expect(html.match(/data-lang="/g)?.length).toBe(2);
  }
});

test('without JS the garden button is disabled and its note explains why', () => {
  const html = renderToggles(S, 'es', 'cv.pdf');
  expect(html).toMatch(/data-mode="garden"[^>]*aria-disabled="true"/);
  expect(html).toContain(S.es['mode.gardenNote'] ?? 'missing');
  expect(html).not.toContain(String.fromCharCode(0x2014));
});

test('the sound tag: hidden without JS, a toggle button that shows the choice once a script passes it', () => {
  expect(renderToggles(S, 'en', 'cv.pdf')).toMatch(/<button type="button" class="tg-plate tg-sound" data-sound aria-pressed="true" hidden>/);
  const on = renderToggles(S, 'es', 'cv.pdf', 'pn', true);
  expect(on).toMatch(/data-sound aria-pressed="true">/);
  expect(on).toContain(S.es['sound.label'] ?? 'missing');
  expect(renderToggles(S, 'en', 'cv.pdf', 'tg', false)).toMatch(/data-sound aria-pressed="false">/);
});
