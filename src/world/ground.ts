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

export interface GroundBuild {
  wall: Float32Array; wallCount: number;
  clumps: Float32Array; clumpCount: number;
}

const CLUMP = { wallInset: 0.3, wallStep: 0.45, rimCount: 18, footSpread: 0.25, h: [0.28, 0.42] } as const;
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

function buildWall(g: GroundData, length: number): number[] {
  const out: number[] = [];
  let flip = 0;
  for (let x = -2; x < length; x += g.wall.flatW) {
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
  for (let x = -1.5; x < length; x += CLUMP.wallStep) spots.push([x + r() * 0.5, g.wall.z + CLUMP.wallInset + r() * 0.2]);
  const cap = tier === 'low' ? g.clumps.low : g.clumps.high;
  const out: number[] = [];
  for (let i = 0; i < spots.length && i < cap; i++) {
    const [x, z] = spots[i] as [number, number];
    out.push(x, z, Math.floor(r() * 3), (r() * 2 - 1) * 0.5, CLUMP.h[0] + r() * (CLUMP.h[1] - CLUMP.h[0]));
  }
  return out;
}

export function buildGround(g: GroundData, scenes: readonly BedScene3[], tier: Tier): GroundBuild {
  const length = g.length;
  const r = rng(0x6a617264);
  const wall = buildWall(g, length);
  const clumps = buildClumps(g, scenes, tier, length, r);
  return {
    wall: new Float32Array(wall), wallCount: wall.length / WALL_STRIDE,
    clumps: new Float32Array(clumps), clumpCount: clumps.length / CLUMP_STRIDE,
  };
}
