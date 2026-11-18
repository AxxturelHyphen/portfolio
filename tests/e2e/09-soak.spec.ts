import { expect, test } from '../helpers/jardin.ts';
import { enterRoam, openGround, roamAt } from '../helpers/roam.ts';

// Flow 9: 5 minutes of wandering on foot in free roam (the default): held walk keys up and down the garden, taps or
// clicks on open ground, whatever flower the visitor walks up to opened and closed, and now and then the plan's walk to
// a far bed so every bed streams in and out. JS heap and GPU memory, sampled from the whole-garden view, stay flat.

const BEDS = ['puerta', 'rosaleda', 'estanque', 'semillero', 'gruta', 'salida'] as const;
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

test('flow 9 garden: five minutes of wandering on foot keeps heap and GPU memory flat', async ({ page, jardin, isMobile }) => {
  test.setTimeout(8 * 60_000);
  await enterRoam(jardin);
  await jardin.longTasksAfterReady(); // stamps the end of load
  const heap: number[] = [];
  const tex: number[] = [];
  const end = Date.now() + 5 * 60_000;
  let east = true;
  let opened = 0;
  let i = 0;
  while (Date.now() < end) {
    const x = (await roamAt(jardin)).x;
    if (x > 43) east = false;
    if (x < 1) east = true;
    const key = i % 4 === 3 ? (i % 8 === 3 ? 'ArrowUp' : 'ArrowDown') : east ? 'ArrowRight' : 'ArrowLeft';
    await page.keyboard.down(key);
    await page.waitForTimeout(900 + (i % 3) * 500);
    await page.keyboard.up(key);
    const ground = await openGround(page).catch(() => null);
    if (ground !== null && i % 2 === 0) {
      if (isMobile) await page.touchscreen.tap(ground[0], ground[1]);
      else await page.mouse.click(ground[0], ground[1]);
      await page.waitForTimeout(700);
    }
    const s = await jardin.withApi((api) => api.state());
    const project = s.phase === 'focus' && s.slot !== null ? await page.locator(`#proxies [data-slot="${s.slot}"]`).getAttribute('data-project') : null;
    if (project !== null) {
      await page.keyboard.press('Enter');
      await expect.poll(() => jardin.isPanelOpen()).toBe(true);
      await page.keyboard.press('Escape');
      await jardin.expectClosed();
      opened++;
    }
    if (i % 6 === 5) await jardin.goto(`#/b/${BEDS[(i / 6) % BEDS.length | 0] as string}`);
    await jardin.settled();
    if (i % 3 === 2) {
      // Sampled from the whole-garden view (Esc lifts the camera), as the rail soak did: no bed is wanted there.
      await jardin.goto('#/');
      const m = await jardin.withApi((api) => ({ heap: api.heapMB(), tex: api.info().texBytes / 2 ** 20 }));
      if (m.heap !== null) heap.push(m.heap);
      tex.push(m.tex);
    }
    i++;
  }
  test.info().annotations.push({ type: 'soak', description: `${i} rounds, ${opened} flowers opened` });
  const third = Math.max(1, Math.floor(heap.length / 3));
  expect(heap.length, 'heap samples').toBeGreaterThan(5);
  expect(mean(heap.slice(-third)), 'JS heap MB, last third vs first third').toBeLessThanOrEqual(mean(heap.slice(0, third)) * 1.1 + 2);
  const tthird = Math.max(1, Math.floor(tex.length / 3));
  expect(mean(tex.slice(-tthird)), 'texture MB, last third vs first third').toBeLessThanOrEqual(mean(tex.slice(0, tthird)) * 1.05 + 1);
  expect(await jardin.longTasksAfterReady(), 'long tasks over 100 ms after load').toEqual([]);
});
