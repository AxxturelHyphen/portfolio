import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/jardin.ts';
import { enterRoam } from '../helpers/roam.ts';

// Sound (src/audio/, garden/sound.ts): a sound tag beside the language tag, a toggle remembered across visits; no
// AudioContext before a gesture, one on the first tap in the garden, and the cricket bed fetched only then; muting
// suspends it. Stills (?shot) and test runs (?bench=1) stay silent. Most flows run with ?bench=1, so this spec visits
// the plain page where it needs sound.

declare global {
  interface Window {
    __contexts?: AudioContext[];
  }
}

/** Counts every AudioContext the page makes, before any page script runs. */
async function watchContexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Base = window.AudioContext;
    const made: AudioContext[] = [];
    window.__contexts = made;
    window.AudioContext = class extends Base {
      constructor(o?: AudioContextOptions) {
        super(o);
        made.push(this);
      }
    };
  });
}

const contexts = (page: Page): Promise<number> => page.evaluate(() => window.__contexts?.length ?? -1);
const contextState = (page: Page): Promise<string> => page.evaluate(() => window.__contexts?.[0]?.state ?? 'none');

/** The garden is ready: the way-out tag leads to the album and is no longer busy. */
async function gardenReady(page: Page): Promise<void> {
  await expect(page.locator('#toggles .tg-exit[data-mode="herbario"]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#toggles .tg')).not.toHaveAttribute('data-pending', /.*/);
}

/** A tap on open ground, clear of the tags at the top and the plan in its corner. */
async function tap(page: Page): Promise<void> {
  const vp = page.viewportSize() ?? { width: 800, height: 600 };
  await page.mouse.click(vp.width * 0.5, vp.height * 0.82);
}

test('sound tag: beside the language tag, a toggle button, remembered across visits', async ({ page, jardin }) => {
  await enterRoam(jardin);
  const tag = page.locator('#toggles .tg-sound');
  await expect(tag).toBeVisible();
  await expect(tag).toHaveAttribute('aria-pressed', 'true');
  await expect(tag).toHaveAccessibleName('Sound');
  const box = await tag.boundingBox();
  const lang = await page.locator('#toggles .tg-lang').boundingBox();
  expect(box !== null && lang !== null && Math.abs(box.y - lang.y) < 24 && box.x + box.width <= lang.x + 1, 'in the row, left of the language tag').toBe(true);

  await tag.click();
  await expect(tag).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('jardin.sound'))).toBe('off');
  await page.reload();
  await expect(page.locator('#toggles .tg-sound')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#toggles .tg-sound').click();
  await expect(page.locator('#toggles .tg-sound')).toHaveAttribute('aria-pressed', 'true');
  expect(jardin.errors).toEqual([]);
});

test('sound: no AudioContext before a gesture; the first tap starts it and fetches the bed; muting suspends it', async ({ page, jardin }) => {
  await watchContexts(page);
  const fetched: string[] = [];
  page.on('request', (r) => {
    if (/\/audio\/.+\.webm$/.test(r.url())) fetched.push(r.url());
  });
  await page.goto('./?mode=garden#/');
  await gardenReady(page);
  await page.waitForTimeout(800);
  expect(await contexts(page), 'no context before a gesture').toBe(0);
  expect(fetched, 'no sound fetched before a gesture').toEqual([]);

  await tap(page);
  await expect.poll(() => contexts(page)).toBe(1);
  await expect.poll(() => contextState(page)).toBe('running');
  await expect.poll(() => fetched.some((u) => u.includes('crickets'))).toBe(true);

  await page.locator('#toggles .tg-sound').click();
  await expect.poll(() => contextState(page)).toBe('suspended');
  await page.locator('#toggles .tg-sound').click();
  await expect.poll(() => contextState(page)).toBe('running');
  await tap(page);
  expect(await contexts(page), 'one context for the visit').toBe(1);
  expect(jardin.errors).toEqual([]);
});

test('sound: silent in a still (?shot) and in a test run (?bench=1)', async ({ page, jardin }) => {
  await watchContexts(page);
  await page.goto('./?mode=garden&shot=S02#/');
  await gardenReady(page);
  await tap(page);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  expect(await contexts(page), 'no context under ?shot').toBe(0);

  await enterRoam(jardin);
  await tap(page);
  await page.waitForTimeout(500);
  expect(await contexts(page), 'no context under ?bench=1').toBe(0);
  expect(jardin.errors).toEqual([]);
});
