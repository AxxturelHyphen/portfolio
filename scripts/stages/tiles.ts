/// <reference types="node" />
// Ground and wall textures through the plate pass (cook/ART.md "Plate pass"): luminance to 5 soft tone steps, a
// 1 bit engraver's line screen at 3 angles by tone (integer frequencies across the tile, so it still repeats), line
// contrast 22 percent, a gradient map to the place palette with the tint slipped 2 px off the line. The CC0 photo's
// own normal map is kept for relighting. Flagstones: single stones segmented along the dark joints of the path
// photo, each through the same pass with a soft cut edge.
import { readImage } from './lib/image.ts';
import { components, erode, fillHoles, mask, open } from './lib/morph.ts';
import { raster, type Raster } from './raster.ts';
import { hexRgb, type FlagJob, type TileJob } from './recipe.ts';
import { boxBlur } from './treat.ts';

export const LINE_CONTRAST = 0.22;
/** Engraver's angles in degrees: a cross-hatch pair and a third for the darkest tone. */
export const ANGLES = [22, 112, 67];
export const SLIP = 2;

export const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Luminance normalised to the 2nd and 98th percentile. */
function lumaOf(r: Raster): Float32Array {
  const n = r.w * r.h;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = (0.2126 * r.data[i * 4]! + 0.7152 * r.data[i * 4 + 1]! + 0.0722 * r.data[i * 4 + 2]!) / 255;
  const sorted = Float32Array.from(y).sort();
  const lo = sorted[Math.floor(n * 0.02)]!;
  const hi = sorted[Math.floor(n * 0.98)]!;
  for (let i = 0; i < n; i++) y[i] = Math.min(1, Math.max(0, (y[i]! - lo) / Math.max(1e-3, hi - lo)));
  return y;
}

/** Five soft tone steps: flat plateaus joined by short ramps, the aquatint's bitten tones. */
export const toneStep = (x: number): number => {
  const v = x * 4;
  const i = Math.min(3, Math.floor(v));
  return (i + smooth(0.3, 0.7, v - i)) / 4;
};

/** 1 bit line of one screen at (x, y): integer frequencies (kx, ky) across a w x h tile, duty 0.42, 0.6 px AA. */
export function lineAt(x: number, y: number, w: number, h: number, kx: number, ky: number, pitch: number): number {
  const ph = (x * kx) / w + (y * ky) / h;
  const f = ph - Math.floor(ph);
  const d = Math.abs(f - 0.21) * pitch;
  return smooth(0.21 * pitch + 0.6, 0.21 * pitch - 0.6, d);
}

export function gradient(stops: readonly (readonly [number, number, number])[], t: number): [number, number, number] {
  const [a, b, k] = t < 0.5 ? [stops[0]!, stops[1]!, t * 2] : [stops[1]!, stops[2]!, (t - 0.5) * 2];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** The plate pass on a raster (wrap-around sampling when `wrap`, for tiles). */
export function platePass(src: Raster, gm: [string, string, string], pitchPx: number, wrap: boolean, soften = 0): Raster {
  const { w, h } = src;
  const tone = lumaOf(src);
  const soft = boxBlur(tone, w, h, Math.max(1, Math.round(pitchPx / 2) + soften));
  const stops = gm.map(hexRgb);
  const screens = ANGLES.map((deg) => {
    const k = Math.max(1, Math.round(Math.max(w, h) / pitchPx));
    const a = (deg * Math.PI) / 180;
    return [Math.round(k * Math.cos(a)), Math.round(k * Math.sin(a))] as const;
  });
  const out = raster(w, h);
  const at = (x: number, y: number): number => {
    const xx = wrap ? (x + w) % w : Math.min(w - 1, Math.max(0, x));
    const yy = wrap ? (y + h) % h : Math.min(h - 1, Math.max(0, y));
    return toneStep(soft[yy * w + xx]!);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = at(x, y);
      let ink = 0;
      for (let s = 0; s < 3; s++) {
        const cover = smooth(0.78 - s * 0.25, 0.62 - s * 0.25, t);
        if (cover > 0) ink = Math.max(ink, cover * lineAt(x, y, w, h, screens[s]![0], screens[s]![1], pitchPx));
      }
      const v = t * (1 - LINE_CONTRAST * ink);
      const base = gradient(stops, v);
      const slip = gradient(stops, at(x + SLIP, y + 1));
      // Value from the aligned line image, hue from the slipped tint: the colour plate sits 2 px off the key plate.
      const lb = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
      const ls = 0.2126 * slip[0] + 0.7152 * slip[1] + 0.0722 * slip[2];
      const k = ls > 1 ? lb / ls : 1;
      for (let c = 0; c < 3; c++) out.data[(y * w + x) * 4 + c] = Math.round(Math.min(255, base[c]! * 0.6 + slip[c]! * k * 0.4));
      out.data[(y * w + x) * 4 + 3] = 255;
    }
  }
  return out;
}

const pitchPx = (mm: number, size: number, metres: number): number => Math.max(3, (mm / 1000) * (size / metres));

function stockGrade(src: Raster, gm: [string, string, string]): Raster {
  const tone = lumaOf(src);
  const stops = gm.map(hexRgb);
  const out = raster(src.w, src.h);
  for (let i = 0; i < src.w * src.h; i++) out.data.set([...gradient(stops, tone[i]!).map(Math.round), 255], i * 4);
  return out;
}

