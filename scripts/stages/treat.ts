/// <reference types="node" />
// Treatments applied to a cut part at build time (cook/ART.md treatment codes): painted-out parts, the hand-tint
// re-tint toward the palette (a soft, hue-selected gradient map in OKLab that keeps the plate's own value
// structure, so it reads as a wash and never as a flat overlay), INK (line as alpha plus one wash), MASK (flat
// silhouette) and the 1 px cut-paper rim of PK. All functions work in place on straight-alpha RGBA8.
import { toLinear, toSrgb8 } from './lib/color.ts';
import { components, dilate, erode, mask, type Mask } from './lib/morph.ts';
import { raster, type Raster } from './raster.ts';
import { hexRgb, type HueSel, type Removal, type Tint } from './recipe.ts';

type Lab = [number, number, number];

function rgbToLab(r8: number, g8: number, b8: number): Lab {
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function labToRgb(L: number, A: number, B: number): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    toSrgb8(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb8(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb8(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const hexLab = (hex: string): Lab => rgbToLab(...hexRgb(hex));
const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Soft membership of an OKLab colour in a hue family (0..1). */
function hueWeight(sel: HueSel, [L, a, b]: Lab): number {
  const c = Math.hypot(a, b);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  switch (sel) {
    case 'all': return 1;
    // Rose reds and pinks: hue about -40 to 50 degrees with some chroma; greens and greys stay out.
    case 'pink': return smooth(0.02, 0.05, c) * smooth(-60, -30, h) * (1 - smooth(45, 75, h));
    case 'green': return smooth(0.015, 0.04, c) * smooth(95, 120, h) * (1 - smooth(200, 230, h));
    case 'warm': return smooth(0.02, 0.05, c) * smooth(-40, -10, h) * (1 - smooth(95, 120, h));
    case 'pale': return smooth(0.62, 0.8, L) * (1 - smooth(0.05, 0.1, c));
  }
}

/** Re-tints the selected pixels toward the palette: a gradient map over the region's own value range (or a pull
 * toward one hue), blended by `amount` and mixed so the plate's light and dark stay where the painter put them. */
export function applyTint(r: Raster, t: Tint): void {
  const n = r.w * r.h;
  const sel = t.hue ?? 'all';
  const amount = t.amount ?? 0.6;
  const labs = new Float32Array(n * 3);
  const wts = new Float32Array(n);
  const Ls: number[] = [];
  for (let i = 0; i < n; i++) {
    if (r.data[i * 4 + 3]! === 0) continue;
    const lab = rgbToLab(r.data[i * 4]!, r.data[i * 4 + 1]!, r.data[i * 4 + 2]!);
    labs.set(lab, i * 3);
    wts[i] = hueWeight(sel, lab);
    if (wts[i]! > 0.5) Ls.push(lab[0]);
  }
  if (Ls.length === 0) return;
  Ls.sort((x, y) => x - y);
  const lo = Ls[Math.floor(Ls.length * 0.04)]!;
  const hi = Ls[Math.floor(Ls.length * 0.96)]!;
  const ramp = t.gm?.map(hexLab);
  const toward = t.toward === undefined ? null : hexLab(t.toward);
  for (let i = 0; i < n; i++) {
    const w = wts[i]! * amount;
    if (w <= 0 || r.data[i * 4 + 3]! === 0) continue;
    let L = labs[i * 3]!;
    let A = labs[i * 3 + 1]!;
    let B = labs[i * 3 + 2]!;
    if (ramp !== undefined) {
      const x = Math.min(1, Math.max(0, (L - lo) / Math.max(1e-3, hi - lo)));
      const [p, q, k] = x < 0.5 ? [ramp[0]!, ramp[1]!, x * 2] : [ramp[1]!, ramp[2]!, (x - 0.5) * 2];
      const gl = p[0] + (q[0] - p[0]) * k;
      // Value: half toward the ramp, so the wash darkens or lifts without flattening the drawing.
      L += (gl - L) * w * (t.value ?? 0.5);
      A += (p[1] + (q[1] - p[1]) * k - A) * w;
      B += (p[2] + (q[2] - p[2]) * k - B) * w;
    }
    if (toward !== null) {
      const c = Math.hypot(A, B);
      const tc = Math.hypot(toward[1], toward[2]);
      const k = tc > 1e-4 ? Math.max(c, tc * 0.6) / tc : 0;
      A += (toward[1] * k - A) * w;
      B += (toward[2] * k - B) * w;
      L += (toward[0] - L) * w * 0.3;
    }
    const [rr, gg, bb] = labToRgb(L, A, B);
    r.data.set([rr, gg, bb], i * 4);
  }
  if (t.sat !== undefined) capSaturation(r, t.sat, wts);
}

/** Ceiling on HSL saturation for the selected pixels (weights 0..1). */
function capSaturation(r: Raster, max: number, wts: Float32Array): void {
  for (let i = 0; i < r.w * r.h; i++) {
    if (wts[i]! <= 0 || r.data[i * 4 + 3]! === 0) continue;
    const c = [r.data[i * 4]! / 255, r.data[i * 4 + 1]! / 255, r.data[i * 4 + 2]! / 255];
    const mx = Math.max(...c);
    const mn = Math.min(...c);
    const l = (mx + mn) / 2;
    const d = mx - mn;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (s <= max) continue;
    const k = 1 - (1 - max / s) * wts[i]!;
    for (let ch = 0; ch < 3; ch++) r.data[i * 4 + ch] = Math.round((l + (c[ch]! - l) * k) * 255);
  }
}

/** Painted-out parts: clears a box (or only its non-green pixels), then drops pieces the cut left floating. */
export function applyRemovals(r: Raster, removals: readonly Removal[], toLocal: (x: number, y: number) => [number, number]): void {
  if (removals.length === 0) return;
  for (const rm of removals) {
    const [x0, y0] = toLocal(rm.box[0], rm.box[1]);
    const [x1, y1] = toLocal(rm.box[2], rm.box[3]);
    if (rm.clone !== undefined) cloneBox(r, x0, y0, x1, y1, toLocal(rm.box[0] + rm.clone[0], rm.box[1] + rm.clone[1]));
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(r.h, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(r.w, Math.ceil(x1)); x++) {
        const i = (y * r.w + x) * 4;
        if (r.data[i + 3]! === 0) continue;
        if (rm.clone !== undefined) continue;
        if (rm.arch === true) {
          const rx = (x1 - x0) / 2;
          const ry = Math.min(rx, (y1 - y0) / 2);
          const dx = (x - (x0 + rx)) / rx;
          const dy = (y - (y0 + ry)) / ry;
          if (y < y0 + ry && dx * dx + dy * dy > 1) continue;
        }
        if (rm.fill !== undefined) {
          const f = hexRgb(rm.fill);
          const lum = (0.2126 * r.data[i]! + 0.7152 * r.data[i + 1]! + 0.0722 * r.data[i + 2]!) / 255;
          for (let c = 0; c < 3; c++) r.data[i + c] = Math.round(Math.min(255, f[c]! * (0.8 + 0.4 * lum)));
          continue;
        }
        const green = rm.keep === undefined ? false : hueWeight('green', rgbToLab(r.data[i]!, r.data[i + 1]!, r.data[i + 2]!)) > 0.35;
        if ((rm.keep === 'green' && green) || (rm.keep === 'nongreen' && !green)) continue;
        r.data[i + 3] = 0;
      }
    }
  }
  keepLargest(r, 0.02);
}

/** Copies the plate's own texture over a box from a box offset beside it, feathered over 12 px at the sides. */
function cloneBox(r: Raster, x0: number, y0: number, x1: number, y1: number, from: [number, number]): void {
  const dx = Math.round(from[0] - x0);
  const dy = Math.round(from[1] - y0);
  const feather = 12;
  const src = r.data.slice();
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(r.h, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(r.w, Math.ceil(x1)); x++) {
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= r.w || sy >= r.h) continue;
      const k = Math.min(1, (x - x0) / feather, (x1 - x) / feather, (y - y0) / feather);
      const i = (y * r.w + x) * 4;
      const j = (sy * r.w + sx) * 4;
      for (let c = 0; c < 4; c++) r.data[i + c] = Math.round(src[i + c]! + (src[j + c]! - src[i + c]!) * k);
    }
  }
}

/** Drops every part the crop box cuts through: stems thinner than 2r are severed by an opening, parts that then
 * touch the border go, and the kept parts get their own thin stems and soft edge back. */
export function keepWhole(r: Raster, rad: number): void {
  const solid = alphaMask(r, 96);
  const opened = dilate(erode(solid, rad), rad);
  const c = components(r.w, r.h, (i) => opened.m[i] === 1);
  const kept = mask(r.w, r.h);
  for (let i = 0; i < r.w * r.h; i++) kept.m[i] = c.labels[i]! > 0 && !c.touchesBorder[c.labels[i]!] ? 1 : 0;
  // Thin parts (petioles, tendrils) that hang off a kept part come back, never ones that reach the border.
  const thin = components(r.w, r.h, (i) => solid.m[i] === 1 && opened.m[i] === 0);
  const nearKept = dilate(kept, 2);
  const back = new Uint8Array(thin.count + 1);
  for (let i = 0; i < r.w * r.h; i++) if (thin.labels[i]! > 0 && nearKept.m[i] === 1 && !thin.touchesBorder[thin.labels[i]!]) back[thin.labels[i]!] = 1;
  for (let i = 0; i < r.w * r.h; i++) if (back[thin.labels[i]!] === 1) kept.m[i] = 1;
  const near = dilate(kept, 2);
  for (let i = 0; i < r.w * r.h; i++) if (near.m[i] === 0) r.data[i * 4 + 3] = 0;
}

/** Keeps the largest connected part and every part at least `share` of it. */
export function keepLargest(r: Raster, share: number): void {
  const c = components(r.w, r.h, (i) => r.data[i * 4 + 3]! > 24);
  let big = 0;
  for (let k = 1; k <= c.count; k++) big = Math.max(big, c.area[k]!);
  const keep = new Uint8Array(c.count + 1);
  for (let k = 1; k <= c.count; k++) keep[k] = c.area[k]! >= big * share ? 1 : 0;
  // Faint pixels around a kept part stay with it (the soft edge); faint pixels alone go.
  const solid = mask(r.w, r.h);
  for (let i = 0; i < r.w * r.h; i++) solid.m[i] = keep[c.labels[i]!]!;
  const near = dilate(solid, 2);
  for (let i = 0; i < r.w * r.h; i++) if (near.m[i] === 0) r.data[i * 4 + 3] = 0;
}

const alphaMask = (r: Raster, min = 128): Mask => {
  const m = mask(r.w, r.h);
  for (let i = 0; i < r.w * r.h; i++) m.m[i] = r.data[i * 4 + 3]! >= min ? 1 : 0;
  return m;
};

/** INK: the engraved line becomes the alpha in one line colour; the closed silhouette carries one flat wash. */
export function applyInk(r: Raster, o: { line: string; wash: string; washAlpha: number }, minExtent = 0): Raster {
  const line = hexRgb(o.line);
  const wash = hexRgb(o.wash);
  const n = r.w * r.h;
  const side = Math.max(r.w, r.h);
  if (minExtent > 0) {
    const c = components(r.w, r.h, (i) => r.data[i * 4 + 3]! > 64);
    for (let i = 0; i < n; i++) {
      const b = c.box[c.labels[i]!];
      if (b !== undefined && c.labels[i]! > 0 && Math.max(b[2] - b[0], b[3] - b[1]) < side * minExtent) r.data[i * 4 + 3] = 0;
    }
  }
  const ink = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lum = (0.2126 * r.data[i * 4]! + 0.7152 * r.data[i * 4 + 1]! + 0.0722 * r.data[i * 4 + 2]!) / 255;
    ink[i] = (r.data[i * 4 + 3]! / 255) * smooth(0.95, 0.35, lum);
  }
  // The wash lies where the engraver's lines are dense (a hedge mass, a timber), never over open paper or a vista.
  const density = boxBlur(ink, r.w, r.h, Math.max(2, Math.round(side / 120)));
  const out = raster(r.w, r.h);
  for (let i = 0; i < n; i++) {
    const wa = smooth(0.12, 0.3, density[i]!) * o.washAlpha;
    const k = ink[i]!;
    const oa = k + wa * (1 - k);
    if (oa <= 0) continue;
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round((line[c]! * k + wash[c]! * wa * (1 - k)) / oa);
    out.data[i * 4 + 3] = Math.round(oa * 255);
  }
  return out;
}

