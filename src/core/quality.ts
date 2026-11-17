import type { Clock, DebugParams, ModeDecision, ModeEnv, Quality, Tier, TierConfig } from '../types.ts';

/**
 * Start mode (spec section 6). Self-contained on purpose: scripts/prerender.ts inlines its source into the
 * boot stub that runs before first paint, so it may not reference anything outside its own body.
 * No WebGL2: Herbario, garden never loads. Else ?mode wins. Else reduced motion or Save-Data: Herbario.
 * With reduced motion or Save-Data the garden chunk loads only on "Enter the garden", never at idle.
 */
export function decideMode(env: ModeEnv): ModeDecision {
  if (!env.webgl2) return { mode: 'herbario', loadGarden: false };
  const lighter = env.reducedMotion || env.saveData;
  if (env.q.mode !== undefined) return { mode: env.q.mode, loadGarden: env.q.mode === 'garden' || !lighter };
  if (lighter) return { mode: 'herbario', loadGarden: false };
  return { mode: 'garden', loadGarden: true };
}

/** Touch-first device: mobile pause rules and the starting tier read this. */
export const coarsePointer = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Tier table (spec sections 9 and 10; cook/ARCH.md section 4 budget map). Budgets are the section 10 gates. */
export const TIERS: Readonly<Record<Tier, TierConfig>> = {
  high: { tier: 'high', dprMin: 1, dprMax: 1.5, pixelCap: 3_200_000, halation: true, filmScale: 1, maxLayers: 8, fireflies: 64, atlas: 'hi', texBudgetMB: 128, drawBudget: 80 },
  mid: { tier: 'mid', dprMin: 0.75, dprMax: 1.25, pixelCap: 2_100_000, halation: true, filmScale: 1, maxLayers: 6, fireflies: 40, atlas: 'hi', texBudgetMB: 96, drawBudget: 60 },
  low: { tier: 'low', dprMin: 0.75, dprMax: 1, pixelCap: 1_000_000, halation: false, filmScale: 0.5, maxLayers: 4, fireflies: 16, atlas: 'lo', texBudgetMB: 48, drawBudget: 40 },
};
const ORDER: readonly Tier[] = ['low', 'mid', 'high'];

/** Probe and adaptive DPR constants. Frame times in ms; ratios are against the display's refresh interval. */
export const PROBE = { durationMs: 2000, warmupFrames: 10, pauseGapMs: 250, minFrames: 30, highP90: 1.25, highAvg: 1.1, midP90Ms: 34, midP90: 2.2, lowP90Ms: 50 } as const;
export const DPR = { min: 0.75, max: 1.5, step: 0.125, window: 60, downRatio: 1.3, upRatio: 1.05, upWindows: 3 } as const;
/** Render scale while the panel is open on desktop (switched while the iris is shut). */
export const PANEL_RENDER_SCALE = 0.75;

const quantise = (d: number): number => Math.round(d / DPR.step) * DPR.step;
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const lower = (a: Tier, b: Tier): Tier => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);

/** Refresh interval estimate from sorted deltas: their 25th percentile, held between 144 Hz and 50 Hz. */
export function refreshOf(sorted: Float32Array): number {
  return clamp(sorted[Math.floor(sorted.length * 0.25)] ?? 16.7, 6.9, 20);
}

/** Tier from probe frame deltas (ms); null below PROBE.minFrames (under 15 fps over 2 s: the caller fails). Sorts in place. */
export function tierFromDeltas(deltas: Float32Array): { tier: Tier | 'fail'; refreshMs: number } | null {
  if (deltas.length < PROBE.minFrames) return null;
  deltas.sort();
  let sum = 0;
  for (let i = 0; i < deltas.length; i++) sum += deltas[i] ?? 0;
  const avg = sum / deltas.length;
  const p90 = deltas[Math.min(deltas.length - 1, Math.ceil(deltas.length * 0.9) - 1)] ?? 0;
  const base = refreshOf(deltas);
  let tier: Tier | 'fail' = 'fail';
  if (p90 <= base * PROBE.highP90 && avg <= base * PROBE.highAvg) tier = 'high';
  else if (p90 <= Math.max(PROBE.midP90Ms, base * PROBE.midP90)) tier = 'mid';
  else if (p90 <= PROBE.lowP90Ms) tier = 'low';
  return { tier, refreshMs: base };
}

/** Quality as the composition root sees it: the Quality of ARCH plus the per-frame probe feed. */
export interface RuntimeQuality extends Quality {
  readonly mobile: boolean;
  /** Feeds the running probe with this frame's delta. Call every frame from one hook. */
  sample(c: Clock): void;
}

