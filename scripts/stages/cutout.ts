/// <reference types="node" />
// Cutout stage: archival plate to straight-alpha RGBA. Classical first: estimate the paper, key it out in OKLab
// with hysteresis, clean with morphology and component rules, then refine a thin edge band (projection alpha plus
// paper un-mixing, so no paper tone survives on the edge). A quality heuristic decides whether the classical matte
// holds; only where it fails does the local ML matte (scripts/py, rembg) supply the mask, refined the same way.
import { toSrgb8, keyDistance, linearOf, linearPlanes, oklabOf, type Planes } from './lib/color.ts';
import { crop, readImage } from './lib/image.ts';
import { refineEdges } from './lib/matte.ts';
import { mlAvailable, mlMatte, ML_MODEL } from './lib/ml.ts';
import { close, components, dilate, distanceTo, fillHoles, mask, type Mask } from './lib/morph.ts';
import { estimatePaper } from './lib/paper.ts';
import { judge, type Quality } from './lib/quality.ts';
import { raster, type Raster } from './raster.ts';

/** Box in fractions of the raw image: x, y, width, height. */
export type Box = [number, number, number, number];

/** Optional per-asset hints, read from a sources entry's `cut` field. */
export interface CutHints {
  /** Only this part of the plate is cut (drops captions, colour charts, neighbouring figures). */
  crop?: Box;
  /** Regions cleared before keying (labels, stamps, plate numbers). */
  drop?: Box[];
  /** Components touching these regions are kept even when small or touching the crop edge. */
  keep?: Box[];
  /** Forces a method instead of letting the quality heuristic decide. */
  method?: 'classical' | 'ml';
  /** Working long side instead of CUT_MAX_SIDE (for parts stored at the plate's native resolution). */
  side?: number;
}

export type CutMethod = 'classical' | 'ml';

export interface CutResult {
  image: Raster;
  method: CutMethod;
  /** Tool line for the `edits` log of the source. */
  tool: string;
  quality: Quality;
  /** Why the classical matte was rejected, when it was. */
  fallbackReason?: string;
}

/** Working resolution of the long side; sprites are at most a quarter of this, so edges are supersampled. */
export const CUT_MAX_SIDE = 2400;
const HI = 3.2;
const LO = 1.6;
const MIN_HI = 0.035;
const MIN_LO = 0.016;

const inBox = (b: Box, w: number, h: number, x: number, y: number): boolean => x >= b[0] * w && x < (b[0] + b[2]) * w && y >= b[1] * h && y < (b[1] + b[3]) * h;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Hysteresis key: weak pixels survive only when connected to a strong one. */
function hysteresis(key: Float32Array, w: number, h: number, lo: number, hi: number, cleared: (i: number) => boolean): Mask {
  const c = components(w, h, (i) => key[i]! > lo && !cleared(i));
  const strong = new Uint8Array(c.count + 1);
  for (let i = 0; i < key.length; i++) if (key[i]! > hi && c.labels[i]! > 0) strong[c.labels[i]!] = 1;
  const out = mask(w, h);
  for (let i = 0; i < key.length; i++) out.m[i] = strong[c.labels[i]!] === 1 ? 1 : 0;
  return out;
}

