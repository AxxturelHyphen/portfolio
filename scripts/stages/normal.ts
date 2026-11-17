/// <reference types="node" />
// Normal stage: a tangent-space normal map in sprite space (x right, y up; rgb = n * 0.5 + 0.5, a = 255) that
// reads as pressed paper, never plastic. Height = an edge bevel from the exact distance to the silhouette (every
// cutout gets a slightly lifted, rounded edge, the paper's thickness) plus fine relief from high-passed luminance
// (ink and engraving lines, paper tooth). Large flat colour areas stay flat because the luminance term carries no
// low frequencies. Outside the cutout the normal is flat (128, 128, 255).
import { distanceTo } from './lib/morph.ts';
import { raster, type Raster } from './raster.ts';

/** Exact Euclidean distance in px from every inside pixel (alpha >= 128) to the nearest outside pixel; 0 outside. */
export function edgeDistance(r: Raster): Float32Array {
  return distanceTo(r.w, r.h, (i) => r.data[i * 4 + 3]! < 128, true);
}

export interface NormalOptions {
  /** Width of the lifted edge, px. */
  bevelPx: number;
  /** Weight of the luminance relief against the bevel (bevel height is 1). */
  lumaHeight: number;
  /** Slope gain: higher tilts the bevel and the relief more. */
  strength: number;
  /** Radius of the luminance high-pass, px: detail finer than this becomes relief. */
  detailPx?: number;
}

/** Tuned on real plates at the 'l' size class: a 5 px rounded edge, faint line relief. */
export const NORMAL_DEFAULTS: NormalOptions = { bevelPx: 5, lumaHeight: 0.35, strength: 2.2, detailPx: 3 };

/** Luminance detail beyond this is clipped: strong painted markings (black spots on a white wing) must not
 * emboss into steps; only line work and paper tooth carry relief. */
const RELIEF_CLAMP = 0.06;

/** Separable box blur, radius r, two passes (close to a Gaussian). */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const a = src.slice();
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= w) continue;
          s += a[y * w + xx]!;
          n++;
        }
        b[y * w + x] = s / n;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= h) continue;
          s += b[yy * w + x]!;
          n++;
        }
        a[y * w + x] = s / n;
      }
    }
  }
  return a;
}

export function normalMap(r: Raster, o: NormalOptions): Raster {
  const { w, h } = r;
  const n = w * h;
  const dist = edgeDistance(r);
  const luma = new Float32Array(n);
  for (let i = 0; i < n; i++) luma[i] = Math.sqrt((0.2126 * r.data[i * 4]! + 0.7152 * r.data[i * 4 + 1]! + 0.0722 * r.data[i * 4 + 2]!) / 255);
  const low = blur(luma, w, h, Math.max(1, Math.round(o.detailPx ?? 3)));
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = r.data[i * 4 + 3]! / 255;
    const d = dist[i]! > 0 ? dist[i]! : a * 0.5;
    const t = Math.min(1, d / o.bevelPx);
    const bevel = 1 - (1 - t) * (1 - t);
    const detail = Math.max(-RELIEF_CLAMP, Math.min(RELIEF_CLAMP, luma[i]! - low[i]!));
    height[i] = bevel + o.lumaHeight * detail * Math.min(1, a * 2);
  }
  const hAt = (x: number, y: number): number => height[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  const out = raster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (r.data[i * 4 + 3] === 0) {
        out.data.set([128, 128, 255, 255], i * 4);
        continue;
      }
      const nx = -(hAt(x + 1, y) - hAt(x - 1, y)) * 0.5 * o.strength;
      const ny = (hAt(x, y + 1) - hAt(x, y - 1)) * 0.5 * o.strength;
      const len = Math.hypot(nx, ny, 1);
      out.data.set([Math.round((nx / len) * 127.5 + 127.5), Math.round((ny / len) * 127.5 + 127.5), Math.round((1 / len) * 255), 255], i * 4);
    }
  }
  return out;
}