export interface QualityEnv { mobile: boolean; devicePixelRatio: number; lowMemory: boolean }

/** Starting tier before the probe: ?tier wins, else mobile or a small device starts at mid. */
const startTier = (q: DebugParams, env: QualityEnv): Tier => q.tier ?? (env.mobile || env.lowMemory ? 'mid' : 'high');

export function createQualityWith(q: DebugParams, env: QualityEnv): RuntimeQuality {
  let tier = startTier(q, env);
  let cfg = TIERS[tier];
  let refreshMs = 1000 / 60;
  let dpr = 1;
  let panelK = 1;
  const subs = new Set<(x: Quality) => void>();

  const probeBuf = new Float32Array(512);
  let probeN = 0;
  let probeMs = 0;
  let probeSkip = 0;
  let probeDone: ((r: Tier | 'fail') => void) | null = null;
  let probePromise: Promise<Tier | 'fail'> | null = null;
  let lastNow = -1;

  let winSum = 0;
  let winN = 0;
  let goodWindows = 0;
  let lastAdaptFrame = -2;

  const fitDpr = (): void => {
    dpr = clamp(quantise(Math.min(env.devicePixelRatio, cfg.dprMax)), Math.max(DPR.min, cfg.dprMin), Math.min(DPR.max, cfg.dprMax));
  };
  const notify = (): void => {
    for (const fn of subs) fn(quality);
  };

  function finishProbe(): void {
    const r = tierFromDeltas(probeBuf.subarray(0, probeN));
    const done = probeDone;
    probeDone = null;
    if (done === null) return;
    if (r === null) {
      done('fail');
      return;
    }
    refreshMs = r.refreshMs;
    if (r.tier !== 'fail' && r.tier !== tier) {
      tier = lower(tier, r.tier);
      cfg = TIERS[tier];
      fitDpr();
      notify();
    }
    done(r.tier === 'fail' ? 'fail' : tier);
  }

  const quality: RuntimeQuality = {
    mobile: env.mobile,
    get tier() {
      return tier;
    },
    get cfg() {
      return cfg;
    },
    get dpr() {
      return dpr;
    },
    get scale() {
      return (dpr / cfg.dprMax) * panelK;
    },
    probe(): Promise<Tier | 'fail'> {
      if (q.tier !== undefined) return Promise.resolve(q.tier);
      probePromise ??= new Promise((resolve) => {
        probeN = 0;
        probeMs = 0;
        probeSkip = PROBE.warmupFrames;
        probeDone = resolve;
      });
      return probePromise;
    },
    sample(c: Clock): void {
      const delta = lastNow < 0 ? 0 : c.now - lastNow;
      lastNow = c.now;
      if (probeDone === null || delta <= 0 || delta > PROBE.pauseGapMs) return;
      if (probeSkip > 0) {
        probeSkip--;
        return;
      }
      if (probeN < probeBuf.length) probeBuf[probeN++] = delta;
      probeMs += delta;
      if (probeMs >= PROBE.durationMs) finishProbe();
    },
    adapt(c: Clock): void {
      if (c.frame !== lastAdaptFrame + 1) {
        winSum = 0;
        winN = 0;
      }
      lastAdaptFrame = c.frame;
      if (probeDone !== null) return;
      winSum += c.dt * 1000;
      winN++;
      if (winN < DPR.window) return;
      const avg = winSum / winN;
      winSum = 0;
      winN = 0;
      const lo = Math.max(DPR.min, cfg.dprMin);
      const hi = Math.min(DPR.max, cfg.dprMax, Math.max(lo, quantise(env.devicePixelRatio)));
      if (avg > refreshMs * DPR.downRatio) {
        goodWindows = 0;
        if (dpr > lo) {
          dpr = Math.max(lo, dpr - DPR.step);
          notify();
        }
      } else if (avg < refreshMs * DPR.upRatio && ++goodWindows >= DPR.upWindows) {
        goodWindows = 0;
        if (dpr < hi) {
          dpr = Math.min(hi, dpr + DPR.step);
          notify();
        }
      }
    },
    setPanelScale(k: number): void {
      if (k === panelK) return;
      panelK = k;
      notify();
    },
    onChange(fn: (x: Quality) => void): () => void {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
  fitDpr();
  return quality;
}

export function createQuality(q: DebugParams): RuntimeQuality {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return createQualityWith(q, {
    mobile: coarsePointer(),
    devicePixelRatio: window.devicePixelRatio || 1,
    lowMemory: (mem !== undefined && mem <= 4) || navigator.hardwareConcurrency <= 4,
  });
}
