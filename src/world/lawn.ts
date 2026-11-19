import type { Tier } from '../types.ts';
import { DRESS_FROM_X, DRESS_KIND, clearOf, pathDistance, pathZAt, rng } from './groundplan.ts';
import type { BedScene3, GroundData } from './layout.ts';
import { COVER, cover, type CoverNear } from './cover.ts';
import { builtIn, type WorldMode } from './mode.ts';

/**
 * The lawn under free roam (cook/ROAM_ART.md 2, revised by blind pairs). The follow camera fills its lower third with
 * the few metres of lawn south of the visitor, so the band from the path to LAWN.farZ is planted as a place to walk
 * through: uneven groups of 3 or 5 lit plants, 0.25 to 0.9 m, every third group with an accent up to 1.1 m, taller
 * behind lower, a few group spots left empty. Within a group every plant is a different species, and no plant stands
 * within LAWN.twin of another of its own plate anywhere on the lawn, so nothing reads as stamped. Group centres stand
 * at least LAWN.apart apart (twice the radius plus a 1.5 m lane), so a lit lane runs between any two groups north to
 * south as well as east to west. Kept clear: the path and 0.5 m either side, 1 m round each flower slot and its
 * approach from the path, the pond rim, puddles, the foot of bed items and LAWN.wallClear inside the closed garden's
 * end walls. A lawn plant never repeats the plate of a bed's fading foreground frame within LAWN.frameClear, so one
 * view never holds the same cutout twice up close. A few flat leaves lie round each group, petals only under its flowers,
 * and the low ground cover (cover.ts) runs in drifts under all of it.
 */
export const LAWN = {
  clear: 0.5, farZ: 7.8, wallClear: 0.6, radius: 0.6, lane: 1.5, tries: 1500, slotClear: 1, itemClear: 0.7, accentEvery: 3,
  few: 4, more: 4, litter: 2, groups: [3, 5], twin: 1.2, emptyChance: 0.1, frameClear: 4,
} as const;
const LAWN_APART = LAWN.radius * 2 + LAWN.lane;
/** The ground cover keeps this far (m) from the feet of the bed items and the signposts. */
const COVER_ITEM_CLEAR = 0.35;
const GOLDEN = 2.399963;

/** Lawn plants (kind DRESS_KIND.plant + index): the low species, then the accents. Heights in metres. */
export const LAWN_PLANTS: readonly { sprite: string; h: readonly [number, number] }[] = [
  { sprite: 'sh/clump-1', h: [0.25, 0.5] }, { sprite: 'sh/clump-3', h: [0.3, 0.6] }, { sprite: 'w/buttercup', h: [0.4, 0.7] },
  { sprite: 'w/poppy', h: [0.5, 0.9] }, { sprite: 'w/fiddle', h: [0.25, 0.45] },
  { sprite: 'w/gallica', h: [0.85, 1.1] }, { sprite: 'w/cane', h: [0.9, 1.1] },
];
const LOW_SPECIES = 5;
/** Plates that flower: fallen petals lie only under these. */
const FLOWERING: ReadonlySet<string> = new Set(['w/buttercup', 'w/poppy', 'w/gallica', 'w/cane']);

/**
 * The low edging of free roam (cook/ROAM_LOOK.md F): broken runs of grass, fern and small flowers close along both
 * path edges, dense inside a run, with gaps between runs. Kinds DRESS_KIND.edge + index; heights in metres.
 */
export const EDGE_PLANTS: readonly { sprite: string; h: readonly [number, number] }[] = [
  { sprite: 'sh/clump-1', h: [0.16, 0.28] }, { sprite: 'sh/clump-2', h: [0.14, 0.26] }, { sprite: 'sh/clump-3', h: [0.18, 0.3] },
  { sprite: 'w/buttercup', h: [0.22, 0.34] }, { sprite: 'w/fiddle', h: [0.15, 0.25] },
];
const EDGE_GRASS = 3;
export const EDGING = {
  off: [0.6, 1.0], run: [1.6, 4.2], gap: [0.4, 1.4], step: { high: [0.09, 0.17], low: [0.2, 0.36] }, flower: 0.28,
  itemClear: 0.25, boardClear: 0.5,
} as const;

type Keep = [x: number, z: number, r: number];