/** MASK: a flat silhouette of the cut (gaps between hatching closed), softened by a baked blur. */
export function applyMask(r: Raster, o: { color: string; blur: number; luma?: [number, number]; close?: number }): Raster {
  const side = Math.max(r.w, r.h);
  const a = new Float32Array(r.w * r.h);
  if (o.luma !== undefined) {
    // Dark masses off a light sky: alpha from luminance (blurred a little so hatching reads as one mass).
    const lum = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) lum[i] = (0.2126 * r.data[i * 4]! + 0.7152 * r.data[i * 4 + 1]! + 0.0722 * r.data[i * 4 + 2]!) / 255;
    const soft = boxBlur(lum, r.w, r.h, Math.max(1, Math.round(side / 400)));
    for (let i = 0; i < a.length; i++) a[i] = smooth(o.luma[1], o.luma[0], soft[i]!) * (r.data[i * 4 + 3]! / 255);
    if (o.close !== undefined) {
      // Light flecks inside a mass (sunlit leaves, hatching gaps) close up; the outline keeps its own shape.
      const m = mask(r.w, r.h);
      for (let i = 0; i < a.length; i++) m.m[i] = a[i]! > 0.5 ? 1 : 0;
      const closed = erode(dilate(m, o.close), o.close);
      for (let i = 0; i < a.length; i++) if (closed.m[i] === 1) a[i] = 1;
    }
  } else {
    const shape = erode(dilate(alphaMask(r, 60), side / 160), side / 160);
    for (let i = 0; i < a.length; i++) a[i] = shape.m[i]!;
  }
  const soft = boxBlur(a, r.w, r.h, Math.max(1, Math.round(o.blur)));
  const [cr, cg, cb] = hexRgb(o.color);
  const out = raster(r.w, r.h);
  for (let i = 0; i < a.length; i++) out.data.set([cr, cg, cb, Math.round(soft[i]! * 255)], i * 4);
  return out;
}

