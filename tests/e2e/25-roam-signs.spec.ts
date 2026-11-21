import { expect, test } from '../helpers/jardin.ts';
import { enterRoam, roamAt, untilStill } from '../helpers/roam.ts';

// Free roam's signboards (ui/signposts.ts, garden/signs.drive.ts): a plank that names the place the visitor stands in
// folds away in the world, and its board button is inert (no pointer, focus or screen reader reaches it); the Tab order
// keeps only the current place's two signs. Walking on, the planks naming the new place fold and the others come back.

/** The Estanque stand point (x, m), and a point inside the Rosaleda. */
const ESTANQUE_X = 20;
const ROSALEDA_X = 12;

test('roam signs: a plank naming the current place folds away and its button is inert; Tab keeps the current two', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/estanque');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(1500);
  await page.keyboard.up('ArrowLeft');
  await untilStill(page);
  await jardin.settled();
  expect((await roamAt(jardin)).x, 'walked off the Estanque stand point').toBeLessThan(ESTANQUE_X - 2);

  const tabbable = await page.locator('#proxies .px-sign:not([hidden])').evaluateAll((ns) => ns
    .filter((n) => (n as HTMLElement).tabIndex >= 0)
    .map((n) => (n as HTMLElement).dataset['dir'] ?? 'board'));
  expect(tabbable.sort(), 'only the current place\'s two signs are in the Tab order').toEqual(['next', 'prev']);

  // The Rosaleda's plank pointing here names the Estanque: on screen, folded, and its button lets the pointer through.
  const folded = page.locator('#proxies .px-sign[data-board][data-bed="rosaleda"]:not([hidden])').first();
  await expect(folded).toBeAttached();
  const hit = await folded.evaluate((n) => {
    const r = n.getBoundingClientRect();
    return { inert: (n as HTMLElement).inert, top: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
  });
  expect(hit.inert, 'the folded plank\'s button is inert').toBe(true);
  expect(hit.top, 'the pointer passes through it').toBe(false);

  await jardin.withApi((api, x: number) => api.walkTo(x, 1), ROSALEDA_X);
  await expect.poll(() => jardin.withApi((api) => api.state().bed), { timeout: 15000 }).toBe('rosaleda');
  const inert = await page.locator('#proxies .px-sign[data-board]').evaluateAll((ns) => ns
    .filter((n) => (n as HTMLElement).inert)
    .map((n) => (n as HTMLElement).dataset['bed'] ?? '')
    .sort());
  expect(inert, 'only the planks naming the Rosaleda (leading to where they stand) are folded').toEqual(['estanque', 'puerta']);
});
