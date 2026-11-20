import { expect, test } from '../helpers/jardin.ts';
import { enterRoam, roamAt, untilStill } from '../helpers/roam.ts';

// Free roam's signboards (ui/signposts.ts): every plank on screen takes a click or a tap, not only the current place's
// two, with the pointer cursor; the Tab order keeps only the current place's two signs. The press sends the sign's
// GOTO (the same handler as the current signs, 20-roam-assist.spec.ts walks one).

/** The Estanque stand point (x, m). */
const ESTANQUE_X = 20;

test('roam signs: a plank of another place on screen takes the click or tap; Tab keeps the current two', async ({ page, jardin }, info) => {
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

  const board = page.locator('#proxies .px-sign[data-board][data-bed="estanque"]:not([hidden])').first();
  await expect(board, 'the Rosaleda plank pointing to the Estanque is on screen').toBeVisible();
  const hit = await board.evaluate((n) => {
    const r = n.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    return { x, y, top: n.contains(document.elementFromPoint(x, y)), cursor: getComputedStyle(n).cursor, tab: (n as HTMLElement).tabIndex };
  });
  expect(hit.top, 'the plank\'s button is the topmost target at its centre').toBe(true);
  expect(hit.cursor).toBe('pointer');
  expect(hit.tab, 'out of the Tab order').toBe(-1);

  await board.evaluate((n) => n.addEventListener('click', () => n.setAttribute('data-pressed', ''), { once: true }));
  if (info.project.name.startsWith('mobile')) await page.touchscreen.tap(hit.x, hit.y);
  else await page.mouse.click(hit.x, hit.y);
  await expect(board, 'the press lands on the plank\'s button').toHaveAttribute('data-pressed', '');
  expect(await board.evaluate((n) => n.contains(document.activeElement)), 'a press leaves the focus where it was').toBe(false);
});
