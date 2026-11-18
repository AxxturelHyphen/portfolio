import { appendFileSync, mkdirSync } from 'node:fs';
import { expect, test } from '../helpers/jardin.ts';
import { enterRoam, openGround } from '../helpers/roam.ts';

// Free roam (the default) replaces the swipe between beds with a drag that steers the visitor (cook/ROAM_PLAN.md
// section 5, 12-drag-latency): the visitor starts to move within one frame of the drag's first touch or press.
// Measured in the page: animation frames and ms from the pointerdown to the first frame where the visitor moved.

test('drag: the visitor starts to move within one frame of the first touch or press', async ({ page, jardin, isMobile }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  const [x, y] = await openGround(page);
  await page.evaluate(() => {
    const w = window as unknown as { __dr: { t0: number | null; moved: number | null; frames: number; p0: string; raf: boolean } };
    w.__dr = { t0: null, moved: null, frames: 0, p0: '', raf: true };
    const at = (): string => JSON.stringify(window.__jardin?.roam());
    addEventListener('pointerdown', (e) => {
      if (w.__dr.t0 !== null) return;
      w.__dr.t0 = e.timeStamp;
      w.__dr.p0 = at();
      const tick = (now: number): void => {
        if (w.__dr.moved === null) {
          w.__dr.frames++;
          if (at() !== w.__dr.p0) w.__dr.moved = now;
        }
        if (w.__dr.raf) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { capture: true, passive: true });
  });
  const dx = x > 195 ? -120 : 120;
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 10, y }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 10 });
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const w = window as unknown as { __dr: { t0: number | null; moved: number | null; frames: number; raf: boolean } };
    w.__dr.raf = false;
    return { t0: w.__dr.t0, moved: w.__dr.moved, frames: w.__dr.frames };
  });
  expect(r.t0, 'the press reached the page').not.toBeNull();
  expect(r.moved, 'the visitor moved during the drag').not.toBeNull();
  const delay = (r.moved ?? 0) - (r.t0 ?? 0);
  test.info().annotations.push({ type: 'drag-delay', description: `${r.frames} frames, ${delay.toFixed(1)} ms` });
  mkdirSync('test-results', { recursive: true });
  appendFileSync('test-results/drag-delay.txt', `${test.info().project.name} ${r.frames} frames ${delay.toFixed(1)} ms\n`);
  // The probe's own frame callback may run before the app's in the first frame (an idle loop wakes on the press), so
  // the first app frame after the press is the probe's first or second tick.
  expect(r.frames, 'the first app frame after the press moves the visitor').toBeLessThanOrEqual(2);
});
