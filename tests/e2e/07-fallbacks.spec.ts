import type { Page } from '@playwright/test';
import { expect, PROJECTS, SEL, test } from '../helpers/jardin.ts';

// Flow 7: prefers-reduced-motion and no WebGL2 start in Herbario, every project readable, no flicker.

async function watchFlicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __modes: string[]; __cls: number };
    w.__modes = [];
    w.__cls = 0;
    new MutationObserver(() => {
      const m = document.documentElement.dataset['mode'];
      if (m !== undefined && w.__modes[w.__modes.length - 1] !== m) w.__modes.push(m);
    }).observe(document, { attributes: true, attributeFilter: ['data-mode'], subtree: true }); // documentElement may not exist yet
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const ls = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!ls.hadRecentInput) w.__cls += ls.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

async function noWebGL2(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'WebGL2RenderingContext');
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (orig as (t: string, ...r: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof orig;
  });
}

async function expectHerbarioReadable(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'herbario');
  const gardenHidden = await page.evaluate(() => {
    const c = document.getElementById('garden');
    if (c === null) return true;
    const cs = getComputedStyle(c);
    return c.hidden || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0 || c.closest('[inert]') !== null;
  });
  expect(gardenHidden, 'canvas is not shown').toBe(true);
  for (const p of PROJECTS) {
    const a = page.locator(`article#p-${p.id}`);
    await a.scrollIntoViewIfNeeded();
    await expect(a.locator('.h-title')).toHaveText(p.title);
    expect(((await a.locator('.h-oneliner').textContent()) ?? '').trim().length, `${p.id} one-liner`).toBeGreaterThan(0);
    expect(((await a.textContent()) ?? '').trim().length, `${p.id} readable text`).toBeGreaterThan(60);
  }
}

async function expectNoFlicker(page: Page): Promise<void> {
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const w = window as unknown as { __modes: string[]; __cls: number };
    return { modes: w.__modes, cls: w.__cls };
  });
  expect(new Set(r.modes).size, `data-mode only ever ${JSON.stringify(r.modes)}`).toBeLessThanOrEqual(1);
  expect(r.cls, 'layout shift').toBeLessThan(0.001);
}

test.describe('prefers-reduced-motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('flow 7: starts in Herbario with every project readable and no flicker', async ({ page, jardin }) => {
    await watchFlicker(page);
    await jardin.visit({ mode: 'none' });
    await expectHerbarioReadable(page);
    await expectNoFlicker(page);
  });

  test('flow 7: the panel opens and closes without a stuck state', async ({ page, jardin }) => {
    const p = PROJECTS[0];
    if (p === undefined) return;
    await jardin.visit({ mode: 'none' });
    await jardin.open(p.id);
    await jardin.expectOpen(p);
    await page.keyboard.press('Escape');
    await jardin.expectClosed();
  });
});

test.describe('no WebGL2', () => {
  test('flow 7: starts in Herbario, even when ?mode=garden asks for the garden', async ({ page, jardin }) => {
    await noWebGL2(page);
    await watchFlicker(page);
    await jardin.visit({ mode: 'garden' });
    await expectHerbarioReadable(page);
    await expectNoFlicker(page);
    await expect(page.locator(SEL.gardenToggle).first(), 'Enter the garden is offered').toBeVisible();
  });

  test('flow 7: no WebGL2 and no mode param', async ({ page, jardin }) => {
    await noWebGL2(page);
    await jardin.visit({ mode: 'none' });
    await expectHerbarioReadable(page);
  });
});
