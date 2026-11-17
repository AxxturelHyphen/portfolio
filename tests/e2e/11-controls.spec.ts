import type { Locator, Page } from '@playwright/test';
import { measureBleed, bleedError, nextFrames } from '../unit/ui/fullbleed.ts';
import { expect, PROJECTS, test, type Jardin } from '../helpers/jardin.ts';

// Round 02 UI: the three fixed controls (language, Download CV, way-out) stay visible and operable with the panel open,
// in the garden and in the Herbario; and the canvas fills the viewport on this profile, also with the panel open.

const first = PROJECTS[0];
if (first === undefined) throw new Error('content/projects.json has no project');

interface Bar {
  root: Locator;
  lang: Locator;
  cv: Locator;
  exit: Locator;
}
/** The controls inside `scope` (#toggles on the page, dialog#panel while the modal makes the page inert). */
function bar(page: Page, scope: '#toggles' | 'dialog#panel'): Bar {
  const root = page.locator(`${scope} .tg`).first();
  return { root, lang: root.locator('[data-lang]'), cv: root.locator('.tg-cv'), exit: root.locator('.tg-exit') };
}

/** Visible, inside the viewport and not covered: the element at its centre is the control or inside it. */
async function reachable(loc: Locator, what: string): Promise<void> {
  await expect(loc.first(), `${what} visible`).toBeVisible();
  const r = await loc.first().evaluate((el) => {
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return { x: b.x, y: b.y, r: b.right, b: b.bottom, hit: hit !== null && (el === hit || el.contains(hit)), w: innerWidth, h: innerHeight, tag: hit?.className ?? 'none' };
  });
  expect(r.x >= -0.5 && r.y >= -0.5 && r.r <= r.w + 0.5 && r.b <= r.h + 0.5, `${what} inside the viewport ${JSON.stringify(r)}`).toBe(true);
  expect(r.hit, `${what} not covered, top element is ${r.tag}`).toBe(true);
}

async function allThree(b: Bar, where: string): Promise<void> {
  await reachable(b.lang.first(), `${where}: language link`);
  await reachable(b.lang.last(), `${where}: second language link`);
  await reachable(b.cv, `${where}: Download CV`);
  await reachable(b.exit, `${where}: way-out`);
  expect(await b.cv.getAttribute('download'), `${where}: CV is a download link`).not.toBeNull();
  expect(await b.exit.getAttribute('aria-disabled'), `${where}: way-out enabled`).toBeNull();
}

/** Click the other language, check it applies (aria-current and html lang), then put it back. */
async function langWorks(page: Page, b: Bar, where: string): Promise<void> {
  const cur = (await page.evaluate(() => document.documentElement.lang)) || 'en';
  const other = cur === 'es' ? 'en' : 'es';
  await b.lang.locator(`xpath=self::*[@data-lang="${other}"]`).or(b.root.locator(`[data-lang="${other}"]`)).first().click();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang), { message: `${where}: language switched` }).toBe(other);
  await expect(b.root.locator(`[data-lang="${other}"]`).first(), `${where}: aria-current moved`).toHaveAttribute('aria-current', 'true');
  await b.root.locator(`[data-lang="${cur}"]`).first().click();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(cur);
}

async function cvDownloads(page: Page, b: Bar, where: string): Promise<void> {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), b.cv.click()]);
  expect(dl.suggestedFilename(), `${where}: CV file name`).toMatch(/\.pdf$/i);
}

async function bleed(page: Page, where: string): Promise<void> {
  await nextFrames(page);
  expect(bleedError(await measureBleed(page)), `${where}: canvas equals viewport`).toBeNull();
}

test('controls garden: language, Download CV and way-out are visible and work, canvas fills the viewport', async ({ page, jardin }: { page: Page; jardin: Jardin }) => {
  await jardin.visit({ mode: 'garden', hash: '#/b/rosaleda' });
  await jardin.goto('#/b/rosaleda', true);
  const b = bar(page, '#toggles');
  await allThree(b, 'garden');
  await bleed(page, 'garden');
  await langWorks(page, b, 'garden');
  await cvDownloads(page, b, 'garden');
  await expect(b.exit).toHaveAttribute('data-mode', 'herbario');
  await b.exit.click();
  await expect.poll(() => jardin.mode(), { message: 'way-out leads to the Herbario' }).toBe('herbario');
});

test('controls herbario: language, Download CV and way-out are visible and work', async ({ page, jardin }: { page: Page; jardin: Jardin }) => {
  await jardin.visit({ mode: 'herbario' });
  const b = bar(page, '#toggles');
  await allThree(b, 'herbario');
  await langWorks(page, b, 'herbario');
  await cvDownloads(page, b, 'herbario');
  await expect(b.exit).toHaveAttribute('data-mode', 'garden');
  await b.exit.click();
  await expect.poll(() => jardin.mode(), { message: 'way-out leads to the garden', timeout: 15000 }).toBe('garden');
  await jardin.settled();
  await bleed(page, 'herbario to garden');
});

test('controls panel open in the garden: the same three controls work inside the dialog', async ({ page, jardin }: { page: Page; jardin: Jardin }) => {
  await jardin.visit({ mode: 'garden', hash: '#/b/rosaleda' });
  await jardin.goto('#/b/rosaleda', true);
  await jardin.goto(`#/p/${first.id}`);
  await jardin.expectOpen(first);
  const b = bar(page, 'dialog#panel');
  await allThree(b, 'panel in garden');
  await bleed(page, 'panel in garden');
  await langWorks(page, b, 'panel in garden');
  expect(await jardin.isPanelOpen(), 'language switch leaves the panel open').toBe(true);
  await cvDownloads(page, b, 'panel in garden');
  expect(await jardin.isPanelOpen(), 'download leaves the panel open').toBe(true);
  await b.exit.click();
  await expect.poll(() => jardin.mode(), { message: 'way-out from the panel leads to the Herbario' }).toBe('herbario');
  await jardin.expectOpen(first);
});

test('controls panel open in the Herbario: the same three controls work inside the dialog', async ({ page, jardin }: { page: Page; jardin: Jardin }) => {
  await jardin.visit({ mode: 'herbario' });
  await jardin.open(first.id);
  await jardin.expectOpen(first);
  const b = bar(page, 'dialog#panel');
  await allThree(b, 'panel in herbario');
  await langWorks(page, b, 'panel in herbario');
  expect(await jardin.isPanelOpen()).toBe(true);
  await cvDownloads(page, b, 'panel in herbario');
  await b.exit.click();
  await expect.poll(() => jardin.mode(), { message: 'way-out from the panel leads to the garden', timeout: 15000 }).toBe('garden');
  await jardin.expectOpen(first);
});

test('travel: a jump of more than one bed settles with the target active and the canvas full', async ({ page, jardin }: { page: Page; jardin: Jardin }) => {
  await jardin.visit({ mode: 'garden' });
  await jardin.goto('#/b/puerta', true);
  await jardin.goto('#/b/gruta');
  expect((await jardin.withApi((api) => api.residency())).gruta).toBe('active');
  await bleed(page, 'after a jump');
});
