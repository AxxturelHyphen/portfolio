/**
 * The project flowers' own light under free roam: every project flower of the active bed and its neighbours stands in a
 * soft warm pool at all times, a quiet invitation that the gather light (light.ts) strengthens on focus. Each pool is a
 * vec4 (light xyz, strength) in one flat array, the layout of the shader's uInvite[INVITES.count].
 */
import { follow } from '../core/motion.ts';
import type { SlotView } from '../types.ts';

export const INVITES = {
  /** Pools in the shader (lights.glsl uInvite): more than the project flowers of any three beds side by side. */
  count: 6,
  /** The light hangs a little under the bloom and in front of it, toward the path, so the face and the ground both catch it. */
  heightOfBloom: 0.75,
  forward: 0.45,
  /** A pool lights up and dims on this follower as its bed enters or leaves the neighbourhood, so no pool pops. */
  fadeTauS: 0.6,
} as const;

/** Pool positions and their targets (1: lit, 0: fading out). Allocated once. */
export interface InvitePool {
  readonly target: Float32Array;
}

export function createInvitePool(): InvitePool {
  return { target: new Float32Array(INVITES.count) };
}

/**
 * Places the pools on the project flowers of `beds` (the active bed's slots and its neighbours'). A flower already lit
 * keeps its pool and strength; a pool whose flower left the set fades out where it stands, and new flowers take the
 * free pools from strength 0. Runs on a bed change, never per frame.
 */
export function findInvites(beds: readonly (readonly SlotView[])[], pool: InvitePool, out: Float32Array): void {
  const { target } = pool;
  target.fill(0);
  for (const slots of beds) {
    for (const s of slots) {
      if (s.kind !== 'project') continue;
      const x = Math.fround(s.world[0]);
      const y = Math.fround(s.world[1] * INVITES.heightOfBloom);
      const z = Math.fround(s.world[2] + INVITES.forward);
      let at = -1;
      for (let i = 0; i < INVITES.count && at < 0; i++) if (out[i * 4] === x && out[i * 4 + 1] === y && out[i * 4 + 2] === z && out[i * 4 + 3]! > 0) at = i;
      for (let i = 0; i < INVITES.count && at < 0; i++) if (target[i] === 0 && out[i * 4 + 3] === 0) at = i;
      if (at < 0) continue;
      out[at * 4] = x;
      out[at * 4 + 1] = y;
      out[at * 4 + 2] = z;
      target[at] = 1;
    }
  }
}

/** One frame of the pools: each strength follows its target (snapped under frozen time). No allocation. */
export function stepInvites(out: Float32Array, pool: InvitePool, dt: number, snap: boolean): void {
  for (let i = 0; i < INVITES.count; i++) {
    const o = i * 4 + 3;
    const to = pool.target[i]!;
    out[o] = snap ? to : follow(out[o]!, to, INVITES.fadeTauS, dt);
    if (to === 0 && out[o]! < 1e-3) out[o] = 0;
  }
}
