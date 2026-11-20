import type { BedId, Tier } from '../types.ts';
import type { BedScene3, GroundData } from './layout.ts';
import { builtIn, worldMode, type WorldMode } from './mode.ts';
import { DRESS_FROM_X, DRESS_KIND, DRESS_STRIDE, clearOf, pathDistance, pathZAt, rng } from './groundplan.ts';
import { buildLawn } from './lawn.ts';

export { DRESS_KIND, DRESS_STRIDE, pathDistance, pathZAt, rng } from './groundplan.ts';
export { EDGE_PLANTS, EDGING, LAWN, LAWN_PLANTS } from './lawn.ts';

/**
 * The ground kit of cook/ART.md section 1 that world places, built once at load as flat instance arrays: the wall
 * flats and piers (for gl's wall batch) and the grass clumps (three parallel blade cards each, never crossed). The
 * path and the puddles live in garden.json ground for gl's ground shader; free roam's lawn and edging are laid by
 * lawn.ts. Pure and deterministic (seeded).
 */

/** Floats per wall piece: x0, x1, yaw (rad), height (m), pier 0|1. */
export const WALL_STRIDE = 5;
/** Floats per clump: x, z, variant 0..2, yaw (rad), height (m). */
export const CLUMP_STRIDE = 5;

export interface GroundBuild {
  wall: Float32Array; wallCount: number;
  clumps: Float32Array; clumpCount: number;
  /** Sorted far to near (paint order: the cutout material has no depth). */
  dress: Float32Array; dressCount: number;
  /** The camera the dressing was laid out for. */
  mode: WorldMode;
}

const CLUMP = { wallInset: 0.3, wallStep: [0.35, 1.9], rimCount: 18, footSpread: 0.25, h: [0.2, 0.55] } as const;
const DEG = Math.PI / 180;

/** Contact shadow length (times the cutout height) at world x: the place whose anchor is nearest. */
export function shadowLengthAt(g: GroundData, anchors: Record<BedId, number>, x: number): number {
  let best: BedId = 'puerta';
  for (const b of Object.keys(g.shadowLength) as BedId[]) if (Math.abs(anchors[b] - x) < Math.abs(anchors[best] - x)) best = b;
  return g.shadowLength[best];
}

/** Wall height at x: full, the parapet behind the pond, or the ruined wall toward the exit. */
export function wallHeightAt(g: GroundData, x: number): number {
  for (const [x0, x1, h] of g.wall.low) if (x >= x0 && x <= x1) return h;
  return g.wall.h;
}

/** The wall runs on past the gate piers so the Puerta key and S06 never see sky beside the flank walls. */
const WALL_FROM_X = -9.2;

function buildWall(g: GroundData, length: number): number[] {
  const out: number[] = [];
  let flip = 0;
  for (let x = WALL_FROM_X; x < length; x += g.wall.flatW) {
    const mid = x + g.wall.flatW / 2;
    out.push(x, x + g.wall.flatW, (g.wall.flatYaw[flip] ?? 0) * DEG, wallHeightAt(g, mid), 0);
    flip = 1 - flip;
  }
  for (const px of g.wall.piers) out.push(px - 0.25, px + 0.25, 0, wallHeightAt(g, px), 1);
  return out;
}

/** Free roam keeps the clumps this far (m) inside the closed garden's end walls. */
const CLUMP_WALL_CLEAR = 0.3;
/** Free roam keeps this share of the tier's clump cap (the feet of the bed items first): clean ground between plantings. */
const ROAM_CLUMP_SHARE = 0.6;

