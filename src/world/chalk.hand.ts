import { GRID, SPACING, glyphOf, type GlyphStroke } from './chalk.glyphs.ts';
import { rng } from './groundplan.ts';

/**
 * The chalk hand (pure, no canvas): lays a mark's text out in lines of single-stroke glyphs (world/chalk.glyphs.ts)
 * and turns every stroke into a wobbly polyline in pixels, as a hand would chalk it. Each letter sits a little off its
 * line, size and slant; every point is jittered, curves are rounded off, the line wanders slowly across its own path
 * and the pressure comes and goes along it. The time of each point
 * (0 to 1 over the whole mark, stroke by stroke) lets the mark chalk itself on. Seeded, so a mark is the same on every
 * visit and in every still.
 */

/** Floats per point of an inked stroke: x, y (px, y down), width (px), pressure (0..1), time (0..1). */
export const INK_STRIDE = 5;

export interface Inked {
  /** Strokes in drawing order, INK_STRIDE floats per point, inside [0, w] x [0, h]. */
  readonly strokes: readonly Float32Array[];
  readonly w: number;
  readonly h: number;
}

/** The hand's habits, in grid units: line height, point jitter, a letter's size, rise and slant, the line's wander. */
const LINE = 13;
const JITTER = 0.16;
const SCALE = 0.06;
const RISE = 0.35;
const SLANT = 0.06;
const WANDER = 0.14;
/** Stroke width as a share of a grid unit, and how much light pressure thins it. */
const WIDTH = 1.5;
const THIN = 0.35;
/** Pixels between resampled points; the pause between strokes, in points' time. */
const STEP_PX = 1.6;
const LIFT = 6;

/** A stable seed from a mark's text. */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Corner cutting: a curve's points rounded off twice, ends kept. */
function chaikin(pts: number[]): number[] {
  let p = pts;
  for (let pass = 0; pass < 2; pass++) {
    const out = [p[0]!, p[1]!];
    for (let i = 0; i + 3 < p.length; i += 2) {
      const [x0, y0, x1, y1] = [p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!];
      out.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1, 0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
    }
    out.push(p[p.length - 2]!, p[p.length - 1]!);
    p = out;
  }
  return p;
}

/** A stroke in grid units placed on the line: the letter's own size, rise and slant, then every point jittered. */
interface Placed { pts: number[]; curve: boolean }

function placeGlyph(strokes: readonly GlyphStroke[], x0: number, y0: number, rnd: () => number, out: Placed[]): void {
  const s = 1 + (rnd() * 2 - 1) * SCALE;
  const rise = (rnd() * 2 - 1) * RISE;
  const slant = (rnd() * 2 - 1) * SLANT;
  for (const st of strokes) {
    const pts: number[] = [];
    for (let i = 0; i < st.pts.length; i += 2) {
      const gy = st.pts[i + 1]! - GRID.baseline;
      pts.push(x0 + (st.pts[i]! + gy * slant) * s + (rnd() * 2 - 1) * JITTER, y0 + GRID.baseline + gy * s + rise + (rnd() * 2 - 1) * JITTER);
    }
    out.push({ pts, curve: st.curve });
  }
}

/** One line of text placed from x = 0 at height y0; returns its width. */
function placeLine(line: string, y0: number, rnd: () => number, out: Placed[]): number {
  let x = 0;
  for (const ch of line) {
    const g = glyphOf(ch);
    if (g === null) {
      x += SPACING.space;
    } else {
      placeGlyph(g.strokes, x, y0, rnd, out);
      x += g.width + SPACING.gap;
    }
  }
  return Math.max(0, x - SPACING.gap);
}

/** Resamples a polyline (px) every STEP_PX px with a slow sideways wander and the pressure's swell. */
function ink(pts: number[], unit: number, rnd: () => number): { xy: number[]; p: number[] } {
  const xy: number[] = [];
  const p: number[] = [];
  const phase = rnd() * 6.28;
  const freq = 0.6 + rnd() * 0.6;
  const press = rnd() * 6.28;
  let walked = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / STEP_PX));
    const nx = len > 0 ? -(by - ay) / len : 0;
    const ny = len > 0 ? (bx - ax) / len : 0;
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const f = k / n;
      const d = (walked + len * f) / unit;
      const off = Math.sin(d * freq + phase) * WANDER * unit;
      xy.push(ax + (bx - ax) * f + nx * off, ay + (by - ay) * f + ny * off);
      p.push(0.62 + 0.38 * (0.5 + 0.5 * Math.sin(d * 0.9 + press)) * (0.75 + 0.25 * rnd()));
    }
    walked += len;
  }
  return { xy, p };
}

/** Lays out and inks a mark's text at `unit` px per grid unit. Lines apart by "\n", centred on each other. */
export function inkText(text: string, unit: number): Inked {
  const rnd = rng(seedOf(text));
  const lines = text.split('\n');
  const placedLines = lines.map((line, row) => {
    const out: Placed[] = [];
    const w = placeLine(line, -row * LINE, rnd, out);
    return { out, w };
  });
  const widest = Math.max(...placedLines.map((l) => l.w));
  const placed: Placed[] = [];
  for (const l of placedLines) {
    const dx = (widest - l.w) / 2;
    for (const s of l.out) placed.push({ curve: s.curve, pts: s.pts.map((v, i) => (i % 2 === 0 ? v + dx : v)) });
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of placed) {
    for (let i = 0; i < s.pts.length; i += 2) {
      minX = Math.min(minX, s.pts[i]!);
      maxX = Math.max(maxX, s.pts[i]!);
      minY = Math.min(minY, s.pts[i + 1]!);
      maxY = Math.max(maxY, s.pts[i + 1]!);
    }
  }
  const pad = 1.2;
  const toPx = (s: Placed): number[] => {
    const grid = s.curve ? chaikin(s.pts) : s.pts;
    return grid.map((v, i) => (i % 2 === 0 ? (v - minX + pad) * unit : (maxY - v + pad) * unit));
  };
  const inked = placed.map((s) => ink(toPx(s), unit, rnd));
  const lengths = inked.map((s) => Math.max(1, s.p.length));
  const total = lengths.reduce((a, b) => a + b + LIFT, 0);
  let clock = 0;
  const strokes = inked.map((s, si) => {
    const n = s.p.length;
    const out = new Float32Array(Math.max(1, n) * INK_STRIDE);
    for (let k = 0; k < n; k++) {
      const o = k * INK_STRIDE;
      const pr = s.p[k]!;
      out[o] = s.xy[2 * k]!;
      out[o + 1] = s.xy[2 * k + 1]!;
      out[o + 2] = unit * WIDTH * (1 - THIN * (1 - pr));
      out[o + 3] = pr;
      out[o + 4] = (clock + k) / total;
    }
    clock += lengths[si]! + LIFT;
    return out;
  });
  return { strokes, w: Math.ceil((maxX - minX + 2 * pad) * unit), h: Math.ceil((maxY - minY + 2 * pad) * unit) };
}