/** What the planting stays clear of: slots and their approach from the path, and the feet of the built bed items. */
function keepsOf(g: GroundData, scenes: readonly BedScene3[], mode: WorldMode, itemClear: number): Keep[] {
  const keep: Keep[] = [];
  for (const s of scenes) {
    for (const sl of s.slots) {
      const pz = pathZAt(g.path.points, sl.x);
      const to = Number.isFinite(pz) ? pz : sl.z;
      const steps = Math.ceil(Math.abs(to - sl.z) / 0.5);
      for (let i = 0; i <= steps; i++) keep.push([sl.x, sl.z + ((to - sl.z) * i) / Math.max(1, steps), LAWN.slotClear]);
    }
    for (const l of s.layers) {
      for (const it of l.items) {
        if (!builtIn(it, mode) || it.flat === true || it.y !== 0) continue;
        keep.push([it.x, it.z, it.sprite === 'sh/board' ? Math.max(itemClear, EDGING.boardClear) : itemClear]);
      }
    }
  }
  return keep;
}

function kept(keep: readonly Keep[], x: number, z: number, pad: number): boolean {
  for (const [kx, kz, kr] of keep) if (Math.hypot(kx - x, kz - z) < kr + pad) return true;
  return false;
}

function lawnFree(g: GroundData, keep: readonly Keep[], x: number, z: number, edge: number, pad: number): boolean {
  const pz = pathZAt(g.path.points, x);
  const e = g.enclosure.x;
  if (x < e[0] + LAWN.wallClear || x > e[1] - LAWN.wallClear) return false;
  if (!Number.isFinite(pz) || z < pz + edge || z > LAWN.farZ || !clearOf(g, x, z)) return false;
  return !kept(keep, x, z, pad);
}

/** The plate a lawn or edging kind draws, or null for the dressing's own kinds. */
function plateOf(kind: number): string | null {
  if (kind >= DRESS_KIND.plant) return LAWN_PLANTS[kind - DRESS_KIND.plant]?.sprite ?? null;
  return kind >= DRESS_KIND.edge ? (EDGE_PLANTS[kind - DRESS_KIND.edge]?.sprite ?? null) : null;
}

/** True when a flowering lawn or edging plant stands within `reach` of (x, z). */
function blooms(pieces: readonly number[][], x: number, z: number, reach: number): boolean {
  return pieces.some((p) => FLOWERING.has(plateOf(p[2] ?? -1) ?? '') && Math.hypot((p[0] ?? 0) - x, (p[1] ?? 0) - z) < reach);
}

/** True when a piece of this kind already stands within `d` of (x, z). */
function twinNear(pieces: readonly number[][], kind: number, x: number, z: number, d: number): boolean {
  for (const p of pieces) if (p[2] === kind && Math.hypot((p[0] ?? 0) - x, (p[1] ?? 0) - z) < d) return true;
  return false;
}

