/**
 * The figure's pose tables (cook/FIGURE_BUILD.md 4): the walk cycles of the back and side views, the crouch before the
 * first stride, the settling step and the standing pose, stepped on the 12 fps tick by world/puppet.gait.ts.
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
 * Back view, two steps of two poses: the trailing foot peels off the ground on contact (the body drops onto the
 * planted leg), then passes high up the screen on a bent, shortened leg while the body rises over the straight planted
 * one: the scissor of a stride seen from behind. The hips sit over the planted foot; the free (left) arm swings
 * opposite its leg: forward, inward and foreshortened while the left leg trails, back toward the lens, longer and out
 * when it lands. Sized to read at 120 px: about 5 cm of bob, a knee folded well past a third of a right angle, the
 * free hand travelling about its own length.
 */
export const BACK_POSES: readonly Pose[] = [
  pose(-3, 3, 0.1, 0, 24, 0, 2, -1, -12, 0.66, 0, 0.032),
  pose(-1, 1, 0.2, 0, 38, 0, 0, 0, -2, 0.84, 0.5, -0.016),
  pose(-3, 3, 0, 0.1, 0, 24, -2, 1, 16, 1.06, 0, 0.032),
  pose(-1, 1, 0, 0.2, 0, 38, 0, 0, 2, 0.9, 0.5, -0.016),
];
/**
 * Side view: legs swing in the picture plane toward the heading; A is the far leg, B the near one. A short calm step
 * (the feet about a forearm apart on contact): the trailing knee folds, the passing leg folds under the body while
 * the planted knee gives a little, the body rides up over it, the free arm swings clear of the body both ways and
 * the torso stays nearly upright. The head nods down onto the contact and lifts as the body rides up.
 */
export const SIDE_POSES: readonly Pose[] = [
  pose(-12, 13, 0, 0, 16, 0, -2, -2, 16, 1, 0, 0.028),
  pose(5, -2, 0.07, 0, 40, 4, -1, 1.5, 0, 1, 1, -0.016),
  pose(13, -12, 0, 0, 0, 16, -2, -2, -16, 1, 0, 0.028),
  pose(-2, 5, 0, 0.07, 4, 40, -1, 1.5, 0, 1, 1, -0.016),
];
/** Standing, in every view: feet a little apart, arms hanging. */
export const IDLE = pose(-3, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0);
/**
 * The crouch before the first stride, per view: both feet planted, the knees give, the body sinks and draws back from
 * the heading a little, the free arm drawn back, so the walk reads as pushed off rather than slid into.
 */
export const ANTICIPATE = { back: pose(-3, 3, 0, 0, 6, 6, 0, 1, -6, 0.9, 0, 0.022), side: pose(-4, 5, 0, 0, 10, 6, 3, 1.5, -8, 1, 0, 0.024) } as const;
/** The short last step before standing, per view: the trailing foot comes in low, the body settles a little. */
export const SETTLE = { back: pose(-2, 2, 0.035, 0, 10, 0, 1, 0, -3, 0.92, 0, 0.012), side: pose(-6, 8, 0, 0, 6, 0, -2, 0, 4, 1, 0, 0.008) } as const;

