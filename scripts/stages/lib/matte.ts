// Edge refinement shared by the classical key and the ML fallback: inside a thin band around the mask boundary,
// alpha is the projection of the pixel onto the line from the local paper colour B to the nearest interior colour F
// (C = a F + (1 - a) B in linear light), and the colour is un-mixed from the paper, so no paper tone is left on
// the edge. Away from the band the mask decides: inside is opaque with the original colour, outside is empty.
import type { Planes } from './color.ts';
import { distanceTo, type Mask } from './morph.ts';

export interface Matte { alpha: Float32Array; color: Planes /* linear RGB, valid where alpha > 0 */ }

export interface RefineOptions {
  /** Band half-width inside the mask edge, px. */
  inside: number;
  /** Band width outside the mask edge, px. */
  outside: number;
  /** Fallback alpha where paper and interior colour are too close to project (soft key or ML alpha), 0..1. */
  fallback: Float32Array;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Below this squared linear-RGB distance between F and B the projection is noise and the fallback alpha wins. */
const PROJ_MIN = 0.002;
const PROJ_FULL = 0.012;
/** Residual alpha below this is cut, so faint paper texture next to an edge never survives as a veil. */
const CHOKE = 0.06;

export function refineEdges(lin: Planes, paper: Planes, m: Mask, o: RefineOptions): Matte {
  const { w, h } = m;
  const n = w * h;
  const inDist = distanceTo(w, h, (i) => m.m[i] === 0, true);
  const outDist = distanceTo(w, h, (i) => m.m[i] === 1);
  const isCore = (i: number): boolean => inDist[i]! > o.inside;
  const inBand = (i: number): boolean => !isCore(i) && (m.m[i] === 1 || outDist[i]! <= o.outside);
  const fromCore = distanceTo(w, h, isCore);
  const color: Planes = { w, h, c0: new Float32Array(n), c1: new Float32Array(n), c2: new Float32Array(n) };
  const alpha = new Float32Array(n);
  const fr = new Float32Array(n);
  const fg = new Float32Array(n);
  const fb = new Float32Array(n);
  const known = new Uint8Array(n);
  const band: number[] = [];
  for (let i = 0; i < n; i++) {
    if (isCore(i)) {
      alpha[i] = 1;
      color.c0[i] = fr[i] = lin.c0[i]!;
      color.c1[i] = fg[i] = lin.c1[i]!;
      color.c2[i] = fb[i] = lin.c2[i]!;
      known[i] = 1;
    } else if (inBand(i)) band.push(i);
  }
  band.sort((a, b) => fromCore[a]! - fromCore[b]!);
  for (const i of band) {
    const x = i % w;
    const y = (i - x) / w;
    let k = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (known[j] !== 1) continue;
        r += fr[j]!;
        g += fg[j]!;
        b += fb[j]!;
        k++;
      }
    }
    if (k > 0) {
      fr[i] = r / k;
      fg[i] = g / k;
      fb[i] = b / k;
    } else {
      fr[i] = lin.c0[i]!;
      fg[i] = lin.c1[i]!;
      fb[i] = lin.c2[i]!;
    }
    known[i] = 1;
    unmix(i, lin, paper, fr, fg, fb, o.fallback[i]!, alpha, color);
  }
  return { alpha, color };
}

function unmix(i: number, lin: Planes, paper: Planes, fr: Float32Array, fg: Float32Array, fb: Float32Array, fallback: number, alpha: Float32Array, color: Planes): void {
  const br = paper.c0[i]!;
  const bg = paper.c1[i]!;
  const bb = paper.c2[i]!;
  const vr = lin.c0[i]! - br;
  const vg = lin.c1[i]! - bg;
  const vb = lin.c2[i]! - bb;
  const ur = fr[i]! - br;
  const ug = fg[i]! - bg;
  const ub = fb[i]! - bb;
  const uu = ur * ur + ug * ug + ub * ub;
  const proj = uu > 1e-6 ? clamp01((vr * ur + vg * ug + vb * ub) / uu) : 0;
  const t = smooth(PROJ_MIN, PROJ_FULL, uu);
  const raw = t * proj + (1 - t) * fallback;
  const a = clamp01((raw - CHOKE) / (1 - CHOKE));
  alpha[i] = a;
  if (a <= 0) return;
  const keep = smooth(0.15, 0.7, raw);
  const inv = 1 / Math.max(raw, 0.05);
  color.c0[i] = clamp01(fr[i]! * (1 - keep) + (br + vr * inv) * keep);
  color.c1[i] = clamp01(fg[i]! * (1 - keep) + (bg + vg * inv) * keep);
  color.c2[i] = clamp01(fb[i]! * (1 - keep) + (bb + vb * inv) * keep);
}
