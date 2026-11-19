import type { BedId, Tier } from '../types.ts';
import type { BedScene3, GroundData } from './layout.ts';
import { builtIn, worldMode, type WorldMode } from './mode.ts';

/**
 * The ground kit of cook/ART.md section 1 that world places, built once at load as flat instance arrays: the wall
 * flats and piers (for gl's wall batch) and the grass clumps (three parallel blade cards each, never crossed). The
 * path and the puddles live in garden.json ground for gl's ground shader. Pure and deterministic (seeded).
 */

/** Floats per wall piece: x0, x1, yaw (rad), height (m), pier 0|1. */
export const WALL_STRIDE = 5;
/** Floats per clump: x, z, variant 0..2, yaw (rad), height (m). */
export const CLUMP_STRIDE = 5;
/**
 * Floats per dressing piece: x, z, kind (DRESS_KIND), yaw (rad), height (m), and a tone 0..1: on the rail the shade
 * (1 = as drawn), under roam the pick of the lawn tint (dressing.ts).
 */
export const DRESS_STRIDE = 6;
/** Dressing pieces: grass clumps (three variants), a low leafy plant, its leaves lying flat, a petal, lawn plants (LAWN_PLANTS). */
export const DRESS_KIND = { clump: 0, leafy: 3, litter: 4, petal: 5, plant: 6 } as const;

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

/** Free roam keeps the clumps this far (m) inside the closed garden's end walls. */
const CLUMP_WALL_CLEAR = 0.3;

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
  const cap = tier === 'low' ? g.clumps.low : g.clumps.high;
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
 * path edges, taller tufts along the wall foot and a few islands on the lawn, by these shares, on their own seed so the
 * lawn planted after them stays as it was. Nothing lands on the path, in a puddle or in the pond.
 */
export const ROAM_BANDS = {
  high: 270, low: 120, edge: 0.6, wall: 0.25,
  edgeOff: [0.3, 1.2], edgeH: [0.15, 0.3], wallZ: [0.3, 1.0], wallH: [0.3, 0.5], islandH: [0.2, 0.4], islandNearZ: 6.5, tries: 20,
} as const;

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