/** Clump spots by priority: cutout feet, the pond rim, then the wall foot; the tier cap keeps the first ones. */
function buildClumps(g: GroundData, scenes: readonly BedScene3[], tier: Tier, mode: WorldMode, length: number, r: () => number): number[] {
  const spots: [number, number][] = [];
  for (const s of scenes) {
    for (const l of s.layers) for (const it of l.items) {
      if (it.foot !== 'clump' || it.flat === true || it.wing === true || !builtIn(it, mode)) continue;
      spots.push([it.x - CLUMP.footSpread, it.z + 0.05], [it.x + CLUMP.footSpread, it.z + 0.08]);
    }
  }
  for (let i = 0; i < CLUMP.rimCount; i++) {
    const a = (i / CLUMP.rimCount) * Math.PI * 2;
    spots.push([g.pond.x + Math.cos(a) * (g.pond.rx + 0.15), g.pond.z + Math.sin(a) * (g.pond.rz + 0.15)]);
  }
  for (let x = -1.5; x < length; x += CLUMP.wallStep[0] + r() * r() * (CLUMP.wallStep[1] - CLUMP.wallStep[0])) spots.push([x + r() * 0.3, g.wall.z + CLUMP.wallInset + r() * 0.45]);
  const cap = Math.round((tier === 'low' ? g.clumps.low : g.clumps.high) * (mode === 'roam' ? ROAM_CLUMP_SHARE : 1));
  const [ex0, ex1] = g.enclosure.x;
  const inside = mode === 'rail' ? spots : spots.filter(([x]) => x > ex0 + CLUMP_WALL_CLEAR && x < ex1 - CLUMP_WALL_CLEAR);
  const out: number[] = [];
  for (let i = 0; i < inside.length && i < cap; i++) {
    const [x, z] = inside[i] as [number, number];
    out.push(x, z, Math.floor(r() * 3), (r() * 2 - 1) * 0.5, CLUMP.h[0] + r() * (CLUMP.h[1] - CLUMP.h[0]));
  }
  if (mode === 'roam') roamBands(g, tier === 'low' ? ROAM_BANDS.low : ROAM_BANDS.high, out);
  return out;
}

/**
 * Free roam's extra grass in bands, not a scatter (cook/ROAM_LOOK.md F): an irregular low edging 0.3 to 1.2 m off both
 * path edges (the `edge` share) and taller tufts along the wall foot (the rest), on their own seed so the lawn planted after them
 * stays as it was. No islands on the open lawn: the ground between plantings stays clean. The edging tufts stand in
 * tight groups of 3 or 5 (`group`, metres across), never in an even row. Nothing lands on the path, in a puddle or in
 * the pond.
 */
export const ROAM_BANDS = {
  high: 120, low: 55, edge: 0.7,
  edgeOff: [0.3, 1.2], edgeH: [0.15, 0.3], wallZ: [0.3, 1.0], wallH: [0.3, 0.5], tries: 20,
  group: [0.5, 0.18],
} as const;

function roamBands(g: GroundData, count: number, out: number[]): void {
  const r = rng(0x62616e64);
  const b = ROAM_BANDS;
  const half = g.path.width / 2;
  const [ex0, ex1] = g.enclosure.x;
  const span = (lo: number, hi: number): number => lo + r() * (hi - lo);
  let left = 0;
  let gx = 0;
  let goff = 0;
  const regroup = (): void => {
    gx = span(ex0 + CLUMP_WALL_CLEAR, ex1 - CLUMP_WALL_CLEAR);
    goff = (half + span(b.edgeOff[0], b.edgeOff[1])) * (r() < 0.5 ? -1 : 1);
  };
  for (let i = 0; i < count; i++) {
    const pick = i / count;
    if (pick < b.edge && left === 0) {
      left = r() < 0.55 ? 3 : 5;
      regroup();
    }
    if (pick < b.edge) left--;
    for (let t = 0; t < b.tries; t++) {
      if (pick < b.edge && t > 0 && t % 5 === 0) regroup();
      const x = pick < b.edge ? gx + span(-0.5, 0.5) * b.group[0] : span(ex0 + CLUMP_WALL_CLEAR, ex1 - CLUMP_WALL_CLEAR);
      let z: number;
      let h: number;
      if (pick < b.edge) {
        z = pathZAt(g.path.points, x) + goff + span(-0.5, 0.5) * b.group[1];
        h = span(b.edgeH[0], b.edgeH[1]);
      } else {
        z = g.wall.z + span(b.wallZ[0], b.wallZ[1]);
        h = span(b.wallH[0], b.wallH[1]);
      }
      if (!Number.isFinite(z) || pathDistance(g.path.points, x, z) < half + b.edgeOff[0] || !clearOf(g, x, z)) continue;
      out.push(x, z, Math.floor(r() * 3), (r() * 2 - 1) * 0.5, h);
      break;
    }
  }
}

