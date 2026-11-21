import type { Page } from '@playwright/test';
import { expect, PROJECTS, test } from '../helpers/jardin.ts';

// Flow 10: the moth and the grotto easter egg (spec 16) never block opening or closing a project, and the egg
// scores with mouse and with touch. Garden only. The selectors below are the contract the world builder is asked
// to honour (ARCH 2.8, behaviours/gruta.ts); P1 adjusts them in this one block if they differ.

const GRUTA = {
  target: '#proxies [data-gruta-target]',
  score: '[data-gruta-score]',
} as const;

// A tap while the flytrap show plays only skips it (27-roam-boss), so the game is tried until a hit counts.
const score = async (page: Page): Promise<number> =>
  Number(((await page.locator(GRUTA.score).textContent()) ?? '0').replace(/\D/g, '') || 0);

test('flow 10 garden: the moth never blocks opening or closing a project', async ({ page, jardin }) => {
  const p = PROJECTS[0];
  if (p === undefined) return;
  await jardin.visit({ mode: 'garden' });
  await jardin.goto(`#/b/${p.bed}`, true);
  for (let i = 0; i < 5; i++) {
    await jardin.withApi((api) => api.send({ type: 'BLUR' })); // the moth may be circling or landed on a flower
    await jardin.goto(`#/p/${p.id}`);
    await jardin.expectOpen(p);
    await page.keyboard.press('Escape');
    await jardin.settled();
    expect(await jardin.openDialogs()).toBe(0);
  }
});

test('flow 10 garden: the grotto game never blocks a project and scores with the mouse', async ({ page, jardin }) => {
  const p = PROJECTS[0];
  if (p === undefined) return;
  await jardin.visit({ mode: 'garden' });
  await jardin.goto('#/b/gruta');
  const before = await score(page);
  await expect.poll(async () => {
    await page.locator(GRUTA.target).first().click();
    return score(page);
  }).toBeGreaterThan(before);
  await jardin.goto(`#/p/${p.id}`); // leaving mid-game must work
  await jardin.expectOpen(p);
  await page.keyboard.press('Escape');
  await jardin.settled();
  expect(await jardin.openDialogs()).toBe(0);
});

test('flow 10 garden: the grotto game scores with touch', async ({ page, jardin, isMobile }) => {
  test.skip(!isMobile, 'touch profiles only');
  await jardin.visit({ mode: 'garden' });
  await jardin.goto('#/b/gruta');
  const before = await score(page);
  await expect.poll(async () => {
    await page.locator(GRUTA.target).first().tap();
    return score(page);
  }).toBeGreaterThan(before);
});
