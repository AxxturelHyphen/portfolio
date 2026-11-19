import type { GroundData } from './layout.ts';

/**
 * The ground plan helpers that the ground kit (ground.ts) and the roam lawn (lawn.ts) share: the dressing layout, the
 * seeded random, the path's distance and near edge, and the puddle and pond clearance. Pure.
 */

/**
 * Floats per dressing piece: x, z, kind (DRESS_KIND), yaw (rad), height (m), and a tone 0..1: on the rail the shade
 * (1 = as drawn), under roam the pick of the lawn tint (dressing.ts).
 */
export const DRESS_STRIDE = 6;
/**
 * Dressing pieces: grass clumps (three variants), a low leafy plant, its leaves lying flat, a petal, the low ground cover
 * of the lawn under roam (COVER_PLANTS, up to six), the low edging along the path under roam (EDGE_PLANTS), lawn plants
 * (LAWN_PLANTS).
 */
export const DRESS_KIND = { clump: 0, leafy: 3, litter: 4, petal: 5, cover: 6, edge: 12, plant: 17 } as const;

/** Dressing starts this far west of the gate (m). */
export const DRESS_FROM_X = -1.5;
const CLEAR = { puddle: 0.7, pond: 0.4 } as const;

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

/** Ground distance from (x, z) to the path's centre line. */
export function pathDistance(points: readonly [number, number][], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, z0] = points[i] as [number, number];
    const [x1, z1] = points[i + 1] as [number, number];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const t = Math.min(1, Math.max(0, ((x - x0) * dx + (z - z0) * dz) / Math.max(1e-9, dx * dx + dz * dz)));
    d = Math.min(d, Math.hypot(x - x0 - t * dx, z - z0 - t * dz));
  }
  return d;
}

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

/** Keeps pieces out of puddles and off the pond rim. */
export function clearOf(g: GroundData, x: number, z: number): boolean {
  for (const [px, pz] of g.puddles) if (Math.hypot(px - x, pz - z) < CLEAR.puddle) return false;
  const p = g.pond;
  const ex = (x - p.x) / (p.rx + CLEAR.pond);
  const ez = (z - p.z) / (p.rz + CLEAR.pond);
  return ex * ex + ez * ez > 1;
}
