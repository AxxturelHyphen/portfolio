import { springStep, type SpringState } from '../core/motion.ts';
import { DEG } from './layout.ts';
import type { RigPose } from './rail.ts';
import { PORTRAIT_ASPECT } from './follow.ts';

/**
 * The camera inside the grotto (world/grotto.ts): the follow camera cannot ride behind the visitor there, since the back
 * wall stands between, so the eye stands in the mouth under the lintel, between the jambs, and turns to keep the
 * visitor in frame. The orbit slides it a little along the mouth and leans its yaw; the zoom narrows or widens the lens
 * instead of moving the eye, so no orbit or zoom ever takes it into the rock. world/camera.ts eases the follow pose into
 * this one while the grotto is the bed. Pure math on caller-owned objects: no allocation per frame.
 */
export const GROTTO_EYE = {
  /** The eye in the mouth (m): under the lintel (2.3), between the jambs, its slide along the mouth either side. */
  x: 33.5, y: 1.8, z: -6.32, side: 0.24,
  /**
   * The view aims at the visitor as if it stood at least `near` north of the eye (m), at its middle (`mid` over its
   * ground point) while it is near, rising over `rise` metres farther in to `lookY`: higher on a phone, so the visitor
   * stands in the lower half, clear of the name card, and the low ceiling shows over the back.
   */
  near: 0.3, mid: 0.6, rise: 1.5, lookY: { landscape: 0.8, portrait: 1.25 },
  /**
   * How much of the orbit's yaw leans the view, the most it turns either way, and how far short of square to the side
   * the frame's edge must stay (degrees): the frame always looks into the chamber, never back past the mouth at the
   * garden's cards.
   */
  lean: 0.3, maxYawDeg: 65, edgeDeg: 88,
  /** Vertical lens (degrees) for landscape and portrait at zoom 1, and the range the zoom may take it over. */
  fov: { landscape: 52, portrait: 68 }, minFov: 36, maxFov: 74,
  /** The look point follows the visitor on a critically damped spring (s). */
  tauS: 0.15,
} as const;

export interface GrottoCamera {
  /** The pose (same object every step). */
  readonly pose: RigPose;
  /** Turns the eye toward the visitor at (x, z) under orbit yaw (radians) and zoom; snap lands at once. */
  step(x: number, z: number, yaw: number, zoom: number, aspect: number, dt: number, snap: boolean): void;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function createGrottoCamera(): GrottoCamera {
  const e = GROTTO_EYE;
  const pose: RigPose = { x: e.x, y: e.y, z: e.z, pitch: 0, yaw: 0, fov: e.fov.landscape };
  const tx: SpringState = { x: e.x, v: 0 };
  const tz: SpringState = { x: e.z - e.near, v: 0 };
  const omega = 1 / e.tauS;
  let first = true;
  return {
    pose,
    step(x, z, yaw, zoom, aspect, dt, snap) {
      const lz = Math.min(z, e.z - e.near);
      if (first || snap) {
        tx.x = x;
        tz.x = lz;
        tx.v = 0;
        tz.v = 0;
        first = false;
      } else {
        springStep(tx, x, omega, dt);
        springStep(tz, lz, omega, dt);
      }
      const ex = e.x + clamp(Math.sin(yaw) * 2 * e.side, -e.side, e.side);
      const dx = tx.x - ex;
      const dz = e.z - tz.x;
      const k = clamp((dz - e.near) / e.rise, 0, 1);
      const portrait = aspect < PORTRAIT_ASPECT;
      pose.fov = clamp((portrait ? e.fov.portrait : e.fov.landscape) / Math.max(zoom, 1e-3), e.minFov, e.maxFov);
      const halfWide = Math.atan(Math.tan((pose.fov * DEG) / 2) * aspect);
      const max = Math.min(e.maxYawDeg * DEG, e.edgeDeg * DEG - halfWide);
      pose.x = ex;
      pose.y = e.y;
      pose.z = e.z;
      pose.yaw = clamp(Math.atan2(dx, dz) + yaw * e.lean, -max, max);
      const look = e.mid + ((portrait ? e.lookY.portrait : e.lookY.landscape) - e.mid) * k;
      pose.pitch = -Math.atan2(e.y - look, Math.hypot(dx, dz));
    },
  };
}
