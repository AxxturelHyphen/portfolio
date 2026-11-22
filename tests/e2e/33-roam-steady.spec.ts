import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/jardin.ts';
import { enterRoam, focusIn, untilStill } from '../helpers/roam.ts';

// Nothing flips on a nudge: with a project flower focused straight ahead of the visitor (where the tag's side used to
// flip on a 2 cm step), three small nudges (a 40 ms
// key tap, a 1 px pointer move, a 2 px drag) leave the focused slot, the tag's side and the Open button as they were,
// and the tag moves only as far as the flower does on screen (a held press walks the visitor, so the drag may move it).

type Seen = { slot: string | null; side: string | null; x: number; y: number; open: boolean };

const seen = (page: Page): Promise<Seen> => page.evaluate(() => {
  const label = document.querySelector<HTMLElement>('#label');
  const m = new DOMMatrixReadOnly(label === null ? 'none' : getComputedStyle(label).transform);
  return {
    slot: window.__jardin?.state().slot ?? null,
    side: label?.dataset.side ?? null,
    x: m.m41,
    y: m.m42,
    open: document.querySelector<HTMLElement>('.pq-open')?.hidden === false,
  };
});

/**
 * A 40 ms key tap, a 1 px pointer move, or a 2 px mouse drag held past a tap's time at the visitor's feet (a press held
 * on the ground walks there). Touch has no mouse: the pointer nudges are for desktop.
 */
async function nudge(page: Page, how: 'key' | 'pointer' | 'drag', isMobile: boolean, key = 'd'): Promise<void> {
  const box = page.viewportSize()!;
  const [x, y] = [box.width * 0.5, box.height * 0.62];
  if (how === 'key') {
    await page.keyboard.down(key);
    await page.waitForTimeout(40);
    await page.keyboard.up(key);
  } else if (isMobile) {
    return;
  } else if (how === 'pointer') {
    await page.mouse.move(x, y);
    await page.mouse.move(x + 1, y);
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 1, y);
    await page.mouse.move(x + 2, y);
    await page.waitForTimeout(400);
    await page.mouse.up();
  }
}

test('steady: three nudges flip neither the focused flower, nor the tag\'s side, nor the Open button', async ({ page, jardin, isMobile }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  await jardin.withApi((api) => api.walkTo(11.82, -0.35));
  await focusIn(page, 'rosaleda');
  await untilStill(page);
  await page.waitForTimeout(900);
  const before = await seen(page);
  expect(before.slot).toBe('rosaleda/rose-a');
  if (!isMobile) expect(before.side).not.toBeNull();
  expect(before.open).toBe(isMobile);
  for (const how of ['key', 'pointer', 'drag'] as const) {
    await nudge(page, how, isMobile);
    await page.waitForTimeout(700);
    const after = await seen(page);
    expect(after.slot, `${how}: the same flower stays focused`).toBe(before.slot);
    expect(after.side, `${how}: the tag keeps its side`).toBe(before.side);
    expect(after.open, `${how}: the Open button stays`).toBe(before.open);
    if (how !== 'drag') expect(Math.abs(after.x - before.x), `${how}: the tag does not jump`).toBeLessThan(40);
  }
});
