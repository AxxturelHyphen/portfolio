/**
 * The follow camera of free roam (cook/ROAM_PLAN.md section 3): a fixed yaw looking along -z at the back wall, a
 * framing per aspect, a critically damped follower on the visitor, and clamps so the frame never shows past the ends of
 * the back wall nor ground south of the garden's limit. Pure math on caller-owned objects: no allocation per frame.
 */
import { FOLLOW, springStep, type SpringState } from '../core/motion.ts';
import { DEG } from './layout.ts';
import type { RigPose } from './rail.ts';

/** What the follow camera may show: the back wall plane (z), the ends of the wall (x) and the ground's south limit (z). */
export interface ViewLimits { wallZ: number; minX: number; maxX: number; maxZ: number }

/** The follow framing for one aspect: camera height and back offset (m), pitch (radians), vertical fov (degrees). */
export interface Framing { up: number; back: number; pitch: number; fov: number; aspect: number }

/** Below this width / height the follow camera uses its portrait framing (the rail's own threshold). */
export const PORTRAIT_ASPECT = 0.8;

/**
 * Landscape: the offsets of FOLLOW. Portrait: higher and steeper, the fov widened from the aspect until FOLLOW.acrossM
 * of ground shows across at the visitor, and the back offset chosen so the visitor sits at FOLLOW.at of the height.
 */
export function framingFor(aspect: number, out: Framing): Framing {
  out.aspect = aspect;
  if (aspect >= PORTRAIT_ASPECT) {
    out.up = FOLLOW.up;
    out.back = FOLLOW.back;
    out.pitch = FOLLOW.pitchDeg * DEG;
    out.fov = FOLLOW.fov;
    return out;
  }
  const down = -FOLLOW.portraitPitchDeg * DEG;
  const below = 2 * FOLLOW.at - 1;
  const tMin = Math.tan((FOLLOW.fov * DEG) / 2);
  let t = tMin;
  for (let i = 0; i < 16; i++) {
    const off = Math.atan(below * t);
    const depth = (FOLLOW.portraitUp / Math.sin(down + off)) * Math.cos(off);
    t = Math.max(tMin, FOLLOW.acrossM / (2 * depth * aspect));
  }
  out.up = FOLLOW.portraitUp;
  out.back = FOLLOW.portraitUp / Math.tan(down + Math.atan(below * t));
  out.pitch = -down;
  out.fov = (2 * Math.atan(t)) / DEG;
  return out;
}

/** Distance along a frustum edge ray (camera-space y = sy * t) to the ground or the wall plane, whichever comes first. */
function edgeReach(sy: number, t: number, f: Framing, camZ: number, wallZ: number): number {
  const cp = Math.cos(f.pitch);
  const sp = Math.sin(f.pitch);
  const dy = sy * t * cp + sp;
  const dz = sy * t * sp - cp;
  const toWall = dz < 0 ? (wallZ - camZ) / dz : Infinity;
  const toGround = dy < 0 ? f.up / -dy : Infinity;
  return Math.min(toWall, toGround);
}

/** The follow pose for a target point on the ground, clamped inside the view limits. Writes into out. */
export function followPose(px: number, pz: number, f: Framing, lim: ViewLimits, out: RigPose): RigPose {
  const t = Math.tan((f.fov * DEG) / 2);
  const cp = Math.cos(f.pitch);
  const sp = Math.sin(f.pitch);
  const by = -t * cp + sp;
  const bz = -t * sp - cp;
  let z = pz + f.back;
  if (by < 0) z = Math.min(z, lim.maxZ - (f.up / -by) * bz);
  const half = edgeReach(1, t, f, z, lim.wallZ) * f.aspect * t;
  const lo = lim.minX + half;
  const hi = lim.maxX - half;
  out.x = lo > hi ? (lim.minX + lim.maxX) / 2 : Math.min(hi, Math.max(lo, px));
  out.y = f.up;
  out.z = z;
  out.pitch = f.pitch;
  out.yaw = 0;
  out.fov = f.fov;
  return out;
}

export interface Follower {
  /** The camera pose the rig mixes in place of the rail walk (same object every frame). */
  readonly pose: Readonly<RigPose>;
  resize(w: number, h: number): void;
  /** Follows the visitor at (x, z); snap lands at once (first frame, frozen time, reduced motion). */
  step(x: number, z: number, dt: number, snap: boolean): void;
}

export function createFollower(lim: ViewLimits): Follower {
  const framing: Framing = { up: 0, back: 0, pitch: 0, fov: 0, aspect: 16 / 9 };
  const pose: RigPose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, fov: 0 };
  const fx: SpringState = { x: 0, v: 0 };
  const fz: SpringState = { x: 0, v: 0 };
  const omega = 1 / FOLLOW.tauS;
  let first = true;
  framingFor(framing.aspect, framing);

  return {
    pose,
    resize(w, h) {
      framingFor(Math.max(1, w) / Math.max(1, h), framing);
    },
    step(x, z, dt, snap) {
      if (first || snap) {
        fx.x = x;
        fz.x = z;
        fx.v = 0;
        fz.v = 0;
        first = false;
      } else {
        springStep(fx, x, omega, dt);
        springStep(fz, z, omega, dt);
      }
      followPose(fx.x, fz.x, framing, lim, pose);
    },
  };
}
