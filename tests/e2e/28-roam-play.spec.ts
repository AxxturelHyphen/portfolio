import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/jardin.ts';
import { enterRoam, roamAt, untilStill } from '../helpers/roam.ts';

// The garden as a game (ui/play.ts): the touch stick walks the visitor, the lantern round counts a project opened and
// starts over from the help card, the help card opens only from the "?" tag or the H key, and Shift is a brisk walk.

const visited = (page: Page): Promise<string | null> => page.evaluate(() => localStorage.getItem('jardin.visited'));

/** A point in the stick's corner (lower left) where the canvas itself is under the finger. */
async function stickSpot(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    for (let y = Math.round(innerHeight * 0.62); y > innerHeight * 0.5; y -= 12) {
      for (let x = 60; x < innerWidth * 0.4; x += 12) if (document.elementFromPoint(x, y)?.tagName === 'CANVAS') return [x, y] as [number, number];
    }
    throw new Error('no open canvas in the stick corner');
  });
}

test('play: a thumb dragged in the lower left walks the visitor and lets go cleanly', async ({ page, jardin, isMobile, context }) => {
  test.skip(!isMobile, 'touch profiles only');
  await enterRoam(jardin, '#/b/rosaleda');
  const [x, y] = await stickSpot(page);
  const from = await roamAt(jardin);
  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', px: number): Promise<unknown> =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y, id: 1 }] });
  await touch('touchStart', x);
  for (let i = 1; i <= 6; i++) await touch('touchMove', x + i * 8);
  await expect(page.locator('.sk[data-on]'), 'the stick shows under the thumb').toBeAttached();
  await page.waitForTimeout(900);
  await touch('touchEnd', x + 48);
  await expect(page.locator('.sk[data-on]'), 'the stick goes with the thumb').toHaveCount(0);
  await untilStill(page);
  const to = await roamAt(jardin);
  expect(to.x - from.x, 'pushed right, the visitor walked right').toBeGreaterThan(0.8);
});

test('play: opening a project lights its flower, the bed note shows once, start over clears the count', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  const tag = page.locator('.pq-tag:not([hidden])');
  await expect(tag).toHaveText('0 / 4 flowers lit');
  await jardin.goto('#/p/garagic');
  await expect(jardin.panel).toBeVisible();
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  await expect(tag).toHaveText('1 / 4 flowers lit');
  await expect(page.locator('.pq-note[data-on]')).toContainText('every flower lit');
  expect(JSON.parse((await visited(page)) ?? '[]')).toEqual(['garagic']);

  await page.locator('.pq-ask').click();
  const help = page.locator('#hp');
  await expect(help).toBeVisible();
  await help.getByRole('button', { name: 'Start over' }).click();
  await expect(help).toBeHidden();
  await expect(tag).toHaveText('0 / 4 flowers lit');
  expect(await visited(page)).toBe('[]');
});

test('play: the help card never comes up by itself, only from the "?" tag or the H key', async ({ page, jardin, isMobile }) => {
  await enterRoam(jardin, '#/', { help: '1' });
  const help = page.locator('#hp');
  await page.waitForTimeout(4000);
  await expect(help, 'first visit: the controls are chalked at the gate, no card').toBeHidden();
  if (isMobile) await page.locator('.pq-ask').tap();
  else await page.keyboard.press('h');
  await expect(help).toBeVisible();
  await expect(help).toContainText(isMobile ? 'Drag a thumb' : 'WASD');
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  expect(await jardin.withApi((api) => api.state().phase), 'Escape closed the card only').not.toBe('overview');
  await page.locator('.pq-ask').click();
  await expect(help).toBeVisible();
  await help.getByRole('button', { name: 'Got it' }).click();
  await expect(help).toBeHidden();
});

test('play: Shift held walks the visitor briskly', async ({ page, jardin, isMobile }) => {
  test.skip(isMobile, 'keyboard profiles only');
  await enterRoam(jardin, '#/b/rosaleda');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const walk = async (key: string, shift: boolean): Promise<number> => {
    await untilStill(page);
    const a = await roamAt(jardin);
    if (shift) await page.keyboard.down('Shift');
    await page.keyboard.down(key);
    await page.waitForTimeout(450);
    await page.keyboard.up(key);
    if (shift) await page.keyboard.up('Shift');
    await untilStill(page);
    const b = await roamAt(jardin);
    return Math.hypot(b.x - a.x, b.z - a.z);
  };
  const plain = await walk('ArrowRight', false);
  const brisk = await walk('ArrowLeft', true);
  expect(plain).toBeGreaterThan(0.5);
  expect(brisk / plain, 'a brisk walk covers more ground in the same time').toBeGreaterThan(1.2);
});
