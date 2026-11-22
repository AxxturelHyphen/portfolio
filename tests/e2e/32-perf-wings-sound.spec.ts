import type { Page } from '@playwright/test';
import { checkBudget, recordFrames } from '../helpers/frames.ts';
import { expect, isLow, test } from '../helpers/jardin.ts';
import { enterRoam } from '../helpers/roam.ts';

// Frame budgets where the owner felt lag: the moth queen's show on the Salida's back wall (src/world/boss.ts, its big
// wings) and the first click on the sound tag (src/audio/control.ts makes the AudioContext, audio/engine.ts loads and
// decodes off the main thread). Same budgets as spec 18: high, no frame over 25 ms; low, at most 2 over 50 ms. Long
// tasks: none over 50 ms (100 ms on the low tiers, which run at a 4x CPU throttle).

const longLimit = (low: boolean): number => (low ? 100 : 50);

/** Long tasks over `min` ms that started after `since` (the guard fixture observes them from the first script). */
const longTasksSince = (page: Page, since: number, min: number): Promise<number[]> =>
  page.evaluate(([t0, m]) => ((window as unknown as { __lt?: number[][] }).__lt ?? []).filter(([s, d]) => (s ?? 0) >= (t0 ?? 0) && (d ?? 0) > (m ?? 0)).map(([, d]) => d ?? 0), [since, min]);

test('perf wings: walking into the Salida and the moth queen show keep the frame budget', async ({ page, jardin, tierOpt }) => {
  test.setTimeout(120_000);
  const low = isLow(tierOpt);
  await enterRoam(jardin, '#/b/semillero');
  const t0 = await page.evaluate(() => performance.now());
  const stats = await recordFrames(page, 'salida moth queen', () => jardin.withApi(async (api) => {
    const frame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));
    const seen: string[] = [];
    for (const [x, z] of [[35, -2.4], [36.5, -0.4], [39.5, 0.8], [42, 0.2]] as const) {
      api.walkTo(x, z);
      for (let f = 0; f < 900; f++) {
        await frame();
        const p = api.roam();
        if (p === null || Math.hypot(p.x - x, p.z - z) < 0.3) break;
      }
    }
    for (let f = 0; f < 900 && api.boss() !== 'idle'; f++) {
      await frame();
      if (seen.at(-1) !== api.boss()) seen.push(api.boss());
    }
    for (let f = 0; f < 60; f++) await frame();
    (window as unknown as { __phases: string[] }).__phases = seen;
  }));
  const phases = await page.evaluate(() => (window as unknown as { __phases: string[] }).__phases);
  expect(await jardin.withApi((api) => api.state().bed)).toBe('salida');
  expect(await jardin.withApi((api) => api.boss()), 'the queen rests after her show').toBe('idle');
  if (!low) expect(phases, 'the show played').toContain('play');
  expect(stats.frames, 'frames recorded').toBeGreaterThan(200);
  expect(checkBudget(stats, 'travel', low), JSON.stringify(stats)).toBeNull();
  expect(await longTasksSince(page, t0, longLimit(low)), 'long tasks').toEqual([]);
});

test('perf sound: the first click on the sound tag blocks neither the click nor a frame', async ({ page, jardin, tierOpt }) => {
  const low = isLow(tierOpt);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('perf-sound') === null) localStorage.setItem('jardin.sound', 'off');
    sessionStorage.setItem('perf-sound', '1');
    const w = window as unknown as { __clicks: number[] };
    w.__clicks = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as PerformanceEventTiming[]) if (e.name === 'click' || e.name === 'pointerup') w.__clicks.push(e.processingEnd - e.processingStart);
    }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  });
  await page.goto(`./?mode=garden${low ? '&tier=low' : ''}#/`);
  await expect(page.locator('#toggles .tg-exit[data-mode="herbario"]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#toggles .tg')).not.toHaveAttribute('data-pending', /.*/);
  const tag = page.locator('#toggles .tg-sound');
  await expect(tag).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1500);
  const fetched: string[] = [];
  page.on('requestfinished', (r) => {
    if (/\/audio\/.+\.webm$/.test(r.url())) fetched.push(r.url());
  });
  const t0 = await page.evaluate(() => performance.now());
  const stats = await recordFrames(page, 'first sound click', async () => {
    await tag.click();
    await expect(tag).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => fetched.some((u) => u.includes('crickets')), { message: 'the cricket bed is loaded' }).toBe(true);
    await page.waitForTimeout(1500);
  });
  const clicks = await page.evaluate(() => (window as unknown as { __clicks: number[] }).__clicks);
  if (!low) expect(clicks.filter((ms) => ms > 16), 'click handlers over 16 ms').toEqual([]);
  expect(checkBudget(stats, 'travel', low), JSON.stringify(stats)).toBeNull();
  expect(await longTasksSince(page, t0, longLimit(low)), 'long tasks').toEqual([]);
  expect(jardin.errors).toEqual([]);
});
