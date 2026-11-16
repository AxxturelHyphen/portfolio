import type { Page } from '@playwright/test';

// Frame-time recorder: rAF deltas in the page while a named transition runs. Independent of the app loop, so it
// also catches frames the app loop skipped. When window.__jardin exists, its FrameRecorder report rides along.

export interface FrameStats {
  label: string;
  frames: number;
  over25: number;
  over50: number;
  over100: number;
  max: number;
  /** App-side report from window.__jardin.rec (draw calls, long tasks), when the test API is present. */
  app: { frames: number; p95: number; max: number; over25: number; over50: number; callsP95: number; longTasks: number } | null;
}

/** Pure counting, also unit tested. Deltas are frame times in ms. */
export function summarise(label: string, deltas: readonly number[]): Omit<FrameStats, 'app'> {
  let over25 = 0;
  let over50 = 0;
  let over100 = 0;
  let max = 0;
  for (const d of deltas) {
    if (d > 25) over25++;
    if (d > 50) over50++;
    if (d > 100) over100++;
    if (d > max) max = d;
  }
  return { label, frames: deltas.length, over25, over50, over100, max };
}

/** Budgets of spec section 10. kind 'switch' is the Garden <-> Herbario row. */
export type BudgetKind = 'panel' | 'travel' | 'switch';
export function checkBudget(s: Pick<FrameStats, 'over25' | 'over50' | 'over100' | 'max'>, kind: BudgetKind, low: boolean): string | null {
  if (kind === 'switch') {
    const limit = low ? 150 : 100;
    return s.max > limit ? `a frame took ${s.max.toFixed(0)} ms, limit ${limit}` : null;
  }
  if (low) return s.over50 > 2 ? `${s.over50} frames over 50 ms, limit 2` : null;
  return s.over25 > 0 ? `${s.over25} frames over 25 ms, limit 0` : null;
}

/** Runs `action` while recording. The recorder starts one frame before the action and stops after `settleMs` of quiet. */
export async function recordFrames(page: Page, label: string, action: () => Promise<unknown>, settleMs = 600): Promise<FrameStats> {
  await page.evaluate((name) => {
    const w = window as unknown as { __rec?: { deltas: number[]; stop: boolean }; __jardin?: { rec?: { start(l: string): void } } };
    const rec = { deltas: [] as number[], stop: false };
    w.__rec = rec;
    w.__jardin?.rec?.start(name);
    let last = performance.now();
    const tick = (now: number): void => {
      rec.deltas.push(now - last);
      last = now;
      if (!rec.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame((now) => {
      last = now;
      requestAnimationFrame(tick);
    });
  }, label);
  await action();
  await page.waitForTimeout(settleMs);
  const raw = await page.evaluate(() => {
    const w = window as unknown as { __rec?: { deltas: number[]; stop: boolean }; __jardin?: { rec?: { stop(): Record<string, number> } } };
    if (w.__rec) w.__rec.stop = true;
    const app = w.__jardin?.rec?.stop() ?? null;
    return { deltas: w.__rec?.deltas.slice(0, -1) ?? [], app };
  });
  const base = summarise(label, raw.deltas);
  const a = raw.app;
  return {
    ...base,
    app: a === null ? null : { frames: a['frames'] ?? 0, p95: a['p95'] ?? 0, max: a['max'] ?? 0, over25: a['over25'] ?? 0, over50: a['over50'] ?? 0, callsP95: a['callsP95'] ?? 0, longTasks: a['longTasks'] ?? 0 },
  };
}
