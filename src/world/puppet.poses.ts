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
 * Rest turns (degrees, counter-clockwise; sleeves cut hanging, close to the body): the bent arm holds the lantern just
 * clear of the leg. The free arm's swing stays within a few degrees of this, never held out from the body.
 */
export const REST = { freeArm: -2, carryArm: 16, sideFree: 0, sideCarry: 24 } as const;

/**
 * Back view, two steps of two poses: the trailing foot leaves the ground on contact (the body drops onto the planted
 * leg), then passes high up the screen on a shortened leg while the body rises over the straight planted one. The hips
 * sit over the planted foot; the free (left) arm swings opposite its leg: forward and foreshortened while the left leg
 * trails, back toward the lens and a little out when it lands.
 */
export const BACK_POSES: readonly Pose[] = [
  pose(-2, 2, 0.05, 0, 6, 0, 1.5, -0.5, -2, 0.88, 0, 0.02),
  pose(-1, 1, 0.13, 0, 14, 0, 0, 0, 0, 0.94, 0.5, -0.006),
  pose(-2, 2, 0, 0.05, 0, 6, -1.5, 0.5, 3, 1, 0, 0.02),
  pose(-1, 1, 0, 0.13, 0, 14, 0, 0, 0, 0.94, 0.5, -0.006),
];
/** Side view: legs swing in the picture plane toward the heading; A is the far leg, B the near one. */
export const SIDE_POSES: readonly Pose[] = [
  pose(-14, 18, 0, 0, 10, 0, -4, 0, 10, 1, 0, 0.01),
  pose(5, -2, 0.05, 0, 24, 0, -3, 0, 0, 1, 1, 0),
  pose(18, -14, 0, 0, 0, 10, -4, 0, -10, 1, 0, 0.01),
  pose(-2, 5, 0, 0.05, 0, 24, -3, 0, 0, 1, 1, 0),
];
/** Standing, in every view: feet a little apart, arms hanging. */
export const IDLE = pose(-3, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0);
