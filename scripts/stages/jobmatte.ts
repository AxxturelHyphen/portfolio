/// <reference types="node" />
// Per-job mattes for plates whose ground is not paper (painted water, a dark lithograph ground): a salient-object
// ML matte run on the crop alone, a hand garbage matte (polygon in plate fractions, feathered), a luminance key for
// light figures on a dark ground, and an edge defringe so no ground colour survives on the soft edge.
import { mlMatte } from './lib/ml.ts';
import { dilate, raster, type Raster } from './raster.ts';
import { boxBlur } from './treat.ts';

/** A closed polygon of points in plate fractions. */
export type Polygon = [number, number][];

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const scaleAlpha = (r: Raster, a: Float32Array): void => {
  for (let i = 0; i < a.length; i++) r.data[i * 4 + 3] = Math.round(r.data[i * 4 + 3]! * a[i]!);
};

/** Multiplies alpha by the ML matte of this crop (the crop is framed so the wanted part is its salient object). */
export function applyCropMl(r: Raster): string {
  const { alpha, tool } = mlMatte(r);
  scaleAlpha(r, alpha);
  return tool;
}

/** Keeps only what lies inside the polygon (even-odd rule), with a feathered edge of `feather` px. */
export function applyPolygon(r: Raster, poly: Polygon, toLocal: (fx: number, fy: number) => [number, number], feather: number): void {
  const pts = poly.map(([x, y]) => toLocal(x, y));
  const inside = new Float32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let k = 0; k < pts.length; k++) {
      const [x0, y0] = pts[k]!;
      const [x1, y1] = pts[(k + 1) % pts.length]!;
      if ((y0 <= cy && y1 > cy) || (y1 <= cy && y0 > cy)) xs.push(x0 + ((cy - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const to = Math.min(r.w - 1, Math.floor(xs[k + 1]! - 0.5));
      for (let x = from; x <= to; x++) inside[y * r.w + x] = 1;
    }
  }
  scaleAlpha(r, feather > 0 ? boxBlur(inside, r.w, r.h, feather) : inside);
}

/** Light figure on a dark ground: alpha follows luminance from `lo` (gone) to `hi` (opaque), lightly smoothed. */
export function applyLumaKey(r: Raster, [lo, hi]: [number, number]): void {
  const n = r.w * r.h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = (0.2126 * r.data[i * 4]! + 0.7152 * r.data[i * 4 + 1]! + 0.0722 * r.data[i * 4 + 2]!) / 255;
  const soft = boxBlur(lum, r.w, r.h, Math.max(1, Math.round(Math.max(r.w, r.h) / 900)));
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = smooth(lo, hi, soft[i]!);
  scaleAlpha(r, a);
}

/** Replaces the colour of every soft edge pixel with the colour bled outward from the solid interior, so the ground
 * the figure was cut from never tints its rim. Alpha is kept. */
export function defringe(r: Raster, solid = 230, passes = 4): void {
  const core = raster(r.w, r.h);
  for (let i = 0; i < r.w * r.h; i++) {
    if (r.data[i * 4 + 3]! < solid) continue;
    core.data.set([r.data[i * 4]!, r.data[i * 4 + 1]!, r.data[i * 4 + 2]!, 255], i * 4);
  }
  dilate(core, passes);
  for (let i = 0; i < r.w * r.h; i++) {
    const a = r.data[i * 4 + 3]!;
    if (a === 0 || a >= solid) continue;
    const c = i * 4;
    if (core.data[c]! + core.data[c + 1]! + core.data[c + 2]! === 0) continue;
    r.data.set([core.data[c]!, core.data[c + 1]!, core.data[c + 2]!], c);
  }
}

const fnoise = (x: number, y: number, seed: number): number => {
  let h = (x * 374761393 + y * 668265263 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** A dark animal on a green painted ground: the polygon only guides. Alpha follows how little green the pixel carries, with the threshold roughened by a little noise so
 * the rim reads as hand-cut fur, then the alpha is softened by a pixel. */
export function applyGuidedMatte(r: Raster, poly: Polygon, toLocal: (fx: number, fy: number) => [number, number], band: number): void {
  const cx = poly.reduce((m, p) => m + p[0], 0) / poly.length;
  const cy = poly.reduce((m, p) => m + p[1], 0) / poly.length;
  const mask = (k: number, blur: number): Float32Array => {
    const g = raster(r.w, r.h);
    for (let i = 3; i < g.data.length; i += 4) g.data[i] = 255;
    applyPolygon(g, poly.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as [number, number]), toLocal, 0);
    const m = new Float32Array(r.w * r.h);
    for (let i = 0; i < m.length; i++) m[i] = g.data[i * 4 + 3]! / 255;
    return boxBlur(m, r.w, r.h, blur);
  };
  const wide = mask(1.16, band);
  const core = mask(0.62, band);
  const a = new Float32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = y * r.w + x;
      const c = i * 4;
      const [R, G, B] = [r.data[c]! / 255, r.data[c + 1]! / 255, r.data[c + 2]! / 255];
      const n = (fnoise(x >> 1, y >> 1, 5) - 0.5) * 0.035 + (fnoise(x >> 3, y >> 3, 9) - 0.5) * 0.03;
      const green = smooth(0.075 + n, 0.025 + n, G - Math.max(R, B));
      a[i] = Math.max(core[i]! > 0.97 ? 1 : 0, green) * smooth(0.08, 0.4, wide[i]!);
    }
  }
  const closed = boxBlur(a, r.w, r.h, 2);
  for (let i = 0; i < a.length; i++) a[i] = smooth(0.35, 0.7, closed[i]!);
  scaleAlpha(r, boxBlur(a, r.w, r.h, 1));
}