export function buildTile(t: TileJob, file: string): { color: Raster; normal: Raster } {
  const src = readImage(file, t.size);
  const color = t.stock === true ? stockGrade(src, t.gm) : platePass(src, t.gm, pitchPx(t.pitchMm, t.size, t.metres), true, t.soft ?? 0);
  const normal = t.normalFile !== undefined ? readImage(t.normalFile, t.size) : flatNormal(t.size);
  return { color, normal };
}

function flatNormal(size: number): Raster {
  const r = raster(size, size);
  for (let i = 0; i < size * size; i++) r.data.set([128, 128, 255, 255], i * 4);
  return r;
}

/** Stones of a path photo: bright, low-chroma, flat (normal z high) regions split by the joints. */
function stoneMask(src: Raster, nor: Raster): { labels: Int32Array; boxes: [number, number, number, number][]; picks: number[] } {
  const { w, h } = src;
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = (0.2126 * src.data[i * 4]! + 0.7152 * src.data[i * 4 + 1]! + 0.0722 * src.data[i * 4 + 2]!) / 255;
  const local = boxBlur(lum, w, h, Math.round(w / 40));
  const fine = boxBlur(lum, w, h, 2);
  const m = mask(w, h);
  for (let i = 0; i < n; i++) {
    const r = src.data[i * 4]!;
    const g = src.data[i * 4 + 1]!;
    const b = src.data[i * 4 + 2]!;
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    const nz = nor.data[i * 4 + 2]! / 127.5 - 1;
    m.m[i] = fine[i]! > local[i]! * 0.86 && chroma < 0.12 && nz > 0.82 ? 1 : 0;
  }
  const opened = open(m, Math.max(3, w / 300));
  // Lichen spots and pits inside a stone are part of it, never holes in the cut.
  fillHoles(opened, new Float32Array(n), (area) => area < (w * h) / 600);
  const c = components(w, h, (i) => opened.m[i] === 1);
  const cand: { k: number; score: number }[] = [];
  for (let k = 1; k <= c.count; k++) {
    if (c.touchesBorder[k]) continue;
    const [x0, y0, x1, y1] = c.box[k]!;
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const fillRatio = c.area[k]! / (bw * bh);
    const aspect = Math.max(bw, bh) / Math.min(bw, bh);
    if (c.area[k]! < (w * h) / 300 || fillRatio < 0.66 || aspect > 1.8) continue;
    cand.push({ k, score: c.area[k]! * fillRatio });
  }
  cand.sort((a, b) => b.score - a.score);
  return { labels: c.labels, boxes: c.box, picks: cand.map((x) => x.k) };
}

/** A stone reads as one mass under the line screen: lichen and pits are softened and the value range narrowed. */
function calm(src: Raster): Raster {
  const lum = lumaOf(src);
  const low = boxBlur(lum, src.w, src.h, Math.round(src.w / 256));
  const out = raster(src.w, src.h);
  for (let i = 0; i < src.w * src.h; i++) {
    const v = Math.round(Math.min(1, Math.max(0, 0.5 + (low[i]! * 0.7 + lum[i]! * 0.3 - 0.5) * 0.6)) * 255);
    out.data.set([v, v, v, 255], i * 4);
  }
  return out;
}

export function buildFlags(f: FlagJob, file: string): { color: Raster; normal: Raster; size: [number, number] }[] {
  const src = readImage(file, 2048);
  const nor = readImage(file.replace('_diff_', '_nor_'), 2048);
  const passed = platePass(calm(src), f.gm, pitchPx(f.pitchMm, src.w, f.metres), true);
  const { labels, boxes, picks } = stoneMask(src, nor);
  if (picks.length < f.count) throw new Error(`flags: only ${picks.length} clean stones found in ${file}, need ${f.count}`);
  const mpp = f.metres / src.w;
  return picks.slice(0, f.count).map((k) => {
    const [x0, y0, x1, y1] = boxes[k]!;
    const pad = 6;
    const bw = x1 - x0 + 1 + pad * 2;
    const bh = y1 - y0 + 1 + pad * 2;
    const own = mask(bw, bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) own.m[y * bw + x] = labels[(y0 - pad + y) * src.w + x0 - pad + x] === k ? 1 : 0;
    // A cut stone has a calm outline: the joint mask is smoothed (blur and re-threshold), then a 1 px soft edge.
    const smoothEdge = boxBlur(Float32Array.from(erode(own, 2).m), bw, bh, 6);
    const a = boxBlur(smoothEdge.map((v) => smooth(0.42, 0.58, v)), bw, bh, 1);
    const scale = Math.min(1, (f.size - 8) / Math.max(bw, bh));
    const ow = Math.round(bw * scale);
    const oh = Math.round(bh * scale);
    const color = raster(ow, oh);
    const normal = raster(ow, oh);
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const sx = Math.min(bw - 1, Math.floor(x / scale));
        const sy = Math.min(bh - 1, Math.floor(y / scale));
        const si = ((y0 - pad + sy) * src.w + x0 - pad + sx) * 4;
        const o = (y * ow + x) * 4;
        color.data.set(passed.data.subarray(si, si + 3), o);
        color.data[o + 3] = Math.round(a[sy * bw + sx]! * 255);
        normal.data.set(nor.data.subarray(si, si + 3), o);
        normal.data[o + 3] = 255;
      }
    }
    return { color, normal, size: [+(bw * mpp).toFixed(4), +(bh * mpp).toFixed(4)] };
  });
}
