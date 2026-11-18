import { expect, test } from '@playwright/test';

// Free roam depth (cook/ROAM_PLAN.md 3): cutouts keep their paint order but write depth; an actor drawn last with a
// depth test shows over the far card and never over a card nearer the lens than it.
interface DepthProbe { measure(): Promise<{ near: number; nearChanged: number; actorShown: number }>; depthCut(): number }

test('the actor passes behind a nearer cutout and in front of a farther one', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./depth.html');
  await page.waitForFunction(() => (window as unknown as { __depth?: unknown }).__depth !== undefined);
  const r = await page.evaluate(() => (window as unknown as { __depth: DepthProbe }).__depth.measure());
  const cut = await page.evaluate(() => (window as unknown as { __depth: DepthProbe }).__depth.depthCut());
  expect(errors).toEqual([]);
  expect(cut).toBeGreaterThan(0);
  expect(r.near).toBeGreaterThan(1000);
  expect(r.actorShown).toBeGreaterThan(1000);
  expect(r.nearChanged).toBe(0);
});
