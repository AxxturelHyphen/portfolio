// Colour spaces for keying: sRGB8 to linear light and to OKLab (Ottosson 2020), as planar Float32 buffers.
import type { Raster } from '../raster.ts';

const LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

export const toLinear = (v8: number): number => LINEAR[v8]!;

export function toSrgb8(lin: number): number {
  const c = lin <= 0 ? 0 : lin >= 1 ? 1 : lin;
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
}

/** Planar image: three channels of w*h floats. */
export interface Planes { w: number; h: number; c0: Float32Array; c1: Float32Array; c2: Float32Array }

const planes = (w: number, h: number): Planes => ({ w, h, c0: new Float32Array(w * h), c1: new Float32Array(w * h), c2: new Float32Array(w * h) });

export function linearPlanes(r: Raster): Planes {
  const p = planes(r.w, r.h);
  for (let i = 0; i < r.w * r.h; i++) {
    p.c0[i] = LINEAR[r.data[i * 4]!]!;
    p.c1[i] = LINEAR[r.data[i * 4 + 1]!]!;
    p.c2[i] = LINEAR[r.data[i * 4 + 2]!]!;
  }
  return p;
}

/** Linear RGB planes to OKLab planes (L in 0..1, a and b around 0). */
export function oklabOf(lin: Planes): Planes {
  const p = planes(lin.w, lin.h);
  for (let i = 0; i < lin.w * lin.h; i++) {
    const r = lin.c0[i]!;
    const g = lin.c1[i]!;
    const b = lin.c2[i]!;
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    p.c0[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    p.c1[i] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    p.c2[i] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  }
  return p;
}

/** OKLab planes back to linear RGB planes (unclamped). */
export function linearOf(lab: Planes): Planes {
  const p = planes(lab.w, lab.h);
  for (let i = 0; i < lab.w * lab.h; i++) {
    const L = lab.c0[i]!;
    const A = lab.c1[i]!;
    const B = lab.c2[i]!;
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    p.c0[i] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    p.c1[i] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    p.c2[i] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  }
  return p;
}

/** Weight of lightness against chroma in the key distance: paper shading and scan falloff live mostly in L. */
export const L_WEIGHT = 0.75;

/** Perceptual distance of every pixel to a per-pixel reference (both OKLab planes). */
export function keyDistance(lab: Planes, ref: Planes): Float32Array {
  const d = new Float32Array(lab.w * lab.h);
  for (let i = 0; i < d.length; i++) {
    const dl = (lab.c0[i]! - ref.c0[i]!) * L_WEIGHT;
    const da = lab.c1[i]! - ref.c1[i]!;
    const db = lab.c2[i]! - ref.c2[i]!;
    d[i] = Math.sqrt(dl * dl + da * da + db * db);
  }
  return d;
}
