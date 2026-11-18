import { appendFileSync, mkdirSync } from 'node:fs';
import { checkBudget, recordFrames } from '../helpers/frames.ts';
import { expect, isLow, PROJECTS, test } from '../helpers/jardin.ts';

// The rail fallback (?roam=0), kept for one release now that free roam is the default (cook/ROAM_PLAN.md P7): the
// specs about the rail's own motion, moved here unchanged from flow 4, flow 6, the controls travel and the swipe spec.

const BEDS = ['puerta', 'rosaleda', 'estanque', 'semillero', 'gruta', 'salida'] as const;

test.describe('rail fallback (?roam=0)', () => {
  test('flow 4 rail: travel through every bed and back, streaming and memory return to baseline', async ({ page, jardin, tierOpt }) => {
    await jardin.visit({ mode: 'garden', rail: true });
    await jardin.goto('#/', true);
    await jardin.longTasksAfterReady();
    const base = await jardin.withApi((api) => ({ tex: api.info().texBytes, programs: api.info().programs }));
    for (const bed of BEDS) {
      const stats = await recordFrames(page, `travel to ${bed}`, () => jardin.goto(`#/b/${bed}`));
      expect(checkBudget(stats, 'travel', isLow(tierOpt)), `${bed}: ${JSON.stringify(stats)}`).toBeNull();
      const now = await jardin.withApi((api, b: string) => ({ res: api.residency()[b as 'puerta'], info: api.info() }), bed);
      expect(now.res, `${bed} is active after travel`).toBe('active');
      expect(now.info.programs, 'programs after ready').toBe(base.programs);
    }
    await jardin.goto('#/');
    await page.waitForTimeout(2500);
    const end = await jardin.withApi((api) => ({ tex: api.info().texBytes, res: api.residency() }));
    expect(Object.values(end.res).filter((s) => s === 'active')).toHaveLength(0);
    expect(await jardin.longTasksAfterReady(), 'long tasks over 100 ms while streaming beds').toEqual([]);
    expect(end.tex, 'texture bytes back to baseline after leaving').toBeLessThanOrEqual(base.tex * 1.1 + 2 ** 20);
  });

  test('flow 6 rail: overview, beds, flowers, panel and Herbario by keyboard, Esc backs out one level', async ({ page, jardin }) => {
    const first = PROJECTS[0];
    if (first === undefined) return;
    await jardin.visit({ mode: 'garden', rail: true });
    await jardin.settled();
    const phase = () => jardin.withApi((api) => api.state().phase);
    expect(await phase()).toBe('overview');
    await page.keyboard.press('ArrowRight'); // arrows move between beds
    await page.keyboard.press('Enter'); // enter the bed
    await jardin.settled();
    expect(await phase()).toBe('bed');
    for (let i = 0; i < 20 && (await phase()) !== 'focus'; i++) await page.keyboard.press('Tab'); // flowers are proxies
    expect(await phase()).toBe('focus');
    await page.keyboard.press('Enter'); // View
    await jardin.settled();
    expect(await phase()).toBe('inspect');
    await page.keyboard.press('Escape'); // one level: panel to the flower (closing returns focus to it)
    await jardin.settled();
    expect(await phase()).toBe('focus');
    await page.keyboard.press('Escape'); // one level: flower to bed
    await jardin.settled();
    expect(await phase()).toBe('bed');
    await page.keyboard.press('Escape'); // one level: bed to overview
    await jardin.settled();
    expect(await phase()).toBe('overview');
    await page.getByRole('button', { name: 'Exit to the CV album' }).focus();
    await page.keyboard.press('Enter');
    await jardin.settled();
    expect(await jardin.mode()).toBe('herbario');
  });

  test('travel rail: a jump of more than one bed settles with the target active', async ({ jardin }) => {
    await jardin.visit({ mode: 'garden', rail: true });
    await jardin.goto('#/b/puerta', true);
    await jardin.goto('#/b/gruta');
    expect((await jardin.withApi((api) => api.residency())).gruta).toBe('active');
  });

  // Mobile: delay between the first touch of a swipe and the first camera movement, in ms. Measured in the page: the
  // touchstart event time stamp against the first rAF frame whose camera pose differs from the pose at touchstart.
  // Reported as an annotation (and in the failure message); the only hard rule is that the swipe moves the camera.
  test('mobile swipe rail: the camera starts to move after the first touch, delay measured', async ({ page, jardin, isMobile }) => {
    test.skip(!isMobile, 'touch swipe is a mobile profile');
    await jardin.visit({ mode: 'garden', hash: '#/b/rosaleda', rail: true });
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
});
