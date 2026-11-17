import type { Page } from '@playwright/test';

// Full-bleed check for the garden canvas (cook/BRIEF.md, "Full screen and browser checks"): the canvas rect must equal
// the viewport rect at every size and after every resize, with no page scrollbars. e2e-ready: pass any Playwright page.

export interface BleedSample {
  viewport: { w: number; h: number };
  canvas: { x: number; y: number; w: number; h: number };
  /** Drawing buffer size in device px; follows the CSS box once the renderer has seen the resize. */
  buffer: { w: number; h: number };
  /** Space taken by page scrollbars (0 when none show) and whether the page can be scrolled by the visitor. */
  bars: { w: number; h: number };
  scrollable: boolean;
}

/** Viewports of the owner's check: the e2e sizes plus odd ones. */
export const BLEED_SIZES: readonly { width: number; height: number }[] = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1280, height: 607 },
  { width: 2560, height: 1080 },
  { width: 800, height: 1200 },
  { width: 390, height: 844 },
];

export function measureBleed(page: Page): Promise<BleedSample> {
  return page.evaluate(() => {
    const c = document.getElementById('garden') as HTMLCanvasElement | null;
    const r = c?.getBoundingClientRect();
    const root = document.documentElement;
    return {
      viewport: { w: innerWidth, h: innerHeight },
      canvas: { x: r?.x ?? -1, y: r?.y ?? -1, w: r?.width ?? 0, h: r?.height ?? 0 },
      buffer: { w: c?.width ?? 0, h: c?.height ?? 0 },
      bars: { w: innerWidth - root.clientWidth, h: innerHeight - root.clientHeight },
      scrollable: getComputedStyle(root).overflow !== 'hidden' && (root.scrollWidth > innerWidth + 1 || root.scrollHeight > innerHeight + 1),
    };
  });
}

/** Null when the canvas covers the viewport exactly, no scrollbar shows and the visitor cannot scroll; else what is wrong. */
export function bleedError(s: BleedSample): string | null {
  const off = Math.abs(s.canvas.x) > 0.5 || Math.abs(s.canvas.y) > 0.5;
  const size = Math.abs(s.canvas.w - s.viewport.w) > 0.5 || Math.abs(s.canvas.h - s.viewport.h) > 0.5;
  const scroll = s.bars.w > 0 || s.bars.h > 0 || s.scrollable;
  if (!off && !size && !scroll) return null;
  return `canvas ${s.canvas.x},${s.canvas.y} ${s.canvas.w}x${s.canvas.h} in viewport ${s.viewport.w}x${s.viewport.h}, bars ${s.bars.w}x${s.bars.h}, scrollable ${s.scrollable}`;
}

/** Waits two frames so the ResizeObserver and the 'input' stage have applied the new size. */
export function nextFrames(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Steps the viewport between two sizes without waiting for settle, sampling after each frame pair (a live drag). */
export async function liveResize(page: Page, from: { width: number; height: number }, to: { width: number; height: number }, steps: number): Promise<BleedSample[]> {
  const out: BleedSample[] = [];
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    await page.setViewportSize({ width: Math.round(from.width + (to.width - from.width) * k), height: Math.round(from.height + (to.height - from.height) * k) });
    await nextFrames(page);
    out.push(await measureBleed(page));
  }
  return out;
}
