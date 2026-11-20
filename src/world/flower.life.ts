/**
 * A project flower's life: an idle sway about its foot and a slow breath; while the free-roam visitor is within reach
 * (PROXIMITY.reachM, released past the hysteresis) it opens a little larger and turns part of the way toward them, and
 * when its project is opened it pops (a swell past its size, a small dip, then rest). Everything moves on the stepped
 * 12 fps clock like the bloom poses. Frozen time settles the eases at once; reduced motion keeps the flower still.
 * No allocation per frame.
 */
import type { Clock, SlotView } from '../types.ts';
import { EASE_OUT, STEP_FPS, clamp01 } from '../core/motion.ts';
import { PROXIMITY, reachDist } from './proximity.ts';

export const LIFE = {
  /** Idle sway about the foot (radians) and its period. */
  swayRad: 0.03,
  swayPeriodS: 3.6,
  /** Idle breath: share of the size, and its period. */
  breath: 0.02,
  breathPeriodS: 5.2,
  /** Opening toward the visitor: ease time, extra size, share of the bearing turned and its cap (radians). */
  nearS: 0.5,
  nearScale: 0.08,
  turnShare: 0.4,
  turnMaxRad: 0.35,
  /** Bloom pop as the project opens: duration and the peak swell as a share of the size. */
  popS: 0.55,
  popPeak: 0.12,
} as const;

const TAU = 2 * Math.PI;
/** Peak of sin(2.5 pi p) (1 - p)^2 on 0..1 (near p 0.16), so the pop peaks at LIFE.popPeak. */
const POP_SHAPE_PEAK = 0.671;

/** Size offset of the pop at progress p (0..1): up to popPeak, a small dip under, then 0 from p 1 on. */
export function popOf(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  const q = 1 - p;
  return (LIFE.popPeak / POP_SHAPE_PEAK) * Math.sin(2.5 * Math.PI * p) * q * q;
}

/** Wraps an angle to -pi..pi. */
function wrapAngle(a: number): number {
  return a - TAU * Math.round(a / TAU);
}

export interface FlowerLife {
  /** Sway (radians), size factor and extra yaw toward the visitor after the last step. */
  readonly rot: number;
  readonly scale: number;
  readonly yaw: number;
  /** The visitor is within reach: the flower wants to be open. */
  readonly near: boolean;
  /** Starts the bloom pop (ignored under reduced motion). */
  pop(): void;
  /**
   * One frame: the visitor's [x, z] (null: none), the flower's own yaw before this turn, and `still` (reduced motion).
   * The drawn values move once per 12 fps tick. Returns true when rot, scale or yaw changed.
   */
  step(c: Clock, visitor: ArrayLike<number> | null, baseYaw: number, still: boolean): boolean;
}

export function createFlowerLife(slot: SlotView, phase: number): FlowerLife {
  let near = false;
  let nearK = 0;
  let popP = 1;
  let bearing = 0;
  let lastTick = -1;
  let rot = 0;
  let scale = 1;
  let yaw = 0;

  return {
    get rot() { return rot; },
    get scale() { return scale; },
    get yaw() { return yaw; },
    get near() { return near; },
    pop() {
      popP = 0;
    },
    step(c, visitor, baseYaw, still) {
      if (visitor !== null) {
        const vx = visitor[0]!;
        const vz = visitor[1]!;
        const d = reachDist(slot, vx, vz);
        near = near ? d <= PROXIMITY.reachM + PROXIMITY.hysteresisM : d <= PROXIMITY.reachM;
        if (near) bearing = Math.atan2(vx - slot.world[0], vz - slot.world[2]);
      } else {
        near = false;
      }
      const tick = Math.floor(c.t * STEP_FPS + 1e-6);
      let nextRot = 0;
      let nextScale = 1;
      let nextYaw = 0;
      if (still) {
        nearK = near ? 1 : 0;
        popP = 1;
      } else {
        if (tick === lastTick && !c.frozen) return false;
        if (c.frozen || lastTick < 0) {
          nearK = near ? 1 : 0;
          if (c.frozen) popP = 1;
        } else {
          const h = Math.max(0, tick - lastTick) / STEP_FPS;
          nearK = near ? Math.min(1, nearK + h / LIFE.nearS) : Math.max(0, nearK - h / LIFE.nearS);
          popP = Math.min(1, popP + h / LIFE.popS);
        }
        const ts = tick / STEP_FPS;
        const k = EASE_OUT(clamp01(nearK));
        const turn = LIFE.turnShare * wrapAngle(bearing - baseYaw);
        nextRot = LIFE.swayRad * Math.sin((TAU * ts) / LIFE.swayPeriodS + phase);
        nextScale = (1 + LIFE.breath * Math.sin((TAU * ts) / LIFE.breathPeriodS + 1.7 * phase)) * (1 + LIFE.nearScale * k) * (1 + popOf(popP));
        nextYaw = k * Math.max(-LIFE.turnMaxRad, Math.min(LIFE.turnMaxRad, turn));
      }
      lastTick = tick;
      const changed = nextRot !== rot || nextScale !== scale || nextYaw !== yaw;
      rot = nextRot;
      scale = nextScale;
      yaw = nextYaw;
      return changed;
    },
  };
}
