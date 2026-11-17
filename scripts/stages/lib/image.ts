/// <reference types="node" />
// Image io and resampling for the real image stages. Decoding of archive JPEG/TIFF/PNG goes through the system
// ImageMagick (`magick`, build time only, logged in cook/ROUNDS.md); everything after decode is plain TypeScript.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { raster, type Raster } from '../raster.ts';

const MAX_BUFFER = 1 << 30;

/** Pixel size of an image file without decoding it. */
export function imageSize(path: string): [number, number] {
  const out = execFileSync('magick', ['identify', '-format', '%w %h\n', `${path}[0]`], { encoding: 'utf8' });
  const [w, h] = (out.split('\n')[0] ?? '').split(' ').map(Number);
  if (!w || !h) throw new Error(`${path}: cannot read size`);
  return [w, h];
}

/** Decodes any image to straight-alpha RGBA8 in sRGB, first frame only, scaled down (never up) so the long side is
 * at most maxSide. Embedded colour profiles are converted to sRGB. */
export function readImage(path: string, maxSide: number): Raster {
  const [w0, h0] = imageSize(path);
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));
  const args = [`${path}[0]`, '-auto-orient', '-colorspace', 'sRGB', '-alpha', 'set'];
  if (k < 1) args.push('-filter', 'Triangle', '-resize', `${w}x${h}!`);
  args.push('-depth', '8', 'rgba:-');
  const buf = execFileSync('magick', args, { maxBuffer: MAX_BUFFER });
  if (buf.length !== w * h * 4) throw new Error(`${path}: decoded ${buf.length} bytes, expected ${w * h * 4}`);
  const r = raster(w, h);
  r.data.set(buf);
  return r;
}

/** Writes a raster with ImageMagick (fast zlib, keeps the alpha channel); format follows the extension. */
export function writeImage(path: string, r: Raster, extra: readonly string[] = []): void {
  mkdirSync(dirname(path), { recursive: true });
  execFileSync('magick', ['-size', `${r.w}x${r.h}`, '-depth', '8', 'rgba:-', ...extra, path], { input: r.data, maxBuffer: MAX_BUFFER });
}

/** Area-weighted resample with premultiplied alpha (no ringing, no dark fringes): every destination pixel averages
 * the exact source footprint it covers. For downscaling; upscaling falls back to the nearest footprint. */
export function resample(src: Raster, w: number, h: number): Raster {
  const out = raster(w, h);
  const sx = src.w / w;
  const sy = src.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy;
    const y1 = Math.max(y0 + 1e-6, (y + 1) * sy);
    for (let x = 0; x < w; x++) {
      const x0 = x * sx;
      const x1 = Math.max(x0 + 1e-6, (x + 1) * sx);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let j = Math.floor(y0); j < Math.min(src.h, Math.ceil(y1)); j++) {
        const wy = Math.min(y1, j + 1) - Math.max(y0, j);
        for (let i = Math.floor(x0); i < Math.min(src.w, Math.ceil(x1)); i++) {
          const wgt = (Math.min(x1, i + 1) - Math.max(x0, i)) * wy;
          const s = (j * src.w + i) * 4;
          const sa = src.data[s + 3]! * wgt;
          r += src.data[s]! * sa;
          g += src.data[s + 1]! * sa;
          b += src.data[s + 2]! * sa;
          a += sa;
          area += wgt;
        }
      }
      const d = (y * w + x) * 4;
      if (a > 0) {
        out.data[d] = Math.round(r / a);
        out.data[d + 1] = Math.round(g / a);
        out.data[d + 2] = Math.round(b / a);
      }
      out.data[d + 3] = Math.round(a / area);
    }
  }
  return out;
}

/** Copies the w x h rectangle at (x, y) out of src. */
export function crop(src: Raster, x: number, y: number, w: number, h: number): Raster {
  const out = raster(w, h);
  for (let j = 0; j < h; j++) out.data.set(src.data.subarray(((y + j) * src.w + x) * 4, ((y + j) * src.w + x + w) * 4), j * w * 4);
  return out;
}
