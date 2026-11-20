import { EASE_OUT } from '../core/motion.ts';
import type { CutoutBatch, QuadParams, SpriteId } from '../types.ts';
import { DEG } from './layout.ts';

/**
 * The iron gate leaves at La Puerta swing on their hinges for the first visit's opening (garden/arrival.ts). A leaf is
 * a cutout turned about its pivot, so the swing turns it about the edge it hangs from instead: that edge stays put on
 * the pier while the card's pivot moves round it. A leaf starts shut (facing the lens), swings out past its rest and
 * falls back to it; the right leaf follows the left a moment later. One module value drives every leaf, so a bed built
 * mid-opening joins in. No allocation per frame.
 */

/** The edge a leaf hangs from (0 its left, 1 its right), the way it opens (+1: free edge toward the lens) and its lag. */
const LEAVES: Readonly<Record<SpriteId, { edge: number; dir: number; lag: number }>> = {
  'pu/leaf-l': { edge: 0, dir: 1, lag: 0 },
  'pu/leaf-r': { edge: 1, dir: -1, lag: 0.1 },
};

/** The scale of the swing out past rest (radians): a leaf goes about 0.4 of it beyond its rest, then falls back. */
const OUT = 85 * DEG;

export interface GateLeaf {
  batch: CutoutBatch;
  at: number;
  quad: QuadParams;
  /** The leaf's resting yaw (radians, the quad's facing). */
  rest: number;
  /** The hinge edge on the ground plane (m) and the signed distance from the pivot to it along the card (m). */
  hx: number;
  hz: number;
  arm: number;
  dir: number;
  lag: number;
  /** The swing value last written. */
  shown: number;
}

/** 0: the gates are shut, 1: the leaves rest where the bed places them. */
let swing = 1;

export function setGateSwing(k: number): void {
  swing = k;
}

export const isGateLeaf = (sprite: SpriteId): boolean => LEAVES[sprite] !== undefined;

/** The leaf the quad at `at` of `batch` draws, as written at rest by the bed build (null: not a gate leaf). */
export function gateLeafOf(sprite: SpriteId, quad: QuadParams, batch: CutoutBatch, at: number): GateLeaf | null {
  const leaf = LEAVES[sprite];
  if (leaf === undefined) return null;
  const arm = (leaf.edge - quad.px) * quad.w;
  const rest = quad.facing;
  return { batch, at, quad, rest, hx: quad.x + Math.cos(rest) * arm, hz: quad.z - Math.sin(rest) * arm, arm, dir: leaf.dir, lag: leaf.lag, shown: 1 };
}

/** The leaf's yaw at swing p (0 shut, 1 at rest): opens fast, swings out past its rest and falls back to it. */
function yawAt(g: GateLeaf, p: number): number {
  const out = Math.sin(Math.PI * p) * (1 - p) * (1 - p);
  return g.rest * EASE_OUT(p) - g.dir * OUT * out;
}

/** Writes every leaf whose swing changed since its last write. */
export function swingGates(leaves: readonly GateLeaf[]): void {
  for (let i = 0; i < leaves.length; i++) {
    const g = leaves[i];
    if (g === undefined || g.shown === swing) continue;
    g.shown = swing;
    const p = Math.min(1, Math.max(0, (swing - g.lag) / (1 - g.lag)));
    const yaw = yawAt(g, p);
    g.quad.facing = yaw;
    g.quad.x = g.hx - Math.cos(yaw) * g.arm;
    g.quad.z = g.hz + Math.sin(yaw) * g.arm;
    g.batch.writer.set(g.at, g.quad);
    g.batch.writer.commit(g.at, g.at + 1);
  }
}
