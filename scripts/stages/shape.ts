/// <reference types="node" />
// Geometry of sprite parts: crop by plate fractions, rotate, shear and mirror with premultiplied bilinear sampling,
// trim to alpha and fit a long side (downscale only, area-weighted), and the pivot helper.
import { crop, resample } from './lib/image.ts';
import { dilate as bleed, raster, type Raster } from './raster.ts';
import type { Box4 } from './recipe.ts';
import { alphaBounds } from './sprite.ts';

/** The part of a cut inside x0, y0, x1, y1 (plate fractions). */
export function cropPart(cut: Raster, b: Box4): Raster {
  const x0 = Math.max(0, Math.round(b[0] * cut.w));
  const y0 = Math.max(0, Math.round(b[1] * cut.h));
  const x1 = Math.min(cut.w, Math.round(b[2] * cut.w));
  const y1 = Math.min(cut.h, Math.round(b[3] * cut.h));
  return crop(cut, x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
}

/** Rotation (degrees, clockwise on screen), a small shear and squash ([shearX, squashY]) and a mirror, about the
 * centre, on a canvas grown to hold the result. */
export function transform(src: Raster, deg: number, warp: [number, number], flip: boolean): Raster {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const [sh, sq] = warp;
  const sy = 1 - sq;
  // Forward map: p' = R * S * p with S = [[1, sh], [0, sy]] (and the mirror before both).
  const m = [cos, cos * sh - sin * sy, sin, sin * sh + cos * sy];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [(u! * src.w) / 2, (v! * src.h) / 2]);
  const xs = corners.map(([x, y]) => m[0]! * x! + m[1]! * y!);
  const ys = corners.map(([x, y]) => m[2]! * x! + m[3]! * y!);
  const w = Math.ceil(Math.max(...xs) - Math.min(...xs)) + 2;
  const h = Math.ceil(Math.max(...ys) - Math.min(...ys)) + 2;
  const det = m[0]! * m[3]! - m[1]! * m[2]!;
  const inv = [m[3]! / det, -m[1]! / det, -m[2]! / det, m[0]! / det];
  const out = raster(w, h);
  const at = (x: number, y: number, c: number): number => (x < 0 || y < 0 || x >= src.w || y >= src.h ? 0 : src.data[(y * src.w + x) * 4 + c]!);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - w / 2;
      const dy = y + 0.5 - h / 2;
      let u = inv[0]! * dx + inv[1]! * dy + src.w / 2 - 0.5;
      const v = inv[2]! * dx + inv[3]! * dy + src.h / 2 - 0.5;
      if (flip) u = src.w - 1 - u;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const fx = u - x0;
      const fy = v - y0;
      let acc = 0;
      const rgb = [0, 0, 0];
      for (const [ox, oy, wt] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]] as const) {
        const al = at(x0 + ox, y0 + oy, 3) * wt;
        acc += al;
        for (let c = 0; c < 3; c++) rgb[c]! += at(x0 + ox, y0 + oy, c) * al;
      }
      if (acc <= 0) continue;
      out.data.set([Math.round(rgb[0]! / acc), Math.round(rgb[1]! / acc), Math.round(rgb[2]! / acc), Math.round(acc)], (y * w + x) * 4);
    }
  }
  return out;
}

/** Trims to the alpha bounds, scales down so the long side plus padding is at most `long`, pads and bleeds colour
 * into the transparent border so filtering never pulls in black. */
export function fitLong(part: Raster, long: number, pad: number): Raster {
  const [bx, by, bw, bh] = alphaBounds(part);
  const trimmed = crop(part, bx, by, bw, bh);
  const k = Math.min(1, (long - pad * 2) / Math.max(bw, bh));
  const scaled = k < 1 ? resample(trimmed, Math.max(1, Math.round(bw * k)), Math.max(1, Math.round(bh * k))) : trimmed;
  const out = raster(scaled.w + pad * 2, scaled.h + pad * 2);
  for (let y = 0; y < scaled.h; y++) out.data.set(scaled.data.subarray(y * scaled.w * 4, (y + 1) * scaled.w * 4), ((y + pad) * out.w + pad) * 4);
  bleed(out, pad + 2);
  return out;
}

/** X of the lowest well-opaque pixels (mean over the bottom 2 percent of the content): the foot or pedicel. */
export function lowestPoint(r: Raster): number {
  let bottom = -1;
  for (let y = r.h - 1; y >= 0 && bottom < 0; y--) for (let x = 0; x < r.w; x++) if (r.data[(y * r.w + x) * 4 + 3]! > 128) bottom = y;
  if (bottom < 0) return r.w / 2;
  const band = Math.max(1, Math.round(r.h * 0.02));
  let sx = 0;
  let n = 0;
  for (let y = bottom; y > bottom - band && y >= 0; y--) {
    for (let x = 0; x < r.w; x++) {
      if (r.data[(y * r.w + x) * 4 + 3]! <= 128) continue;
      sx += x;
      n++;
    }
  }
  return n > 0 ? sx / n + 0.5 : r.w / 2;
}