function roamBands(g: GroundData, count: number, out: number[]): void {
  const r = rng(0x62616e64);
  const b = ROAM_BANDS;
  const half = g.path.width / 2;
  const [ex0, ex1] = g.enclosure.x;
  const span = (lo: number, hi: number): number => lo + r() * (hi - lo);
  for (let i = 0; i < count; i++) {
    const pick = i / count;
    for (let t = 0; t < b.tries; t++) {
      const x = span(ex0 + CLUMP_WALL_CLEAR, ex1 - CLUMP_WALL_CLEAR);
      let z: number;
      let h: number;
      if (pick < b.edge) {
        const off = half + span(b.edgeOff[0], b.edgeOff[1]);
        z = pathZAt(g.path.points, x) + (r() < 0.5 ? -off : off);
        h = span(b.edgeH[0], b.edgeH[1]);
      } else if (pick < b.edge + b.wall) {
        z = g.wall.z + span(b.wallZ[0], b.wallZ[1]);
        h = span(b.wallH[0], b.wallH[1]);
      } else {
        z = span(pathZAt(g.path.points, x) + half + 1.5, b.islandNearZ);
        h = span(b.islandH[0], b.islandH[1]);
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

/**
 * The lawn under free roam (cook/ROAM_ART.md 2, revised by blind pairs). The follow camera fills its lower third with
 * the few metres of lawn south of the visitor, so the band from the path to LAWN.farZ is planted as a place to walk
 * through: clusters of 4 to 7 lit plants of 2 or 3 species, 0.25 to 0.9 m, every third cluster with an accent up to
 * 1.1 m, taller behind lower. Cluster centres stand LAWN.apart apart (twice the radius plus a 1.5 m lane), so a lit
 * lane runs between any two clusters north to south as well as east to west. Kept clear: the path and 0.5 m either
 * side, 1 m round each flower slot and its approach from the path, the pond rim, puddles, the foot of bed items and
 * LAWN.wallClear inside the closed garden's end walls. A few flat leaves and petals lie round each cluster.
 */
export const LAWN = { clear: 0.5, farZ: 7.8, wallClear: 0.6, radius: 0.6, lane: 1.5, tries: 1500, slotClear: 1, itemClear: 0.7, accentEvery: 3, few: 4, more: 4, litter: 2 } as const;
const LAWN_APART = LAWN.radius * 2 + LAWN.lane;

/** Lawn plants (kind DRESS_KIND.plant + index): the low species, then the accents. Heights in metres. */
export const LAWN_PLANTS: readonly { sprite: string; h: readonly [number, number] }[] = [
  { sprite: 'sh/clump-1', h: [0.25, 0.5] }, { sprite: 'sh/clump-3', h: [0.3, 0.6] }, { sprite: 'w/buttercup', h: [0.4, 0.7] },
  { sprite: 'w/poppy', h: [0.5, 0.9] }, { sprite: 'w/fiddle', h: [0.25, 0.45] },
  { sprite: 'w/gallica', h: [0.85, 1.1] }, { sprite: 'w/cane', h: [0.9, 1.1] },
];
const LOW_SPECIES = 5;

type Keep = [x: number, z: number, r: number];

/** What the planting stays clear of: slots and their approach from the path, and the feet of the built bed items. */
function keepsOf(g: GroundData, scenes: readonly BedScene3[], mode: WorldMode): Keep[] {
  const keep: Keep[] = [];
  for (const s of scenes) {
    for (const sl of s.slots) {
      const pz = pathZAt(g.path.points, sl.x);
      const to = Number.isFinite(pz) ? pz : sl.z;
      const steps = Math.ceil(Math.abs(to - sl.z) / 0.5);
      for (let i = 0; i <= steps; i++) keep.push([sl.x, sl.z + ((to - sl.z) * i) / Math.max(1, steps), LAWN.slotClear]);
    }
    for (const l of s.layers) for (const it of l.items) if (builtIn(it, mode) && it.flat !== true && it.y === 0) keep.push([it.x, it.z, LAWN.itemClear]);
  }
  return keep;
}

function lawnFree(g: GroundData, keep: readonly Keep[], x: number, z: number, edge: number, pad: number): boolean {
  const pz = pathZAt(g.path.points, x);
  const e = g.enclosure.x;
  if (x < e[0] + LAWN.wallClear || x > e[1] - LAWN.wallClear) return false;
  if (!Number.isFinite(pz) || z < pz + edge || z > LAWN.farZ || !clearOf(g, x, z)) return false;
  for (const [kx, kz, kr] of keep) if (Math.hypot(kx - x, kz - z) < kr + pad) return false;
  return true;
}

function buildLawn(g: GroundData, scenes: readonly BedScene3[], mode: WorldMode, length: number, r: () => number): number[] {
  const keep = keepsOf(g, scenes, mode);
  const edge = g.path.width / 2 + LAWN.clear;
  const centres: [number, number][] = [];
  for (let t = 0; t < LAWN.tries; t++) {
    const x = DRESS.from + r() * (length + 1 - DRESS.from);
    const z = r() * LAWN.farZ;
    if (!lawnFree(g, keep, x, z, edge + LAWN.radius, LAWN.radius) || centres.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < LAWN_APART)) continue;
    centres.push([x, z]);
  }
  const pieces: number[][] = [];
  centres.forEach(([cx, cz], c) => {
    const n = LAWN.few + Math.floor(r() * LAWN.more);
    const species = [Math.floor(r() * LOW_SPECIES), Math.floor(r() * LOW_SPECIES), Math.floor(r() * LOW_SPECIES)];
    const heights: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const kind = c % LAWN.accentEvery === 0 && i === 0 ? LOW_SPECIES + Math.floor(r() * 2) : (species[i % (2 + (c % 2))] ?? 0);
      const [h0, h1] = LAWN_PLANTS[kind]?.h ?? [0.3, 0.5];
      heights.push([kind, h0 + r() * (h1 - h0)]);
    }
    heights.sort((p, q) => q[1] - p[1]);
    heights.forEach(([kind, h], i) => {
      const x = cx + (r() * 2 - 1) * LAWN.radius;
      const z = cz - LAWN.radius * 0.6 + (LAWN.radius * 1.2 * i) / Math.max(1, n - 1) + (r() - 0.5) * 0.15;
      if (lawnFree(g, keep, x, z, edge, 0)) pieces.push([x, z, DRESS_KIND.plant + kind, (r() * 2 - 1) * 0.5, h, r()]);
    });
    for (let i = 0; i < LAWN.litter; i++) {
      const x = cx + (r() * 2 - 1) * LAWN.radius * 1.4;
      const z = cz + (r() * 2 - 1) * LAWN.radius * 1.4;
      const petal = r() < 0.4;
      if (lawnFree(g, keep, x, z, g.path.width / 2 + 0.1, 0)) pieces.push([x, z, petal ? DRESS_KIND.petal : DRESS_KIND.litter, r() * 2 - 1, petal ? 0.1 : 0.34, r()]);
    }
  });
  pieces.sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0));
  return pieces.flat();
}

/** The ground kit for one camera mode (mode.ts): the rail keeps its framing dressing, free roam gets the lawn. */
export function buildGround(g: GroundData, scenes: readonly BedScene3[], tier: Tier, mode: WorldMode = worldMode()): GroundBuild {
  const length = g.length;
  const r = rng(0x6a617264);
  const wall = buildWall(g, length);
  const clumps = buildClumps(g, scenes, tier, mode, length, r);
  const dress = mode === 'roam' ? buildLawn(g, scenes, mode, length, r) : buildDressing(g, tier, length, r);
  return {
    wall: new Float32Array(wall), wallCount: wall.length / WALL_STRIDE,
    clumps: new Float32Array(clumps), clumpCount: clumps.length / CLUMP_STRIDE,
    dress: new Float32Array(dress), dressCount: dress.length / DRESS_STRIDE,
    mode,
  };
}
