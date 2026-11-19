import { expect, test } from '@playwright/test';
import { OWN_WALK_KEYS } from '../../../src/core/input.ts';

// Which focus keeps the walk keys (core/input.ts): fields, open dialogs and the open plan sheet do; every other control
// a visitor clicks (a tag, a toggle, a language link, a flower) leaves them to walk the visitor.

test('the walk keys stay with the garden on clicked controls, never in fields, dialogs or the plan sheet', async ({ page }) => {
  await page.setContent(`
    <button id="sound" class="tg-plate tg-sound">Sound</button>
    <a id="lang" href="?lang=es" data-lang="es">ES</a>
    <div class="pl"><section class="pl-sheet"><ul><li><button id="place">Rosaleda</button></li></ul></section><button id="plan" class="pl-tag">Projects</button></div>
    <div id="proxies"><button id="flower" class="px-slot">Rose</button></div>
    <input id="field"><textarea id="area"></textarea><div id="edit" contenteditable>x</div>
    <dialog id="panel"><section class="rl" tabindex="0" id="film">film</section><button id="close">Close</button></dialog>`);
  await page.evaluate(() => (document.getElementById('panel') as HTMLDialogElement).showModal());
  const owned = await page.evaluate((sel) => {
    const out: Record<string, boolean> = {};
    for (const id of ['sound', 'lang', 'plan', 'flower', 'place', 'field', 'area', 'edit', 'film', 'close']) out[id] = document.getElementById(id)?.closest(sel) !== null;
    return out;
  }, OWN_WALK_KEYS);
  expect(owned).toEqual({ sound: false, lang: false, plan: false, flower: false, place: true, field: true, area: true, edit: true, film: true, close: true });
});
