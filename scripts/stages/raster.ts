/// <reference types="node" />
// RGBA8 rasters for the asset pipeline: PNG read and write (8-bit RGBA, non-interlaced, which is all the pipeline
// writes), premultiply, box downscale and blit. Build time only.
import { deflateSync, inflateSync } from 'node:zlib';

export interface Raster { w: number; h: number; data: Uint8Array /* RGBA8, top row first */ }

export const raster = (w: number, h: number): Raster => ({ w, h, data: new Uint8Array(w * h * 4) });

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

export function encodePng(r: Raster): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(r.w, 0);
  ihdr.writeUInt32BE(r.h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const stride = r.w * 4;
  const rows = Buffer.alloc((stride + 1) * r.h);
  for (let y = 0; y < r.h; y++) rows.set(r.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buf: Buffer): Raster {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let off = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error('only 8-bit RGBA non-interlaced PNG is supported');
    } else if (type === 'IDAT') idat.push(body);
    off += 12 + len;
  }
  const src = inflateSync(Buffer.concat(idat));
  const out = raster(w, h);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const filter = src[y * (stride + 1)] ?? 0;
    const row = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? (out.data[y * stride + x - 4] ?? 0) : 0;
      const b = y > 0 ? (out.data[(y - 1) * stride + x] ?? 0) : 0;
      const c = x >= 4 && y > 0 ? (out.data[(y - 1) * stride + x - 4] ?? 0) : 0;
      const v = src[row + x] ?? 0;
      const pred = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0;
      out.data[y * stride + x] = (v + pred) & 0xff;
    }
  }
  return out;
}

/** Bleeds the colour of opaque pixels into fully transparent ones (alpha stays 0), so mips and filtering of
 * straight-alpha pages never pull in black at cut edges. */
export function dilate(r: Raster, passes: number): void {
  const { w, h, data } = r;
  for (let p = 0; p < passes; p++) {
    const src = data.slice();
    const done = (i: number): boolean => (src[i * 4 + 3] ?? 0) > 0 || (src[i * 4] ?? 0) + (src[i * 4 + 1] ?? 0) + (src[i * 4 + 2] ?? 0) > 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (done(i)) continue;
        let n = 0;
        let rs = 0;
        let gs = 0;
        let bs = 0;
        for (let j = -1; j <= 1; j++) {
          for (let k = -1; k <= 1; k++) {
            const xx = x + k;
            const yy = y + j;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || !done(yy * w + xx)) continue;
            const q = (yy * w + xx) * 4;
            rs += src[q] ?? 0;
            gs += src[q + 1] ?? 0;
            bs += src[q + 2] ?? 0;
            n++;
          }
        }
        if (n > 0) data.set([Math.round(rs / n), Math.round(gs / n), Math.round(bs / n), 0], i * 4);
      }
    }
  }
}

/** Halves both sides with a 2x2 box filter (sides must be even). */
export function halve(r: Raster): Raster {
  const out = raster(r.w >> 1, r.h >> 1);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      for (let k = 0; k < 4; k++) {
        const s = (i: number, j: number): number => r.data[((y * 2 + j) * r.w + x * 2 + i) * 4 + k] ?? 0;
        out.data[(y * out.w + x) * 4 + k] = (s(0, 0) + s(1, 0) + s(0, 1) + s(1, 1) + 2) >> 2;
      }
    }
  }
  return out;
}

export function fill(r: Raster, rgba: readonly [number, number, number, number]): void {
  for (let i = 0; i < r.data.length; i += 4) r.data.set(rgba, i);
}

/** Copies src into dst at (dx, dy), top-left origin, no blending. */
export function blit(dst: Raster, src: Raster, dx: number, dy: number): void {
  for (let y = 0; y < src.h; y++) dst.data.set(src.data.subarray(y * src.w * 4, (y + 1) * src.w * 4), ((dy + y) * dst.w + dx) * 4);
}

/** Source-over composite of straight-alpha src into straight-alpha dst, scaled to a dw x dh box at (dx, dy) with a
 * 3x3 sample footprint per destination pixel; flip mirrors horizontally. */
export function drawScaled(dst: Raster, src: Raster, dx: number, dy: number, dw: number, dh: number, flip: boolean): void {
  const x0 = Math.max(0, Math.floor(dx));
  const y0 = Math.max(0, Math.floor(dy));
  const x1 = Math.min(dst.w, Math.ceil(dx + dw));
  const y1 = Math.min(dst.h, Math.ceil(dy + dh));
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) {
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < 3; j++) {
        for (let k = 0; k < 3; k++) {
          const u = (tx + (k + 0.5) / 3 - dx) / dw;
          const v = (ty + (j + 0.5) / 3 - dy) / dh;
          if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
          const sx = Math.floor((flip ? 1 - u : u) * src.w);
          const s = (Math.floor(v * src.h) * src.w + Math.min(src.w - 1, sx)) * 4;
          const sa = (src.data[s + 3] ?? 0) / 255;
          a += sa;
          r += (src.data[s] ?? 0) * sa;
          g += (src.data[s + 1] ?? 0) * sa;
          b += (src.data[s + 2] ?? 0) * sa;
        }
      }
      if (a === 0) continue;
      const sa = a / 9;
      const d = (ty * dst.w + tx) * 4;
      const da = (dst.data[d + 3] ?? 0) / 255;
      const oa = sa + da * (1 - sa);
      const mix = (c: number, k: number): number => Math.round(((c / a) * sa + (dst.data[d + k] ?? 0) * da * (1 - sa)) / oa);
      dst.data.set([mix(r, 0), mix(g, 1), mix(b, 2), Math.round(oa * 255)], d);
    }
  }
}