/** Three-pass box blur with clamped edges (close to a Gaussian of sigma about r). */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  let a = src.slice();
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[y * w + Math.min(w - 1, Math.max(0, k))]!;
      for (let x = 0; x < w; x++) {
        b[y * w + x] = s / (2 * r + 1);
        s += a[y * w + Math.min(w - 1, x + r + 1)]! - a[y * w + Math.max(0, x - r)]!;
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += b[Math.min(h - 1, Math.max(0, k)) * w + x]!;
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / (2 * r + 1);
        s += b[Math.min(h - 1, y + r + 1) * w + x]! - b[Math.max(0, y - r) * w + x]!;
      }
    }
    a = a.slice();
  }
  return a;
}

/** PK: an even 1 px cut-paper edge, a light step toward warm paper on the outermost opaque pixels only. */
export function applyPaperRim(r: Raster, strength = 0.35): void {
  const paper = [233, 220, 196];
  const inside = alphaMask(r, 160);
  const core = erode(inside, 1);
  for (let i = 0; i < r.w * r.h; i++) {
    if (inside.m[i] === 0 || core.m[i] === 1) continue;
    for (let c = 0; c < 3; c++) r.data[i * 4 + c] = Math.round(r.data[i * 4 + c]! + (paper[c]! - r.data[i * 4 + c]!) * strength);
  }
}
