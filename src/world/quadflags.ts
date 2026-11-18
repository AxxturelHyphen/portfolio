/**
 * Per-instance flags of the cutout material, packed into the sway phase. Mirrors QUAD_FLAG and packPhase of
 * gl/instances.ts (world may not import gl); tests/unit/world/quadflags.spec.ts keeps the two equal.
 */
export const QUAD_FLAG = { flat: 1, fullRate: 2, noLean: 4, noShadow: 8, silhouette: 16, turn: 32 } as const;
const PHASE_SPAN = 8;

export function packPhase(phase: number, flags: number): number {
  const tau = Math.PI * 2;
  return flags * PHASE_SPAN + (((phase % tau) + tau) % tau);
}

/** Cutouts this close to the back wall (climbers, postcards, sigils, the portrait) never turn: they read as on it. */
export const TURN_WALL_GAP = 0.8;

/**
 * The standee rule (cook/ROAM_PLAN.md 3): an upright cutout that leans back, stands clear of the wall band and in front
 * of the wall turns toward a roaming eye. Flat items, architecture and hanging things (lean 0) and near masks never do.
 */
export function turnFlag(z: number, wallZ: number, upright: boolean): number {
  return upright && z > wallZ + TURN_WALL_GAP ? QUAD_FLAG.turn : 0;
}
