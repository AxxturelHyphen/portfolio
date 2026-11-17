import type { Clock, DebugParams, Tier } from '../types.ts';

/** URL debug params of spec section 11. Unknown or malformed values are dropped, never an error. */
export function parseDebug(search: URLSearchParams): DebugParams {
  const q: DebugParams = {};
  const mode = search.get('mode');
  if (mode === 'garden' || mode === 'herbario') q.mode = mode;
  const shot = search.get('shot');
  if (shot !== null && /^S\d\d$/.test(shot)) q.shot = shot;
  const t = Number.parseFloat(search.get('t') ?? '');
  if (Number.isFinite(t) && t >= 0) q.t = t;
  const tier = search.get('tier');
  if (tier === 'high' || tier === 'mid' || tier === 'low') q.tier = tier;
  const lang = search.get('lang');
  if (lang === 'en' || lang === 'es') q.lang = lang;
  for (const key of ['film', 'stats', 'bench'] as const) {
    const v = search.get(key);
    if (v === '0' || v === '1') q[key] = v === '1' ? 1 : 0;
  }
  return q;
}

/** window.__jardin exists only with ?bench=1 or in the dev server (cook/ARCH.md 2.11). */
export const testApiEnabled = (q: DebugParams): boolean => q.bench === 1 || import.meta.env.DEV;

/** What the overlay shows each refresh. */
export interface StatsSource { calls(): number; tier(): Tier; dpr(): number }
export interface StatsOverlay { frame(c: Clock): void }

/** Overlay refresh interval in frames; between refreshes it only sums. */
const STATS_EVERY = 30;

/** ?stats=1: fps, frame ms (avg over the last 30 frames), draw calls, tier and DPR. Debug only; text nodes only. */
export function createStatsOverlay(parent: HTMLElement, src: StatsSource): StatsOverlay {
  // Integer labels 0..999 and DPR labels on the 0.125 grid, built once so a refresh creates no strings.
  const numbers: readonly string[] = Array.from({ length: 1000 }, (_, i) => String(i));
  const dprs: readonly string[] = Array.from({ length: 17 }, (_, i) => (i * 0.125).toFixed(3));
  const num = (v: number): string => numbers[v < 0 ? 0 : v > 999 ? 999 : Math.round(v)] ?? '999';
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9;pointer-events:none;font:12px/1.4 ui-monospace,monospace;color:#fff;background:#0009;padding:4px 6px;white-space:pre';
  const fps = document.createTextNode('0');
  const ms = document.createTextNode('0');
  const calls = document.createTextNode('0');
  const tier = document.createTextNode('');
  const dpr = document.createTextNode('');
  el.append('fps ', fps, '  ms ', ms, '  calls ', calls, '\n', tier, ' dpr ', dpr);
  parent.append(el);
  let sum = 0;
  let n = 0;
  return {
    frame(c: Clock): void {
      sum += c.dt;
      if (++n < STATS_EVERY) return;
      const avg = sum / n;
      fps.data = num(avg > 0 ? 1 / avg : 0);
      ms.data = num(avg * 1000);
      calls.data = num(src.calls());
      tier.data = src.tier();
      dpr.data = dprs[Math.round(src.dpr() / 0.125)] ?? '';
      sum = 0;
      n = 0;
    },
  };
}
