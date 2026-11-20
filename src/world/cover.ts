import type { Tier } from '../types.ts';
import { DRESS_KIND, pathZAt, rng } from './groundplan.ts';
import type { GroundData } from './layout.ts';

/**
 * The low ground cover of free roam's lawn, so the near lawn the follow camera looks down on reads as a tended garden
 * rather than bare earth: drifts of ivy trailing and lying on the grass, short leaf tufts, a few toadstools and fallen
 * petals, all from the shared plates the lawn already draws (no new draw call). Kinds DRESS_KIND.cover + index.
 *
 * Drifts stand at least COVER.apart apart on the lawn south of the path, out to COVER.front inside the front kerb, so a
 * bare lane of grass shows between any two. Each drift has its own make (mostly ivy, mostly leaves, or a mix) and its
 * own size, every piece its own height, yaw and tint, and an upright piece never stands within COVER.twin of another of
 * its plate, so nothing reads as stamped. No upright piece passes 0.34 m, so none hides the visitor, a signpost or a
 * flower; `free` keeps them off puddles, the pond, the slots and their approach, and the bed items' feet.
 *
 * Nothing lies loose on open lawn: a drift grows only centred within COVER.pathAnchor of the path edge or
 * COVER.anchorReach of a lawn plant, the edging or a bed item's foot (`near.anchor`), as if it spread from there, so
 * clean ground and shadow lie between the plantings; a petal lies only within COVER.petalReach of a flowering plant
 * (`near.bloom`).
 */
export const COVER_PLANTS: readonly { sprite: string; h: readonly [number, number]; flat: boolean }[] = [
  { sprite: 'sh/ivy-2', h: [0.34, 0.56], flat: true },
  { sprite: 'sh/ivy', h: [0.4, 0.6], flat: true },
  { sprite: 'sh/ivy-2', h: [0.2, 0.32], flat: false },
  { sprite: 'sh/ivy', h: [0.24, 0.34], flat: false },
  { sprite: 'sh/clump-3', h: [0.16, 0.28], flat: false },
  { sprite: 'w/fungi', h: [0.08, 0.12], flat: false },
];
const PETAL_H = [0.08, 0.12] as const;

/**
 * Drift makes: the share of each COVER_PLANTS index (then petals) in a drift of that make. Ivy standing over a few of
 * its own leaves, leafy tufts with fallen petals, and a mixed corner with a toadstool; few loose flat leaves.
 */
const MAKES: readonly (readonly number[])[] = [
  [0.2, 0.12, 0.3, 0.24, 0.08, 0, 0.06],
  [0.06, 0.04, 0.2, 0.14, 0.36, 0, 0.2],
  [0.1, 0.08, 0.24, 0.2, 0.2, 0.06, 0.12],
];

export const COVER = {
  pathClear: 0.35, front: 0.4, wallClear: 0.5, apart: 1.25, radius: [0.4, 0.8], tries: { high: 900, low: 450 },
  pieces: { high: [6, 11], low: [3, 5] }, emptyChance: 0.12, twin: 0.5, squash: 0.75, pathAnchor: 0.6, anchorReach: 0.5,
  petalReach: 0.45,
} as const;

/** What a piece may lie beside: anything planted or built within `reach` (m), a flowering plant within `reach`. */
export interface CoverNear {
  anchor(x: number, z: number, reach: number): boolean;
  bloom(x: number, z: number, reach: number): boolean;
}

function pickOf(make: readonly number[], u: number): number {
  let acc = 0;
  for (let i = 0; i < make.length; i++) {
    acc += make[i] ?? 0;
    if (u < acc) return i;
  }
  return make.length - 1;
}

/** Pushes the cover pieces ([x, z, kind, yaw, height, tone]) onto `pieces`, on its own seed so the lawn stays as laid. */
export function cover(g: GroundData, tier: Tier, free: (x: number, z: number) => boolean, near: CoverNear, pieces: number[][]): void {
  const r = rng(0x636f7665);
  const span = (lo: number, hi: number): number => lo + r() * (hi - lo);
  const [ex0, ex1] = g.enclosure.x;
  const x0 = ex0 + COVER.wallClear;
  const x1 = ex1 - COVER.wallClear;
  const far = g.enclosure.front - COVER.front;
  const edge = g.path.width / 2 + COVER.pathClear;
  const onLawn = (x: number, z: number): boolean => {
    const pz = pathZAt(g.path.points, x);
    return x > x0 && x < x1 && Number.isFinite(pz) && z > pz + edge && z < far && free(x, z);
  };
  const centres: [number, number][] = [];
  const tries = tier === 'low' ? COVER.tries.low : COVER.tries.high;
  for (let t = 0; t < tries; t++) {
    const x = span(x0, x1);
    const z = span(pathZAt(g.path.points, x) + edge, far);
    if (!onLawn(x, z) || centres.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < COVER.apart)) continue;
    centres.push([x, z]);
  }
  const [n0, n1] = tier === 'low' ? COVER.pieces.low : COVER.pieces.high;
  const upright: number[][] = [];
  for (const [cx, cz] of centres) {
    if (r() < COVER.emptyChance) continue;
    const make = MAKES[Math.floor(r() * MAKES.length)] ?? MAKES[0] ?? [];
    const radius = span(COVER.radius[0], COVER.radius[1]);
    const n = n0 + Math.floor(r() * (n1 - n0 + 1));
    const turn = r() * Math.PI * 2;
    if (cz - pathZAt(g.path.points, cx) - g.path.width / 2 >= COVER.pathAnchor && !near.anchor(cx, cz, COVER.anchorReach)) continue;
    for (let i = 0; i < n; i++) {
      const a = turn + i * 2.399963 + (r() - 0.5) * 0.8;
      const d = radius * Math.sqrt((i + 0.5) / n);
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d * COVER.squash;
      if (!onLawn(x, z)) continue;
      const pick = pickOf(make, r());
      const plant = COVER_PLANTS[pick];
      if (plant === undefined) {
        const petal = [x, z, DRESS_KIND.petal, r() * 2 - 1, span(PETAL_H[0], PETAL_H[1]), r()];
        if (near.bloom(x, z, COVER.petalReach)) pieces.push(petal);
        continue;
      }
      const kind = DRESS_KIND.cover + pick;
      if (!plant.flat && upright.some((p) => p[2] === kind && Math.hypot((p[0] ?? 0) - x, (p[1] ?? 0) - z) < COVER.twin)) continue;
      const piece = [x, z, kind, (r() * 2 - 1) * (plant.flat ? 1 : 0.5), span(plant.h[0], plant.h[1]), r()];
      if (!plant.flat) upright.push(piece);
      pieces.push(piece);
    }
  }
}
