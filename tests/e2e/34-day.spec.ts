import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/jardin.ts';
import { enterRoam } from '../helpers/roam.ts';

// The garden's day (world/daytime.ts, garden/daylight.ts): `?hour=13` pins a midday garden that is clearly brighter
// than the pinned lantern night every other spec sees, under a blue sky, and the hour stays where it was pinned.

interface Means { luma: number; skyR: number; skyG: number; skyB: number }

/** Mean display luma of the whole frame and the mean colour of a band of sky under the tags (lower on a phone). */
async function means(page: Page): Promise<Means> {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let luma = 0;
    for (let i = 0; i < d.length; i += 4) luma += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    const top = c.height > c.width ? 0.14 : 0.07;
    const sky = g.getImageData(Math.round(c.width * 0.3), Math.round(c.height * top), Math.round(c.width * 0.4), Math.round(c.height * 0.04)).data;
    let r = 0;
    let gr = 0;
    let b = 0;
    for (let i = 0; i < sky.length; i += 4) {
      r += sky[i]!;
      gr += sky[i + 1]!;
      b += sky[i + 2]!;
    }
    const n = sky.length / 4;
    return { luma: luma / (d.length / 4), skyR: r / n, skyG: gr / n, skyB: b / n };
  }, png);
}

const hourNow = (page: Page): Promise<number> => page.evaluate(() => window.__jardin?.hour() ?? -1);

test('?hour=13: a bright garden under a blue sky, pinned, and the night stays the night', async ({ page, jardin }) => {
  test.setTimeout(120_000);
  await enterRoam(jardin, '#/b/puerta', {});
  expect(await hourNow(page)).toBe(0);
  const night = await means(page);

  await enterRoam(jardin, '#/b/puerta', { hour: '13' });
  expect(await hourNow(page)).toBe(13);
  const day = await means(page);
  expect(day.luma, `day ${day.luma.toFixed(1)} against night ${night.luma.toFixed(1)}`).toBeGreaterThan(night.luma + 15);
  const sky = `day sky ${[day.skyR, day.skyG, day.skyB].map(Math.round).join(' ')}, night ${[night.skyR, night.skyG, night.skyB].map(Math.round).join(' ')}`;
  expect(day.skyB, sky).toBeGreaterThan(day.skyR + 10);
  expect(day.skyB, sky).toBeGreaterThan(day.skyG);
  expect(day.skyB, sky).toBeGreaterThan(night.skyB);

  await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
  expect(await hourNow(page)).toBe(13);
});