/** Component rules: drop what touches the crop edge, frame and rule lines, and specks far from the specimens. */
function selectComponents(m: Mask, keep: (x: number, y: number) => boolean): Mask {
  const { w, h } = m;
  const c = components(w, h, (i) => m.m[i] === 1);
  const kept = new Uint8Array(c.count + 1);
  const hinted = new Uint8Array(c.count + 1);
  for (let i = 0; i < m.m.length; i++) if (c.labels[i]! > 0 && keep(i % w, Math.floor(i / w))) hinted[c.labels[i]!] = 1;
  const edge = new Float64Array(c.count + 1);
  for (let i = 0; i < m.m.length; i++) {
    const l = c.labels[i]!;
    if (l > 0 && (c.labels[i - 1] !== l || c.labels[i + 1] !== l || c.labels[i - w] !== l || c.labels[i + w] !== l)) edge[l]!++;
  }
  let largest = 0;
  let largestWidth = 0;
  for (let k = 1; k <= c.count; k++) {
    if (c.touchesBorder[k] || c.area[k]! <= largest) continue;
    largest = c.area[k]!;
    largestWidth = (2 * largest) / edge[k]!;
  }
  // Lettering (captions, plate numbers, names) is a chain of pen strokes: far thinner on average than any specimen.
  const strokePx = Math.max(Math.max(w, h) / 220, largestWidth * 0.15);
  for (let k = 1; k <= c.count; k++) {
    const [x0, y0, x1, y1] = c.box[k]!;
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const frame = bw > 0.6 * w && bh > 0.6 * h && c.area[k]! / (bw * bh) < 0.1;
    const rule = (bw > 0.4 * w && bh < 0.012 * h) || (bh > 0.4 * h && bw < 0.012 * w);
    const large = c.area[k]! >= largest * 0.015;
    const lettering = (2 * c.area[k]!) / edge[k]! < strokePx && c.area[k]! < largest * 0.1;
    if (hinted[k] === 1 || (large && !c.touchesBorder[k] && !frame && !rule && !lettering)) kept[k] = 1;
  }
  const big = mask(w, h);
  for (let i = 0; i < m.m.length; i++) big.m[i] = kept[c.labels[i]!]!;
  const near = dilate(big, Math.max(4, Math.round(Math.max(w, h) * 0.006)));
  const touchNear = new Uint8Array(c.count + 1);
  for (let i = 0; i < m.m.length; i++) if (near.m[i] === 1 && c.labels[i]! > 0) touchNear[c.labels[i]!] = 1;
  for (let k = 1; k <= c.count; k++) if (kept[k] === 0 && touchNear[k] === 1 && !c.touchesBorder[k] && c.area[k]! >= 24) kept[k] = 1;
  const out = mask(w, h);
  for (let i = 0; i < m.m.length; i++) out.m[i] = kept[c.labels[i]!]!;
  return out;
}

interface Prepared { rgb: Raster; lin: Planes; lab: Planes; paperLin: Planes; key: Float32Array; lo: number; hi: number; seen: number; cleared: (i: number) => boolean; keep: (x: number, y: number) => boolean }

function prepare(file: string, hints: CutHints): Prepared {
  const full = readImage(file, hints.side ?? CUT_MAX_SIDE);
  const c = hints.crop;
  const rgb = c ? crop(full, Math.round(c[0] * full.w), Math.round(c[1] * full.h), Math.round(c[2] * full.w), Math.round(c[3] * full.h)) : full;
  const { w } = rgb;
  const toFull = (x: number, y: number): [number, number] => [c ? x + c[0] * full.w : x, c ? y + c[1] * full.h : y];
  const drops = hints.drop ?? [];
  const cleared = (i: number): boolean => {
    const [fx, fy] = toFull(i % w, Math.floor(i / w));
    return drops.some((b) => inBox(b, full.w, full.h, fx, fy));
  };
  const keep = (x: number, y: number): boolean => {
    const [fx, fy] = toFull(x, y);
    return (hints.keep ?? []).some((b) => inBox(b, full.w, full.h, fx, fy));
  };
  const lin = linearPlanes(rgb);
  const lab = oklabOf(lin);
  const paper = estimatePaper(lab);
  const key = keyDistance(lab, paper.field);
  const hi = Math.max(MIN_HI, paper.noise * HI);
  const lo = Math.max(MIN_LO, paper.noise * LO);
  return { rgb, lin, lab, paperLin: linearOf(paper.field), key, lo, hi, seen: paper.seen, cleared, keep };
}

