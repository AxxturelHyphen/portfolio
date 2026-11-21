import type { Page } from '@playwright/test';
import { expect, test, type Jardin } from '../helpers/jardin.ts';
import { enterRoam } from '../helpers/roam.ts';

// The interface is usable on desktop and phone: the fixed layers (top tags, counter and "?", plan corner, first-visit
// plate, help card) never overlap or leave the screen at six sizes, touch targets are 44 px and 8 px apart, keyboard
// focus shows a ring that nothing covers, Tab runs top tags, world, plan corner, Escape hands focus back to what opened
// the layer, every control and dialog has a name, the page language follows EN/ES, start over closes the lit flowers,
// and the help card and the first-visit slip never stand together.

type Box = { x: number; y: number; w: number; h: number; what: string };

const SIZES = [[320, 568], [390, 844], [844, 390], [768, 1024], [1366, 768], [1920, 1080]] as const;
const PHONES = [[320, 568], [390, 844], [844, 390]] as const;
/** The fixed layers, one box each (the language plate as one; the plate's card and its pinned slip may touch). */
const LAYERS = '#toggles :is(.tg-sound, .tg-lang, .tg-cv, .tg-exit), .pq-tag, .pq-ask, .pq-open, #proxies .pl-tag, .wl-card, .wl-hint, #hp';
/** Every target of the fixed layers and the help card. */
const TARGETS = '#toggles :is(.tg-sound, .tg-lang-link, .tg-cv, .tg-exit), button.pq-tag, .pq-ask, .pq-open, #proxies .pl-tag, #hp :is(button, a)';

/** Boxes of the shown matches: rendered, not hidden, not transparent. */
function shown(page: Page, selector: string): Promise<Box[]> {
  return page.evaluate((sel) => [...document.querySelectorAll<HTMLElement>(sel)]
    .filter((n) => n.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && n.getBoundingClientRect().width > 0)
    .map((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, what: `${n.className.split(' ')[0] ?? n.tagName}:${(n.textContent ?? '').trim().slice(0, 18)}` };
    }), selector);
}

/** The clearance between two boxes along the axis that separates them most (negative: they overlap). */
function gap(a: Box, b: Box): number {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.max(dx, dy);
}

async function expectLaidOut(page: Page, where: string): Promise<void> {
  const boxes = await shown(page, LAYERS);
  const vp = page.viewportSize() ?? { width: 0, height: 0 };
  for (const b of boxes) {
    const inside = b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= vp.width + 0.5 && b.y + b.h <= vp.height + 0.5;
    expect(inside, `${where}: ${b.what} stays on screen (${JSON.stringify(b)})`).toBe(true);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let k = i + 1; k < boxes.length; k++) {
      if (boxes[i]!.what.startsWith('wl-') && boxes[k]!.what.startsWith('wl-')) continue;
      expect(gap(boxes[i]!, boxes[k]!), `${where}: ${boxes[i]!.what} clear of ${boxes[k]!.what}`).toBeGreaterThanOrEqual(0);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${where}: no horizontal scroll`).toBe(true);
}

async function expectTargets(page: Page, where: string): Promise<void> {
  const boxes = await shown(page, TARGETS);
  for (const b of boxes) expect(Math.min(b.w, b.h), `${where}: ${b.what} is a thumb's size`).toBeGreaterThanOrEqual(44);
  for (let i = 0; i < boxes.length; i++) {
    for (let k = i + 1; k < boxes.length; k++) {
      expect(gap(boxes[i]!, boxes[k]!), `${where}: ${boxes[i]!.what} 8 px from ${boxes[k]!.what}`).toBeGreaterThanOrEqual(8);
    }
  }
}

/** Free roam on a bed with the first-visit plate already seen in this session. */
async function enterPlayed(page: Page, j: Jardin, hash = '#/b/rosaleda'): Promise<void> {
  await page.addInitScript(() => sessionStorage.setItem('jardin.welcome', '1'));
  await enterRoam(j, hash);
}

async function openHelp(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile) await page.locator('.pq-ask').tap();
  else await page.locator('.pq-ask').click();
  await expect(page.locator('#hp')).toBeVisible();
  await expect.poll(() => page.locator('#hp').evaluate((n) => getComputedStyle(n).opacity), { message: 'the card has come up' }).toBe('1');
}

test('hud: the fixed layers never overlap or leave the screen at six sizes, with or without the help card', async ({ page, jardin, isMobile }) => {
  await enterPlayed(page, jardin);
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    await expectLaidOut(page, `${width}x${height}`);
    await openHelp(page, isMobile);
    await expectLaidOut(page, `${width}x${height} help`);
    await page.keyboard.press('Escape');
    await expect(page.locator('#hp')).toBeHidden();
  }
});

test('hud: on touch every target is 44 px and 8 px from the next, with or without the help card', async ({ page, jardin, isMobile }) => {
  test.skip(!isMobile, 'touch profiles only');
  await enterPlayed(page, jardin);
  for (const [width, height] of PHONES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    await expectTargets(page, `${width}x${height}`);
    await openHelp(page, true);
    await expectTargets(page, `${width}x${height} help`);
    await page.keyboard.press('Escape');
    await expect(page.locator('#hp')).toBeHidden();
  }
});

