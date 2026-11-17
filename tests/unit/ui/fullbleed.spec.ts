import { expect, test } from '@playwright/test';
import { BLEED_SIZES, bleedError, liveResize, measureBleed, nextFrames } from './fullbleed.ts';

// The garden canvas fills the viewport at every size and during a live resize (cook/BRIEF.md, full screen rule 1).

test('the garden canvas equals the viewport at every size and during a live resize', async ({ page }) => {
  await page.setViewportSize(BLEED_SIZES[0] ?? { width: 1920, height: 1080 });
  await page.goto('./?mode=garden&bench=1#/');
  await page.waitForFunction(() => '__jardin' in window);
  for (const size of BLEED_SIZES) {
    await page.setViewportSize(size);
    await nextFrames(page);
    expect(bleedError(await measureBleed(page)), `${size.width}x${size.height}`).toBeNull();
  }
  const live = await liveResize(page, { width: 1920, height: 1080 }, { width: 700, height: 500 }, 12);
  for (const s of live) expect(bleedError(s)).toBeNull();
});
