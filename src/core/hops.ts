import type { BedId } from '../types.ts';

/**
 * Hops between beds on the walk (cook/P2_REVIEW.md finding 2). The grotto is off the rail: it opens from its host
 * bed, the visible bed before it in the garden order, so a walk never crosses it. Transitions, the film drive and the
 * camera all count hops here, so Semillero to Salida is one plain hop everywhere.
 */

const OFF_RAIL: ReadonlySet<BedId> = new Set<BedId>(['gruta']);

/** Position of `b` among the visible beds; an off-rail bed takes its host's position. */
export function walkIndex(order: readonly BedId[], b: BedId): number {
  let n = 0;
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    if (id === b) return OFF_RAIL.has(b) ? Math.max(0, n - 1) : n;
    if (id !== undefined && !OFF_RAIL.has(id)) n++;
  }
  return -1;
}

/** The bed whose anchor is nearest to world X `x` (the grotto included: the camera may stand in it). */
export function nearestBedAt(order: readonly BedId[], anchorOf: (b: BedId) => number, x: number): BedId | null {
  let best: BedId | null = null;
  let d = Infinity;
  for (let i = 0; i < order.length; i++) {
    const b = order[i];
    if (b === undefined) continue;
    const e = Math.abs(anchorOf(b) - x);
    if (e < d) {
      d = e;
      best = b;
    }
  }
  return best;
}

/** Visible beds walked from the bed nearest to `x` to bed `to` (0 when they share a place, e.g. host and grotto). */
export function hopsFrom(order: readonly BedId[], anchorOf: (b: BedId) => number, x: number, to: BedId): number {
  const from = nearestBedAt(order, anchorOf, x);
  return from === null ? 1 : Math.abs(walkIndex(order, to) - walkIndex(order, from));
}
