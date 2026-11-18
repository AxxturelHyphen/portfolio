/**
 * The figure's pose tables (cook/FIGURE_BUILD.md 4): the walk cycles of the back and side views and the standing pose,
 * stepped on twos of 12 fps by world/puppet.ts.
 */

/**
 * A pose: legs in degrees counter-clockwise (A is the left leg in the back view, the far leg in the side view), foot
 * heights (m, the swing foot raised), knee bends (degrees, foot inward in the back view, backward in the side view),
 * torso and head turns, the free arm's swing (outward in back, toward the heading in side) and drawn height, the carrying
 * arm's turn (at most 1 degree between poses, so the pool does not jitter) and the body's drop (m, negative rises).
 */
export interface Pose {
  hipA: number; hipB: number; footA: number; footB: number; kneeA: number; kneeB: number;
  torso: number; head: number; free: number; freeH: number; carry: number; drop: number;
}
const pose = (hipA: number, hipB: number, footA: number, footB: number, kneeA: number, kneeB: number, torso: number, head: number,
  free: number, freeH: number, carry: number, drop: number): Pose => ({ hipA, hipB, footA, footB, kneeA, kneeB, torso, head, free, freeH, carry, drop });

/**
 * Rest turns (degrees, counter-clockwise; sleeves cut hanging, close to the body): the bent arm holds the lantern clear
 * of the hip, so lantern and fist always show beside the body. The free arm swings within 12 degrees of this.
 */
export const REST = { freeArm: -1, carryArm: 24, sideFree: 0, sideCarry: 30 } as const;

/**
 * Back view, two steps of two poses: the trailing foot peels off the ground on contact (the body drops onto the
 * planted leg), then passes high up the screen on a bent, shortened leg while the body rises over the straight planted
 * one: the scissor of a stride seen from behind. The hips sit over the planted foot; the free (left) arm swings
 * opposite its leg: forward, inward and foreshortened while the left leg trails, back toward the lens and out when it
 * lands.
 */
export const BACK_POSES: readonly Pose[] = [
  pose(-3, 3, 0.07, 0, 12, 0, 2, -1, -9, 0.82, 0, 0.022),
  pose(-1, 1, 0.16, 0, 24, 0, 0, 0, 0, 0.92, 0.5, -0.01),
  pose(-3, 3, 0, 0.07, 0, 12, -2, 1, 10, 1, 0, 0.022),
  pose(-1, 1, 0, 0.16, 0, 24, 0, 0, 0, 0.92, 0.5, -0.01),
];
/** Side view: legs swing in the picture plane toward the heading; A is the far leg, B the near one. */
export const SIDE_POSES: readonly Pose[] = [
  pose(-16, 20, 0, 0, 12, 0, -4, 0, 12, 1, 0, 0.016),
  pose(5, -2, 0.06, 0, 28, 0, -3, 0, 0, 1, 1, -0.008),
  pose(20, -16, 0, 0, 0, 12, -4, 0, -12, 1, 0, 0.016),
  pose(-2, 5, 0, 0.06, 0, 28, -3, 0, 0, 1, 1, -0.008),
];
/** Standing, in every view: feet a little apart, arms hanging. */
export const IDLE = pose(-3, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0);