/**
 * The near ground between the path and the camera (cook/LOOK_NOTES.md 4): clusters with gaps, never a scatter.
 * Pieces grow and darken toward the camera so the nearest read as foreground framing; nothing lands on the path,
 * in a puddle or in the pond.
 */
const DRESS = { from: DRESS_FROM_X, stepMin: 0.7, stepSpan: 1.5, gapChance: 0.2, pathClear: 0.3, nearZ: 5.6, edgeBand: 0.6, fieldStep: 0.8 } as const;

function dressKind(r: () => number): number {
  const k = r();
  if (k < 0.4) return DRESS_KIND.clump + (r() < 0.8 ? 2 * Math.floor(r() * 2) : 1);
  if (k < 0.75) return DRESS_KIND.leafy;
  if (k < 0.9) return DRESS_KIND.litter;
  return DRESS_KIND.petal;
}

/** One cluster around (x, cz): pieces spread wider and grow larger toward the camera. */
function cluster(g: GroundData, x: number, cz: number, n: number, edge: number, r: () => number, out: number[][]): void {
  for (let i = 0; i < n; i++) {
    const near = Math.min(1, Math.max(0, (cz - 0.5) / (DRESS.nearZ - 0.5)));
    const px = x + (r() + r() - 1) * (0.6 + near * 0.6);
    const pz = Math.max(pathZAt(g.path.points, px) + edge, cz + (r() + r() - 1) * (0.3 + near * 0.4));
    if (!clearOf(g, px, pz)) continue;
    const k = Math.min(1, Math.max(0, (pz - 0.5) / (DRESS.nearZ - 0.5)));
    const kind = dressKind(r);
    const base = kind === DRESS_KIND.petal ? 0.09 : kind === DRESS_KIND.litter ? 0.36 : kind === DRESS_KIND.leafy ? 0.5 : 0.36;
    out.push([px, pz, kind, (r() * 2 - 1) * 0.6, base * (0.75 + r() * 0.4) * (0.9 + k * 1.8), 0.8 - k * 0.6]);
  }
}

/**
 * Two passes: small clusters along the path edge (the bed views see only that strip), then fuller clusters over the
 * near field that frame the wide views, denser toward the camera. Both leave gaps.
 */
function buildDressing(g: GroundData, tier: Tier, length: number, r: () => number): number[] {
  const pieces: number[][] = [];
  const edge = g.path.width / 2 + DRESS.pathClear;
  const few = tier === 'low' ? 2 : 3;
  for (let x = DRESS.from; x < length + 1; ) {
    x += DRESS.stepMin + r() * DRESS.stepSpan;
    const z0 = pathZAt(g.path.points, x) + edge;
    if (r() < DRESS.gapChance || !Number.isFinite(z0)) continue;
    cluster(g, x, z0 + r() * DRESS.edgeBand, few + Math.floor(r() * 3), edge, r, pieces);
  }
  for (let x = DRESS.from; x < length + 1; ) {
    x += DRESS.fieldStep + r() * DRESS.fieldStep;
    const z0 = pathZAt(g.path.points, x) + edge + DRESS.edgeBand;
    if (r() < DRESS.gapChance || !Number.isFinite(z0) || z0 >= DRESS.nearZ) continue;
    const t = Math.sqrt(r());
    cluster(g, x, z0 + t * (DRESS.nearZ - z0), few + Math.floor(t * 5 + r() * 3), edge, r, pieces);
  }
  pieces.sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0));
  return pieces.flat();
}

/** The ground kit for one camera mode (mode.ts): the rail keeps its framing dressing, free roam gets the lawn. */
export function buildGround(g: GroundData, scenes: readonly BedScene3[], tier: Tier, mode: WorldMode = worldMode()): GroundBuild {
  const length = g.length;
  const r = rng(0x6a617264);
  const wall = buildWall(g, length);
  const clumps = buildClumps(g, scenes, tier, mode, length, r);
  const dress = mode === 'roam' ? buildLawn(g, scenes, mode, tier, length, r) : buildDressing(g, tier, length, r);
  return {
    wall: new Float32Array(wall), wallCount: wall.length / WALL_STRIDE,
    clumps: new Float32Array(clumps), clumpCount: clumps.length / CLUMP_STRIDE,
    dress: new Float32Array(dress), dressCount: dress.length / DRESS_STRIDE,
    mode,
  };
}
