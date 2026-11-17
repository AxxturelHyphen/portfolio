import type { BedId, Tier } from '../types.ts';
import type { BedScene3, GroundData } from './layout.ts';

/**
 * The ground kit of cook/ART.md section 1 that world places, built once at load as flat instance arrays: the wall
 * flats and piers (for gl's wall batch) and the grass clumps (three parallel blade cards each, never crossed). The
 * path and the puddles live in garden.json ground for gl's ground shader. Pure and deterministic (seeded).
 */

/** Floats per wall piece: x0, x1, yaw (rad), height (m), pier 0|1. */
export const WALL_STRIDE = 5;
/** Floats per clump: x, z, variant 0..2, yaw (rad), height (m). */
export const CLUMP_STRIDE = 5;
/** Floats per dressing piece: x, z, kind (DRESS_KIND), yaw (rad), height (m), shade 0..1 (1 = as drawn). */
export const DRESS_STRIDE = 6;
/** Near-ground dressing pieces: grass clumps (three variants), a low leafy plant, the same leaves lying flat, a petal. */
export const DRESS_KIND = { clump: 0, leafy: 3, litter: 4, petal: 5 } as const;

export interface GroundBuild {
  wall: Float32Array; wallCount: number;
  clumps: Float32Array; clumpCount: number;
  /** Sorted far to near (paint order: the cutout material has no depth). */
  dress: Float32Array; dressCount: number;
}

const CLUMP = { wallInset: 0.3, wallStep: [0.35, 1.9], rimCount: 18, footSpread: 0.25, h: [0.2, 0.55] } as const;
const DEG = Math.PI / 180;

/** Seeded uniform 0..1 (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/** Clump spots by priority: cutout feet, the pond rim, then the wall foot; the tier cap keeps the first ones. */
function buildClumps(g: GroundData, scenes: readonly BedScene3[], tier: Tier, length: number, r: () => number): number[] {
  const spots: [number, number][] = [];
  for (const s of scenes) {
    for (const l of s.layers) for (const it of l.items) {
      if (it.foot !== 'clump' || it.flat === true || it.wing === true) continue;
      spots.push([it.x - CLUMP.footSpread, it.z + 0.05], [it.x + CLUMP.footSpread, it.z + 0.08]);
    }
  }
  for (let i = 0; i < CLUMP.rimCount; i++) {
    const a = (i / CLUMP.rimCount) * Math.PI * 2;
    spots.push([g.pond.x + Math.cos(a) * (g.pond.rx + 0.15), g.pond.z + Math.sin(a) * (g.pond.rz + 0.15)]);
  }
  for (let x = -1.5; x < length; x += CLUMP.wallStep[0] + r() * r() * (CLUMP.wallStep[1] - CLUMP.wallStep[0])) spots.push([x + r() * 0.3, g.wall.z + CLUMP.wallInset + r() * 0.45]);
  const cap = tier === 'low' ? g.clumps.low : g.clumps.high;
  const out: number[] = [];
  for (let i = 0; i < spots.length && i < cap; i++) {
    const [x, z] = spots[i] as [number, number];
    out.push(x, z, Math.floor(r() * 3), (r() * 2 - 1) * 0.5, CLUMP.h[0] + r() * (CLUMP.h[1] - CLUMP.h[0]));
  }
  return out;
}

/**
 * The near ground between the path and the camera (cook/LOOK_NOTES.md 4): clusters with gaps, never a scatter.
 * Pieces grow and darken toward the camera so the nearest read as foreground framing; nothing lands on the path,
 * in a puddle or in the pond.
 */
const DRESS = { from: -1.5, stepMin: 0.7, stepSpan: 1.5, gapChance: 0.2, pathClear: 0.3, nearZ: 5.6, puddleClear: 0.7, pondClear: 0.4, edgeBand: 0.6, fieldStep: 0.8 } as const;

/** Near edge (largest z) of the path centre line at x, or -Infinity where the path does not pass. */
export function pathZAt(points: readonly [number, number][], x: number): number {
  let z = -Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, z0] = points[i] as [number, number];
    const [x1, z1] = points[i + 1] as [number, number];
    if (x < Math.min(x0, x1) || x > Math.max(x0, x1) || x0 === x1) continue;
    z = Math.max(z, z0 + ((x - x0) / (x1 - x0)) * (z1 - z0));
  }
  return z;
}

function clearOf(g: GroundData, x: number, z: number): boolean {
  for (const [px, pz] of g.puddles) if (Math.hypot(px - x, pz - z) < DRESS.puddleClear) return false;
  const p = g.pond;
  const ex = (x - p.x) / (p.rx + DRESS.pondClear);
  const ez = (z - p.z) / (p.rz + DRESS.pondClear);
  return ex * ex + ez * ez > 1;
}

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

export function buildGround(g: GroundData, scenes: readonly BedScene3[], tier: Tier): GroundBuild {
  const length = g.length;
  const r = rng(0x6a617264);
  const wall = buildWall(g, length);
  const clumps = buildClumps(g, scenes, tier, length, r);
  const dress = buildDressing(g, tier, length, r);
  return {
    wall: new Float32Array(wall), wallCount: wall.length / WALL_STRIDE,
    clumps: new Float32Array(clumps), clumpCount: clumps.length / CLUMP_STRIDE,
    dress: new Float32Array(dress), dressCount: dress.length / DRESS_STRIDE,
  };
}
