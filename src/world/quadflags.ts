/**
 * Per-instance flags of the cutout material, packed into the sway phase. Mirrors QUAD_FLAG and packPhase of
 * gl/instances.ts (world may not import gl); tests/unit/world/quadflags.spec.ts keeps the two equal.
 */
export const QUAD_FLAG = { flat: 1, fullRate: 2, noLean: 4, noShadow: 8, silhouette: 16 } as const;
const PHASE_SPAN = 8;

export function packPhase(phase: number, flags: number): number {
  const tau = Math.PI * 2;
  return flags * PHASE_SPAN + (((phase % tau) + tau) % tau);
}