/** The classical mask, plus the closed shape it was selected from (its outline is what raggedness measures). */
function classicalMask(p: Prepared): { m: Mask; shape: Mask } {
  const { w, h } = p.rgb;
  const side = Math.max(w, h);
  const keyed = hysteresis(p.key, w, h, p.lo, p.hi, p.cleared);
  const closeR = Math.max(1.5, side / 900);
  const picked = selectComponents(close(keyed, closeR), p.keep);
  const before = picked.m.slice();
  const speck = (side / 120) ** 2;
  fillHoles(picked, p.key, (area, mean) => area < speck || (area < w * h * 0.03 && mean > p.lo * 0.7));
  // Pale petals drawn with a dashed outline: seal the outline with a wider closing, and take the sealed regions
  // that read as painted (lighter or tinted against the paper), never the rim the wider closing adds.
  const sealed = close(picked, side / 300);
  const open0 = sealed.m.slice();
  fillHoles(sealed, p.key, (area, mean) => area < w * h * 0.03 && mean > p.lo * 0.55);
  for (let i = 0; i < picked.m.length; i++) if (sealed.m[i] === 1 && open0[i] === 0) picked.m[i] = 1;
  // The closing decides which components belong together and seals pale interiors; paper it bridged along the
  // outline stays paper (no halo between hairs, teeth and leaflets) unless it was a hole.
  const shape = { w, h, m: picked.m.slice() };
  const depth = distanceTo(w, h, (i) => shape.m[i] === 0, true);
  const rim = closeR + 1;
  for (let i = 0; i < picked.m.length; i++) if (keyed.m[i] === 0 && before[i] === 1 && depth[i]! <= rim) picked.m[i] = 0;
  return { m: picked, shape };
}

function compose(p: Prepared, m: Mask, fallback: Float32Array): Raster {
  const side = Math.max(p.rgb.w, p.rgb.h);
  const band = Math.max(2, side / 800);
  const matte = refineEdges(p.lin, p.paperLin, m, { inside: band, outside: band, fallback });
  const out = raster(p.rgb.w, p.rgb.h);
  for (let i = 0; i < matte.alpha.length; i++) {
    const a = matte.alpha[i]!;
    if (a <= 0) continue;
    out.data[i * 4] = toSrgb8(matte.color.c0[i]!);
    out.data[i * 4 + 1] = toSrgb8(matte.color.c1[i]!);
    out.data[i * 4 + 2] = toSrgb8(matte.color.c2[i]!);
    out.data[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

const softKey = (p: Prepared): Float32Array => p.key.map((d) => smooth(p.lo, p.hi, d));

/** Cuts one plate. The method is classical unless the quality heuristic (or a hint) asks for the ML matte. */
export function cutout(file: string, hints: CutHints = {}): CutResult {
  const p = prepare(file, hints);
  const { w, h } = p.rgb;
  if (hints.method !== 'ml') {
    const { m, shape } = classicalMask(p);
    const image = compose(p, m, softKey(p));
    const quality = judge(shape, image, p.key, p.lo, p.seen);
    const tool = `classical OKLab paper key (lo ${p.lo.toFixed(3)}, hi ${p.hi.toFixed(3)}), morphology, edge un-mix`;
    if (quality.ok || hints.method === 'classical' || !mlAvailable()) return { image, method: 'classical', tool, quality };
    return withMl(p, w, h, quality.reasons.join(', '));
  }
  return withMl(p, w, h, 'hint');
}

function withMl(p: Prepared, w: number, h: number, reason: string): CutResult {
  const ml = mlMatte(p.rgb, ML_MODEL);
  for (let i = 0; i < ml.alpha.length; i++) if (p.cleared(i)) ml.alpha[i] = 0;
  const m = mask(w, h);
  for (let i = 0; i < m.m.length; i++) m.m[i] = ml.alpha[i]! >= 0.5 ? 1 : 0;
  const clean = selectComponents(m, p.keep);
  const image = compose(p, clean, ml.alpha);
  return { image, method: 'ml', tool: `${ml.tool}, edge un-mix against the paper field`, quality: judge(clean, image, p.key, p.lo, p.seen), fallbackReason: reason };
}
