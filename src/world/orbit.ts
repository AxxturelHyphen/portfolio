/**
 * The free roam orbit (cook/PLAN_3D.md F1): the follow camera's yaw about the visitor, inside ±ORBIT.maxDeg, and its
 * zoom. Turn keys turn it at a steady rate, drags by the pixel; ORBIT.idleS after the last turn it springs back to the
 * rest angle (0, the back wall square on), at once under reduced motion. 'fixed' (the stills, ?shot) keeps the rest
 * angle; a number (?orbit=<deg>) holds that angle for stills and tests. No allocation per frame.
 */
import type { OrbitInput } from '../core/orbit.gesture.ts';
import { ORBIT, follow, omegaFor, springStep, type SpringState } from '../core/motion.ts';
import { DEG } from './layout.ts';

export type OrbitMode = 'free' | 'fixed' | number;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** ?orbit=<deg> holds that yaw (clamped to the arc); without it a still keeps the rest angle and a visit orbits freely. */
export function orbitModeOf(param: string | null, still: boolean): OrbitMode {
  const deg = param === null || param.trim() === '' ? NaN : Number(param);
  if (Number.isFinite(deg)) return clamp(deg, -ORBIT.maxDeg, ORBIT.maxDeg);
  return still ? 'fixed' : 'free';
}

export interface Orbit extends OrbitInput {
  /** Radians; positive turns the view toward +x. */
  readonly yaw: number;
  /** Camera distance divisor: above 1 comes nearer. */
  readonly zoom: number;
  /** A turn is held, waits for the spring back or springs back, or the zoom still moves. */
  readonly busy: boolean;
  step(dt: number, reduced: boolean): void;
}

export function createOrbit(mode: OrbitMode): Orbit {
  const max = ORBIT.maxDeg * DEG;
  const free = mode === 'free';
  const yaw: SpringState = { x: typeof mode === 'number' ? mode * DEG : 0, v: 0 };
  const omega = omegaFor(ORBIT.backS);
  const rate = ORBIT.keyDegPerS * DEG;
  let zoom = 1;
  let zoomTo = 1;
  let keys = 0;
  let grabbed = false;
  let idle = 0;

  function turn(rad: number): void {
    yaw.x = clamp(yaw.x + rad, -max, max);
    yaw.v = 0;
    idle = 0;
  }

  return {
    get yaw() {
      return yaw.x;
    },
    get zoom() {
      return zoom;
    },
    get busy() {
      return zoom !== zoomTo || (free && (keys !== 0 || grabbed || yaw.x !== 0));
    },
    turnBy(rad) {
      if (free) turn(rad);
    },
    zoomBy(k) {
      if (free) zoomTo = clamp(zoomTo * k, ORBIT.zoomMin, ORBIT.zoomMax);
    },
    setKeys(dir) {
      if (free) keys = dir;
    },
    grab(on) {
      if (!free) return;
      grabbed = on;
      idle = 0;
    },
    step(dt, reduced) {
      if (zoom !== zoomTo) {
        zoom = reduced ? zoomTo : follow(zoom, zoomTo, ORBIT.zoomTauS, dt);
        if (Math.abs(zoom - zoomTo) < 1e-3) zoom = zoomTo;
      }
      if (!free) return;
      if (keys !== 0) turn(keys * rate * dt);
      if (keys !== 0 || grabbed || yaw.x === 0) return;
      idle += dt;
      if (idle < ORBIT.idleS) return;
      if (reduced) {
        yaw.x = 0;
        yaw.v = 0;
      } else {
        springStep(yaw, 0, omega, dt);
      }
    },
  };
}