test('hud: first visit, the name card and the help card take turns and never overlap the counter or the "?"', async ({ page, jardin, isMobile }) => {
  test.slow();
  await page.addInitScript(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  for (const [width, height] of isMobile ? PHONES : ([[1920, 1080]] as const)) {
    const where = `${width}x${height}`;
    await page.setViewportSize({ width, height });
    await enterRoam(jardin, '#/', { help: '1', size: where });
    let sawPlate = false;
    for (let i = 0; i < 80 && !(await page.locator('#hp').isVisible()); i++) {
      const both = await page.evaluate(() => document.querySelector('#hp:popover-open') !== null
        && (document.querySelector<HTMLElement>('.wl-hint')?.checkVisibility({ opacityProperty: true }) ?? false));
      expect(both, `${where}: the help card and the welcome slip never together`).toBe(false);
      sawPlate ||= await page.locator('.wl[data-state="shown"]').count() > 0;
      await expectLaidOut(page, `${where} plate`);
      await page.waitForTimeout(200);
    }
    expect(sawPlate, `${where}: the name card came up first`).toBe(true);
    await expect(page.locator('#hp'), `${where}: then the help card`).toBeVisible();
    await expect(page.locator('.wl-hint')).toBeHidden();
    await page.waitForTimeout(450);
    await expectLaidOut(page, `${where} help`);
  }
});

test('hud: Tab runs top tags, the world, then the plan corner, each with a ring nothing covers', async ({ page, jardin, isMobile }) => {
  test.skip(isMobile, 'keyboard profiles only');
  await enterPlayed(page, jardin);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const order = ['hud', 'world', 'corner'];
  let last = 0;
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const n = document.activeElement as HTMLElement | null;
      if (n === null || n === document.body) return null;
      const zone = n.closest('#toggles, .pq') !== null ? 'hud' : n.closest('.pl') !== null ? 'corner' : n.closest('#proxies') !== null ? 'world' : 'other';
      const cs = getComputedStyle(n);
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none';
      const r = n.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const onScreen = cx > 0 && cy > 0 && cx < innerWidth && cy < innerHeight;
      const hit = onScreen ? document.elementFromPoint(cx, cy) : n;
      return { zone, ring, covered: hit !== null && hit !== n && !n.contains(hit), what: `${n.className}:${(n.getAttribute('aria-label') ?? n.textContent ?? '').trim().slice(0, 20)}` };
    });
    if (f === null) break;
    expect(f.zone, `${f.what} is a garden control`).not.toBe('other');
    const at = order.indexOf(f.zone);
    expect(at, `${f.what} (${f.zone}) comes in the order top tags, world, corner`).toBeGreaterThanOrEqual(last);
    last = at;
    expect(f.ring, `${f.what} shows a focus ring`).toBe(true);
    expect(f.covered, `${f.what} is not covered by another layer`).toBe(false);
    if (f.zone === 'corner') break;
  }
  expect(order[last], 'Tab reached the plan corner').toBe('corner');
});

test('hud: Escape closes the top layer and hands focus back to what opened it', async ({ page, jardin, isMobile }) => {
  test.skip(isMobile, 'keyboard profiles only');
  await enterPlayed(page, jardin);
  const focused = (): Promise<string> => page.evaluate(() => (document.activeElement as HTMLElement | null)?.className ?? '');

  await page.locator('.pq-ask').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#hp')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#hp')).toBeHidden();
  expect(await focused(), 'back on the "?"').toContain('pq-ask');

  await page.locator('#proxies .pl-tag').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pl-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pl-sheet')).toBeHidden();
  expect(await focused(), 'back on the plan corner').toContain('pl-tag');

  const slot = page.locator('#proxies [data-slot][data-project]').first();
  await slot.focus();
  await page.keyboard.press('Enter');
  await expect(jardin.panel).toBeVisible();
  await expect(jardin.panel, 'the project panel is named').toHaveAccessibleName(/\S/);
  await expect(jardin.panel.locator('.pn-close')).toHaveAccessibleName(/\S/);
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  await expect.poll(focused, { message: 'back on the flower' }).toContain('px-slot');
});

test('hud: every control and dialog has a name, and the page language follows EN/ES', async ({ page, jardin, isMobile }) => {
  await enterPlayed(page, jardin);
  const nameless = await page.evaluate(() => {
    const nameOf = (n: Element): string => {
      const by = n.getAttribute('aria-labelledby');
      const label = by === null ? '' : by.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      return (n.getAttribute('aria-label') ?? label ?? '').trim() || (n instanceof HTMLDialogElement ? '' : (n.textContent ?? '').trim());
    };
    const sel = '#toggles :is(button, a[href]), #world :is(button, a[href], dialog[popover]), dialog[open]';
    return [...document.querySelectorAll(sel)].filter((n) => nameOf(n) === '').map((n) => n.outerHTML.slice(0, 80));
  });
  expect(nameless, 'controls and dialogs without a name').toEqual([]);
  const es = page.locator('#toggles .tg-lang-link[data-lang="es"]');
  if (isMobile) await es.tap();
  else await es.click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(es).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#toggles .tg-lang-link[data-lang="en"]')).not.toHaveAttribute('aria-current', 'true');
});

test('hud: start over forgets the lit flowers live and the round starts again', async ({ page, jardin, isMobile }) => {
  await enterPlayed(page, jardin);
  await jardin.goto('#/p/garagic');
  await expect(jardin.panel).toBeVisible();
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  const tag = page.locator('.pq-tag:not([hidden])');
  await expect(tag).toHaveText('1 / 4 flowers lit');
  const visited = (): Promise<string | null> => page.evaluate(() => localStorage.getItem('jardin.visited'));
  expect(await visited()).toBe('["garagic"]');
  await openHelp(page, isMobile);
  await page.locator('#hp').getByRole('button', { name: 'Start over' }).click();
  await expect(tag).toHaveText('0 / 4 flowers lit');
  expect(await visited()).toBe('[]');
  expect(jardin.errors, 'the flowers closed without an error (world/memory.ts onReset)').toEqual([]);
});
