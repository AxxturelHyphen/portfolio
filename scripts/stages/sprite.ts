/// <reference types="node" />
// Sprite stage: a cut plate to sprites. Multi-specimen plates split into one part per specimen (connected
// components, grouped when close), each part trimmed to its alpha bounds, padded and resized to the size class a
// slot asks for, with colour bled into the transparent border so mips and filtering never pull in black.
import { crop, resample } from './lib/image.ts';
import { components, dilate, mask } from './lib/morph.ts';
import { dilate as bleed, raster, type Raster } from './raster.ts';

/** Long side in px of each size class (at PX_PER_UNIT 128 a 'm' sprite is 4 world units at scale 1). */
export const SIZE_CLASS = { xs: 128, s: 256, m: 512, l: 1024 } as const;
export type SizeClass = keyof typeof SIZE_CLASS;

/** Transparent border kept around every sprite, px at the output size. */
export const SPRITE_PAD = 4;

export interface SpritePart { image: Raster; box: [number, number, number, number] /* x, y, w, h in the cut */; area: number }

export interface SplitOptions {
  /** Components closer than this share of the long side belong to one specimen (antennae, detached petals). */
  gap: number;
  /** Groups smaller than this share of the largest group are specks and dropped. */
  minShare: number;
}

/** Components under this many px are specks of texture, never a specimen or part of one. */
const MIN_SPECK = 8;

export const SPLIT_DEFAULTS: SplitOptions = { gap: 0.008, minShare: 0.03 };

/** Splits a cut plate into specimens, in reading order (rows top to bottom, then left to right). */
export function splitSprites(cut: Raster, o: SplitOptions = SPLIT_DEFAULTS): SpritePart[] {
  const { w, h } = cut;
  const c = components(w, h, (i) => cut.data[i * 4 + 3]! > 0);
  const real = Array.from({ length: c.count }, (_, k) => k + 1).filter((k) => c.area[k]! >= MIN_SPECK);
  const isReal = new Uint8Array(c.count + 1);
  for (const k of real) isReal[k] = 1;
  // Components within `gap` of each other (true pixel distance, not boxes) belong to one specimen.
  const solid = mask(w, h);
  for (let i = 0; i < w * h; i++) solid.m[i] = isReal[c.labels[i]!]!;
  const grown = dilate(solid, (o.gap * Math.max(w, h)) / 2);
  const near = components(w, h, (i) => grown.m[i] === 1);
  const groupOf = new Int32Array(c.count + 1);
  for (let i = 0; i < w * h; i++) if (isReal[c.labels[i]!] === 1) groupOf[c.labels[i]!] = near.labels[i]!;
  const groups = new Map<number, number[]>();
  for (const k of real) groups.set(groupOf[k]!, [...(groups.get(groupOf[k]!) ?? []), k]);
  const area = (ks: number[]): number => ks.reduce((s, k) => s + c.area[k]!, 0);
  const largest = Math.max(0, ...[...groups.values()].map(area));
  const parts: SpritePart[] = [];
  for (const ks of groups.values()) {
    if (area(ks) < largest * o.minShare) continue;
    const member = new Uint8Array(c.count + 1);
    for (const k of ks) member[k] = 1;
    const x0 = Math.min(...ks.map((k) => c.box[k]![0]));
    const y0 = Math.min(...ks.map((k) => c.box[k]![1]));
    const x1 = Math.max(...ks.map((k) => c.box[k]![2]));
    const y1 = Math.max(...ks.map((k) => c.box[k]![3]));
    const image = crop(cut, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    for (let y = 0; y < image.h; y++) {
      for (let x = 0; x < image.w; x++) if (member[c.labels[(y0 + y) * w + x0 + x]!] !== 1) image.data.fill(0, (y * image.w + x) * 4, (y * image.w + x + 1) * 4);
    }
    parts.push({ image, box: [x0, y0, image.w, image.h], area: area(ks) });
  }
  const row = Math.max(1, h * 0.12);
  return parts.sort((a, b) => Math.round((a.box[1] + a.box[3] / 2) / row) - Math.round((b.box[1] + b.box[3] / 2) / row) || a.box[0] - b.box[0]);
}

/** Alpha bounds of a raster: x, y, w, h (the whole raster when empty). */
export function alphaBounds(r: Raster): [number, number, number, number] {
  let x0 = r.w;
  let y0 = r.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (r.data[(y * r.w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? [0, 0, r.w, r.h] : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/** Trims to the alpha bounds, scales (down only) so the long side plus padding fits the size class, pads with a
 * transparent border and bleeds edge colour into it. */
export function fitSprite(part: Raster, size: SizeClass, pad = SPRITE_PAD): Raster {
  const [bx, by, bw, bh] = alphaBounds(part);
  const trimmed = crop(part, bx, by, bw, bh);
  const k = Math.min(1, (SIZE_CLASS[size] - pad * 2) / Math.max(bw, bh));
  const scaled = k < 1 ? resample(trimmed, Math.max(1, Math.round(bw * k)), Math.max(1, Math.round(bh * k))) : trimmed;
  const out = raster(scaled.w + pad * 2, scaled.h + pad * 2);
  for (let y = 0; y < scaled.h; y++) out.data.set(scaled.data.subarray(y * scaled.w * 4, (y + 1) * scaled.w * 4), ((y + pad) * out.w + pad) * 4);
  bleed(out, pad + 2);
  return out;
}
