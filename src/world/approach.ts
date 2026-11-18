/**
 * The approach of free roam: the follow camera eases toward a nearer framing while proximity focuses a slot the visitor
 * has walked up to and the fit (world/fit.ts) says the subject gains from it, and back out when the visitor walks on
 * (APPROACH in core/motion.ts). Out after fastS faster than fastMps, a move of leaveM, or the focus ending; the slot
 * it left does not pull the camera in again until the focus changes, so a visitor dithering by a flower never pumps
 * it. No allocation.
 */
import { APPROACH, SPRING_99, springStep, type SpringState } from '../core/motion.ts';

/** How time runs for the approach: running, frozen (`?t`: land on the end state) or reduced motion (never approach). */
export type ApproachTime = 'run' | 'frozen' | 'reduced';

export interface Approach {
  /** 0: the walking framing, 1: the fitted framing (eased). */
  readonly k: number;
  /** True while the fitted framing is wanted. */
  readonly near: boolean;
  /** True while the ease moves: frames must keep coming. */
  readonly busy: boolean;
  /**
   * One frame: the visitor's speed (m/s) and place, the slot proximity focuses (null: none), whether the fit gains
   * enough to ease in, and whether the visitor has walked by itself yet (no approach at a spawn or after an assisted
   * move until it has).
   */
  step(speed: number, x: number, z: number, focus: string | null, gains: boolean, armed: boolean, dt: number, time: ApproachTime): void;
}

export function createApproach(): Approach {
  const ease: SpringState = { x: 0, v: 0 };
  let near = false;
  let fastT = 0;
  let ax = 0;
  let az = 0;
  /** The slot focused when the camera last eased out: it does not pull the camera in again until focus changes. */
  let spent: string | null = null;

  return {
    get k() {
      return ease.x;
    },
    get near() {
      return near;
    },
    get busy() {
      return ease.x !== (near ? 1 : 0);
    },
    step(speed, x, z, focus, gains, armed, dt, time) {
      if (time === 'reduced') {
        near = false;
        ease.x = 0;
        ease.v = 0;
        return;
      }
      if (focus !== spent) spent = null;
      fastT = speed > APPROACH.fastMps ? fastT + dt : 0;
      const wanted = armed && gains && focus !== null && speed <= APPROACH.fastMps;
      if (time === 'frozen') {
        near = wanted;
        ax = x;
        az = z;
        ease.x = near ? 1 : 0;
        ease.v = 0;
        return;
      }
      if (!near) {
        if (wanted && focus !== spent) {
          near = true;
          ax = x;
          az = z;
        }
      } else if (focus === null || fastT >= APPROACH.fastS || Math.hypot(x - ax, z - az) > APPROACH.leaveM) {
        near = false;
        spent = focus;
      }
      springStep(ease, near ? 1 : 0, SPRING_99 / (near ? APPROACH.inS : APPROACH.outS), dt);
    },
  };
}