export function buildLawn(g: GroundData, scenes: readonly BedScene3[], mode: WorldMode, tier: Tier, length: number, r: () => number): number[] {
  const keep = keepsOf(g, scenes, mode, LAWN.itemClear);
  const edge = g.path.width / 2 + LAWN.clear;
  const centres: [number, number][] = [];
  for (let t = 0; t < LAWN.tries; t++) {
    const x = DRESS_FROM_X + r() * (length + 1 - DRESS_FROM_X);
    const z = r() * LAWN.farZ;
    if (!lawnFree(g, keep, x, z, edge + LAWN.radius, LAWN.radius) || centres.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < LAWN_APART)) continue;
    centres.push([x, z]);
  }
  const pieces: number[][] = [];
  const frames = scenes.flatMap((s) => s.layers.flatMap((l) => l.items)).filter((it) => it.fade === true && builtIn(it, mode));
  const framed = (kind: number, x: number, z: number): boolean => {
    const sprite = LAWN_PLANTS[kind]?.sprite;
    return frames.some((f) => f.sprite === sprite && Math.hypot(f.x - x, f.z - z) < LAWN.frameClear);
  };
  const order = Array.from({ length: LOW_SPECIES }, (_, i) => i);
  centres.forEach(([cx, cz], c) => {
    if (r() < LAWN.emptyChance) return;
    const n = LAWN.groups[Math.floor(r() * LAWN.groups.length)] ?? 3;
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [order[i], order[j]] = [order[j] ?? 0, order[i] ?? 0];
    }
    const accent = c % LAWN.accentEvery === 0;
    const kinds = Array.from({ length: n }, (_, i) => (accent && i === 0 ? LOW_SPECIES + Math.floor(r() * 2) : (order[(i - (accent ? 1 : 0)) % LOW_SPECIES] ?? 0)));
    const heights = kinds.map((kind): [number, number] => {
      const [h0, h1] = LAWN_PLANTS[kind]?.h ?? [0.3, 0.5];
      return [kind, h0 + r() * (h1 - h0)];
    }).sort((p, q) => q[1] - p[1]);
    const turn = r() * Math.PI * 2;
    const spots = heights.map((_, i): [number, number] => {
      const a = turn + i * GOLDEN + (r() - 0.5) * 0.6;
      const d = LAWN.radius * Math.sqrt((i + 0.5) / n) * (0.8 + 0.4 * r());
      return [cx + Math.cos(a) * d, cz + Math.sin(a) * d * 0.8];
    }).sort((p, q) => p[1] - q[1]);
    heights.forEach(([kind, h], i) => {
      const [x, z] = spots[i] ?? [cx, cz];
      if (lawnFree(g, keep, x, z, edge, 0) && !twinNear(pieces, DRESS_KIND.plant + kind, x, z, LAWN.twin) && !framed(kind, x, z)) {
        pieces.push([x, z, DRESS_KIND.plant + kind, (r() * 2 - 1) * 0.5, h, r()]);
      }
    });
    for (let i = 0; i < LAWN.litter; i++) {
      const x = cx + (r() * 2 - 1) * LAWN.radius * 1.4;
      const z = cz + (r() * 2 - 1) * LAWN.radius * 1.4;
      const petal = r() < 0.4;
      if (!lawnFree(g, keep, x, z, g.path.width / 2 + 0.1, 0)) continue;
      const piece = [x, z, petal ? DRESS_KIND.petal : DRESS_KIND.litter, r() * 2 - 1, petal ? 0.1 : 0.34, r()];
      if (!petal || blooms(pieces, x, z, COVER.petalReach)) pieces.push(piece);
    }
  });
  edging(g, scenes, mode, tier, pieces);
  const coverKeep = keepsOf(g, scenes, mode, COVER_ITEM_CLEAR);
  const planted = pieces.filter((p) => (p[2] ?? 0) >= DRESS_KIND.edge);
  const near: CoverNear = {
    anchor: (x, z, reach) => kept(coverKeep, x, z, reach) || planted.some((p) => Math.hypot((p[0] ?? 0) - x, (p[1] ?? 0) - z) < reach),
    bloom: (x, z, reach) => blooms(planted, x, z, reach),
  };
  cover(g, tier, (x, z) => clearOf(g, x, z) && !kept(coverKeep, x, z, 0), near, pieces);
  pieces.sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0));
  return pieces.flat();
}

/**
 * The edging runs along both sides of the path, on their own seed so the lawn stays as it was laid. A flower in a run
 * keeps LAWN.twin from any other of its plate; grass and fern cards may sit close, mirrored in turn by the dressing.
 */
function edging(g: GroundData, scenes: readonly BedScene3[], mode: WorldMode, tier: Tier, pieces: number[][]): void {
  const r = rng(0x65646765);
  const keep = keepsOf(g, scenes, mode, EDGING.itemClear);
  const [ex0, ex1] = g.enclosure.x;
  const span = (lo: number, hi: number): number => lo + r() * (hi - lo);
  const [s0, s1] = EDGING.step[tier === 'low' ? 'low' : 'high'];
  for (const side of [-1, 1]) {
    let x = ex0 + LAWN.wallClear + span(0, EDGING.gap[1]);
    while (x < ex1 - LAWN.wallClear) {
      const end = Math.min(ex1 - LAWN.wallClear, x + span(EDGING.run[0], EDGING.run[1]));
      const lane = span(EDGING.off[0], EDGING.off[1] - 0.15);
      for (; x < end; x += span(s0, s1)) {
        const pz = pathZAt(g.path.points, x);
        if (!Number.isFinite(pz)) continue;
        const z = pz + side * (lane + span(-0.08, 0.15));
        if (pathDistance(g.path.points, x, z) < EDGING.off[0] || !clearOf(g, x, z) || kept(keep, x, z, 0)) continue;
        let kind = DRESS_KIND.edge + Math.floor(r() * EDGE_GRASS);
        if (r() < EDGING.flower) {
          const flower = DRESS_KIND.edge + EDGE_GRASS + Math.floor(r() * (EDGE_PLANTS.length - EDGE_GRASS));
          if (!twinNear(pieces, flower, x, z, LAWN.twin)) kind = flower;
        }
        const [h0, h1] = EDGE_PLANTS[kind - DRESS_KIND.edge]?.h ?? [0.15, 0.25];
        pieces.push([x, z, kind, (r() * 2 - 1) * 0.5, span(h0, h1), r()]);
      }
      x = end + span(EDGING.gap[0], EDGING.gap[1]);
    }
  }
}
