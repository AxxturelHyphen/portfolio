import { appendFileSync, mkdirSync } from 'node:fs';
import { expect, test } from '../helpers/jardin.ts';

// Mobile: delay between the first touch of a swipe and the first camera movement, in ms. Measured in the page: the
// touchstart event time stamp against the first rAF frame whose camera pose differs from the pose at touchstart.
// Reported as an annotation (and in the failure message); the only hard rule is that the swipe moves the camera.

test('mobile swipe: the camera starts to move after the first touch, delay measured', async ({ page, jardin, isMobile }) => {
  test.skip(!isMobile, 'touch swipe is a mobile profile');
  await jardin.visit({ mode: 'garden', hash: '#/b/rosaleda' });
  await jardin.goto('#/b/rosaleda', true);
  await page.evaluate(() => {
    const w = window as unknown as { __sw: { t0: number | null; moved: number | null; p0: string | null; raf: boolean; end: number | null; moves: number[] } };
    w.__sw = { t0: null, moved: null, p0: null, raf: true, end: null, moves: [] };
    addEventListener('touchmove', (e) => void w.__sw.moves.push(e.timeStamp), { capture: true, passive: true });
    addEventListener('touchend', (e) => void (w.__sw.end ??= e.timeStamp), { capture: true, passive: true });
    const pose = (): string => JSON.stringify(window.__jardin?.camera());
    addEventListener('touchstart', (e) => {
      if (w.__sw.t0 !== null) return;
      w.__sw.t0 = e.timeStamp;
      w.__sw.p0 = pose();
      const tick = (now: number): void => {
        if (w.__sw.moved === null && pose() !== w.__sw.p0) w.__sw.moved = now;
        if (w.__sw.raf) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { capture: true, passive: true });
  });
  const cdp = await page.context().newCDPSession(page);
  const y = 420;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y }] });
  for (let i = 1; i <= 14; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 320 - (250 * i) / 14, y }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const w = window as unknown as { __sw: { t0: number | null; moved: number | null; raf: boolean; end: number | null; moves: number[] } };
    w.__sw.raf = false;
    return { t0: w.__sw.t0, moved: w.__sw.moved, end: w.__sw.end, firstMove: w.__sw.moves[0] ?? null, lastMove: w.__sw.moves.at(-1) ?? null };
  });
  expect(r.t0, 'touchstart reached the page').not.toBeNull();
  expect(r.moved, 'the camera moved during the swipe').not.toBeNull();
  const delay = (r.moved ?? 0) - (r.t0 ?? 0);
  test.info().annotations.push({ type: 'swipe-delay-ms', description: delay.toFixed(1) });
  mkdirSync('test-results', { recursive: true });
  appendFileSync('test-results/swipe-delay.txt', `${test.info().project.name} ${delay.toFixed(1)} ms (first touchmove +${((r.firstMove ?? 0) - (r.t0 ?? 0)).toFixed(0)}, last touchmove +${((r.lastMove ?? 0) - (r.t0 ?? 0)).toFixed(0)}, touchend +${((r.end ?? 0) - (r.t0 ?? 0)).toFixed(0)})\n`);
});
