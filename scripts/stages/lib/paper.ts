// Paper estimation for the classical key: one global paper colour from the plate margin, then a smooth local
// paper field (toning, foxing gradients, scan falloff) from a coarse grid of paper-coloured cells.
import type { Planes } from './color.ts';
import { L_WEIGHT } from './color.ts';

export interface Paper {
  /** Per-pixel paper colour in OKLab. */
  field: Planes;
  /** Global paper colour in OKLab. */
  global: [number, number, number];
  /** Key distance below which a pixel reads as paper (90th percentile of paper pixels against the field). */
  noise: number;
  /** Share of grid cells where paper was seen directly (the rest is interpolated). */
  seen: number;
}

const GRID = 40;
/** A cell counts as paper when at least this share of its pixels lie near the global paper colour. */
const CELL_SHARE = 0.35;
/** Generous distance to the global paper colour that still counts as paper (toning varies across a sheet). */
const NEAR_GLOBAL = 0.07;

const dist = (l: number, a: number, b: number, p: readonly number[]): number => Math.hypot((l - p[0]!) * L_WEIGHT, a - p[1]!, b - p[2]!);

/** Mode of the colours in the ring between 3% and 18% inset from the edges, refined by a mean around the mode. */
function globalPaper(lab: Planes, region: (x: number, y: number) => boolean): [number, number, number] {
  const { w, h } = lab;
  const bins = new Map<number, number>();
  const key = (i: number): number => {
    const l = Math.round(lab.c0[i]! * 60);
    const a = Math.round(lab.c1[i]! * 150) + 64;
    const b = Math.round(lab.c2[i]! * 150) + 64;
    return (l * 128 + a) * 128 + b;
  };
  const inRing = (x: number, y: number): boolean => {
    const u = Math.min(x / w, 1 - x / w);
    const v = Math.min(y / h, 1 - y / h);
    const m = Math.min(u, v);
    return m > 0.03 && m < 0.18 && region(x, y);
  };
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (inRing(x, y)) bins.set(key(y * w + x), (bins.get(key(y * w + x)) ?? 0) + 1);
  let best = -1;
  let bestN = 0;
  for (const [k, n] of bins) if (n > bestN) [best, bestN] = [k, n];
  const mode: [number, number, number] = [Math.floor(best / 16384) / 60, (Math.floor(best / 128) % 128 - 64) / 150, ((best % 128) - 64) / 150];
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let n = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = y * w + x;
      if (!inRing(x, y) || dist(lab.c0[i]!, lab.c1[i]!, lab.c2[i]!, mode) > 0.03) continue;
      s0 += lab.c0[i]!;
      s1 += lab.c1[i]!;
      s2 += lab.c2[i]!;
      n++;
    }
  }
  return n > 0 ? [s0 / n, s1 / n, s2 / n] : mode;
}

const median = (v: number[]): number => {
  v.sort((a, b) => a - b);
  return v[v.length >> 1] ?? 0;
};

/** Estimates the paper of a plate. region(x, y) limits the estimate to the hinted crop (all true by default). */
export function estimatePaper(lab: Planes, region: (x: number, y: number) => boolean = () => true): Paper {
  const { w, h } = lab;
  const global = globalPaper(lab, region);
  const cell = Math.max(8, Math.ceil(Math.max(w, h) / GRID));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const grid = [new Float32Array(gw * gh), new Float32Array(gw * gh), new Float32Array(gw * gh)] as const;
  const known = new Uint8Array(gw * gh);
  const ch = [lab.c0, lab.c1, lab.c2] as const;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const vals: [number[], number[], number[]] = [[], [], []];
      let total = 0;
      for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y += 2) {
        for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x += 2) {
          if (!region(x, y)) continue;
          total++;
          const i = y * w + x;
          if (dist(lab.c0[i]!, lab.c1[i]!, lab.c2[i]!, global) > NEAR_GLOBAL) continue;
          for (let c = 0; c < 3; c++) vals[c]!.push(ch[c]![i]!);
        }
      }
      if (total === 0 || vals[0].length < total * CELL_SHARE) continue;
      const g = gy * gw + gx;
      known[g] = 1;
      for (let c = 0; c < 3; c++) grid[c]![g] = median(vals[c]!);
    }
  }
  const seen = known.reduce((s, v) => s + v, 0) / known.length;
  fillUnknown(grid, known, gw, gh, global);
  for (let pass = 0; pass < 2; pass++) for (const g of grid) blur3(g, gw, gh);
  const field: Planes = { w, h, c0: new Float32Array(w * h), c1: new Float32Array(w * h), c2: new Float32Array(w * h) };
  const out = [field.c0, field.c1, field.c2] as const;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const g = grid[c]!;
        const top = g[y0 * gw + x0]! * (1 - tx) + g[y0 * gw + x1]! * tx;
        const bot = g[y1 * gw + x0]! * (1 - tx) + g[y1 * gw + x1]! * tx;
        out[c]![y * w + x] = top * (1 - ty) + bot * ty;
      }
    }
  }
  return { field, global, noise: paperNoise(lab, field, region), seen };
}

/** Fills cells without paper from their known neighbours, ring by ring; with no paper at all, the global colour. */
function fillUnknown(grid: readonly [Float32Array, Float32Array, Float32Array], known: Uint8Array, gw: number, gh: number, global: readonly number[]): void {
  if (!known.includes(1)) {
    for (let c = 0; c < 3; c++) grid[c]!.fill(global[c]!);
    return;
  }
  while (known.includes(0)) {
    const next = known.slice();
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const g = y * gw + x;
        if (known[g] === 1) continue;
        let n = 0;
        const s = [0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= gw || yy >= gh || known[yy * gw + xx] !== 1) continue;
            for (let c = 0; c < 3; c++) s[c]! += grid[c]![yy * gw + xx]!;
            n++;
          }
        }
        if (n === 0) continue;
        for (let c = 0; c < 3; c++) grid[c]![g] = s[c]! / n;
        next[g] = 1;
      }
    }
    known.set(next);
  }
}

function blur3(g: Float32Array, gw: number, gh: number): void {
  const src = g.slice();
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          s += src[yy * gw + xx]!;
          n++;
        }
      }
      g[y * gw + x] = s / n;
    }
  }
}

/** 90th percentile of the key distance of paper-like pixels (near the field) against the field. */
function paperNoise(lab: Planes, field: Planes, region: (x: number, y: number) => boolean): number {
  const v: number[] = [];
  for (let y = 0; y < lab.h; y += 3) {
    for (let x = 0; x < lab.w; x += 3) {
      if (!region(x, y)) continue;
      const i = y * lab.w + x;
      const d = Math.hypot((lab.c0[i]! - field.c0[i]!) * L_WEIGHT, lab.c1[i]! - field.c1[i]!, lab.c2[i]! - field.c2[i]!);
      if (d < NEAR_GLOBAL * 0.6) v.push(d);
    }
  }
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length * 0.9)] ?? 0.01;
}
