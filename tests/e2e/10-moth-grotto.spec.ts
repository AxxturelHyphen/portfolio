import { expect, PROJECTS, test } from '../helpers/jardin.ts';

// Flow 10: the moth and the grotto easter egg (spec 16) never block opening or closing a project, and the egg
// scores with mouse and with touch. Garden only. The selectors below are the contract the world builder is asked
// to honour (ARCH 2.8, behaviours/gruta.ts); P1 adjusts them in this one block if they differ.

const GRUTA = {
  host: '#proxies [data-slot*="gruta"], #proxies [data-prop="coupe"]',
  target: '#proxies [data-gruta-target]',
  score: '[data-gruta-score]',
} as const;

test.fixme('flow 10 garden: the moth never blocks opening or closing a project', async ({ page, jardin }) => {
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

test.fixme('flow 10 garden: the grotto game never blocks a project and scores with the mouse', async ({ page, jardin }) => {
  const p = PROJECTS[0];
  if (p === undefined) return;
  await jardin.visit({ mode: 'garden' });
  await jardin.goto('#/b/gruta');
  await page.locator(GRUTA.host).first().click();
  const before = Number(((await page.locator(GRUTA.score).textContent()) ?? '0').replace(/\D/g, '') || 0);
  await page.locator(GRUTA.target).first().click();
  await expect.poll(async () => Number(((await page.locator(GRUTA.score).textContent()) ?? '0').replace(/\D/g, '') || 0)).toBeGreaterThan(before);
  await jardin.goto(`#/p/${p.id}`); // leaving mid-game must work
  await jardin.expectOpen(p);
  await page.keyboard.press('Escape');
  await jardin.settled();
  expect(await jardin.openDialogs()).toBe(0);
});

test.fixme('flow 10 garden: the grotto game scores with touch', async ({ page, jardin, isMobile }) => {
  test.skip(!isMobile, 'touch profiles only');
  await jardin.visit({ mode: 'garden' });
  await jardin.goto('#/b/gruta');
  await page.locator(GRUTA.host).first().tap();
  const before = Number(((await page.locator(GRUTA.score).textContent()) ?? '0').replace(/\D/g, '') || 0);
  await page.locator(GRUTA.target).first().tap();
  await expect.poll(async () => Number(((await page.locator(GRUTA.score).textContent()) ?? '0').replace(/\D/g, '') || 0)).toBeGreaterThan(before);
});
