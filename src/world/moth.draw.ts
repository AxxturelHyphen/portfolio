/**
 * The moth on paper: two wing cards, each one half of the moth plate, hinged along the body. The plate is the moth
 * seen from above, so the body runs up the card and a wing beat turns each half about that vertical hinge: open, the
 * halves lie in one plane facing the eye; raised, they swing toward the eye together and thin to an edge. A bank
 * rolls both halves about the body as the moth turns. Written into an actor batch (garden/moth.ts) every frame.
 */
import type { InstanceWriter, QuadParams, SpriteRect } from '../types.ts';
import { QUAD_FLAG, packPhase } from './quadflags.ts';

export const MOTH_LOOK = {
  /** Share of the plate's size (the plate is 0.3 m across). */
  scale: 0.75,
  /** Wing turn about the hinge when raised fully (radians, about 75 degrees). */
  raiseRad: 1.3,
  /** A dusty, warm cast over the plate's lilac, nearer a night moth's buff. */
  tint: [0.92, 0.8, 0.62],
} as const;

/** Instances in the moth's batch: the left and the right wing. */
export const MOTH_QUADS = 2;

export interface MothDraw {
  attach(writer: InstanceWriter, rect: SpriteRect): void;
  /** Body centre, wing openness 0..1, bank (radians), opacity 0..1. */
  write(x: number, y: number, z: number, open: number, bank: number, alpha: number): void;
}

export function createMothDraw(): MothDraw {
  const tint = new Float32Array([MOTH_LOOK.tint[0], MOTH_LOOK.tint[1], MOTH_LOOK.tint[2], 1]);
  const leftUV = new Float32Array(4);
  const rightUV = new Float32Array(4);
  const phase = packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.noShadow | QUAD_FLAG.fullRate);
  const left: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 1, py: 0.5, uv: leftUV, sway: 0, phase, lift: 0, facing: 0, tint };
  const right: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0, py: 0.5, uv: rightUV, sway: 0, phase, lift: 0, facing: 0, tint };
  let writer: InstanceWriter | null = null;

  function place(q: QuadParams, x: number, y: number, z: number, bank: number, facing: number): void {
    q.x = x;
    q.y = y;
    q.z = z;
    q.rot = bank;
    q.facing = facing;
  }

  return {
    attach(w, rect) {
      writer = w;
      const [u0, v0, u1, v1] = rect.uv;
      const mid = (u0 + u1) / 2;
      leftUV[0] = u0;
      leftUV[1] = v0;
      leftUV[2] = mid;
      leftUV[3] = v1;
      rightUV[0] = mid;
      rightUV[1] = v0;
      rightUV[2] = u1;
      rightUV[3] = v1;
      left.w = right.w = (rect.size[0] / 2) * MOTH_LOOK.scale;
      left.h = right.h = rect.size[1] * MOTH_LOOK.scale;
      w.count = MOTH_QUADS;
    },
    write(x, y, z, open, bank, alpha) {
      if (writer === null) return;
      const raise = (1 - open) * MOTH_LOOK.raiseRad;
      tint[3] = alpha;
      place(left, x, y, z, bank, raise);
      place(right, x, y, z, bank, -raise);
      writer.set(0, left);
      writer.set(1, right);
      writer.commit(0, MOTH_QUADS);
    },
  };
}
