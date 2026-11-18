/**
 * The follow camera of free roam (cook/ROAM_PLAN.md section 3): a fixed yaw looking along -z at the back wall, a
 * framing per aspect, a critically damped follower on the visitor, and clamps so the frame stays inside the closed
 * garden. The end walls let the view centre on the visitor near both ends: the clamp only keeps the sky that shows over
 * an end wall near the horizon, and the frame from looking past the front corners. Pure math on caller-owned objects:
 * no allocation per frame.
 */
import { FOLLOW, FOLLOW_FRAMINGS, springStep, type FollowFraming, type SpringState } from '../core/motion.ts';
import { DEG, type EnclosureData } from './layout.ts';
import type { RigPose } from './rail.ts';

/**
 * What the follow camera may show: the end wall planes (x) and their height, the back wall and front kerb lines (z) and the ground's
 * south limit for the bottom of the frame (z, a little inside the kerb so the kerb only ever shows as a sliver).
 */
export interface ViewLimits { minX: number; maxX: number; endH: number; back: number; front: number; maxZ: number }

/** What the follow camera may show inside the closed garden (cook/ROAM_ART.md section 3). */
export function viewLimitsOf(e: EnclosureData, wallZ: number): ViewLimits {
  return { minX: e.x[0], maxX: e.x[1], endH: e.endH, back: wallZ, front: e.front, maxZ: e.viewMaxZ };
}

/**
 * Sky may show over an end wall only this far below the horizon (degrees): over a near wall the sky would reach down
 * beside the visitor and read as the edge of the world, over a far one it is the same band as over the back wall.
 */
export const SIDE_SKY_DEG = 9;
const SIDE_SAMPLES = 64;
/**
 * The most of any row of the frame an end wall may fill: a near wall seen at a grazing angle is magnified stone. Portrait
 * frames are narrow, so they allow more.
 */
export const WALL_SHARE = { landscape: 0.18, portrait: 0.25 } as const;
/** The visitor keeps at least this share of the width from either edge before a near wall may grow past its share. */
const KEEP = 0.2;
const SHARE_GRID = { cols: 32, rows: 18, steps: 12, far: 20 } as const;

/** The follow framing for one aspect: camera height and back offset (m), pitch (radians), vertical fov (degrees), and
 * the moon's place as a share of the screen height from the top. */
export interface Framing { up: number; back: number; pitch: number; fov: number; aspect: number; moonAt: number }

/** Below this width / height the follow camera uses its portrait framing (the rail's own threshold). */
export const PORTRAIT_ASPECT = 0.8;

/**
 * Landscape: FOLLOW_FRAMINGS[name] (FOLLOW.framing by default); portrait: the phone framing. The back offset puts the
 * visitor's ground point at FOLLOW.at of the screen height from the top.
 */
export function framingFor(aspect: number, out: Framing, name = FOLLOW.framing): Framing {
  const f: FollowFraming = aspect >= PORTRAIT_ASPECT ? FOLLOW_FRAMINGS[name] : FOLLOW_FRAMINGS.phone;
  const below = Math.atan((2 * FOLLOW.at - 1) * Math.tan((f.fov * DEG) / 2));
  out.aspect = aspect;
  out.up = f.up;
  out.back = f.up / Math.tan(f.downDeg * DEG + below);
  out.pitch = -f.downDeg * DEG;
  out.fov = f.fov;
  out.moonAt = f.moonAt;
  return out;
}

/** Elevation of the moon (degrees) that hangs it at the framing's moonAt of the screen height, over the wall. */
export function moonElevation(f: Framing): number {
  return (f.pitch + Math.atan((1 - 2 * f.moonAt) * Math.tan((f.fov * DEG) / 2))) / DEG;
}

/**
 * How far the camera keeps from an end wall plane (m) so that no ray on the side edge of the frame passes over the
 * wall steeper than SIDE_SKY_DEG below the horizon.
 */
export function sideReach(f: Framing, endH: number): number {
  const t = Math.tan((f.fov * DEG) / 2);
  const cp = Math.cos(f.pitch);
  const sp = Math.sin(f.pitch);
  const lateral = f.aspect * t;
  const steep = Math.tan(SIDE_SKY_DEG * DEG);
  let reach = 0;
  for (let i = 0; i <= SIDE_SAMPLES; i++) {
    const s = -1 + (2 * i) / SIDE_SAMPLES;
    const dy = s * t * cp + sp;
    const dz = s * t * sp - cp;
    if (-dy <= steep * Math.hypot(lateral, dz)) continue;
    reach = Math.max(reach, ((f.up - endH) * lateral) / -dy);
  }
  return reach;
}

/** The widest share of a frame row that an end wall at lateral distance l (m) fills, camera at z. */
export function wallShare(f: Framing, l: number, z: number, lim: ViewLimits): number {
  const t = Math.tan((f.fov * DEG) / 2);
  const cp = Math.cos(f.pitch);
  const sp = Math.sin(f.pitch);
  let most = 0;
  for (let j = 0; j <= SHARE_GRID.rows; j++) {
    const s = -1 + (2 * j) / SHARE_GRID.rows;
    const dy = s * t * cp + sp;
    const dz = s * t * sp - cp;
    let hits = 0;
    for (let i = 0; i < SHARE_GRID.cols; i++) {
      const dx = -f.aspect * t * (1 - (i + 0.5) / SHARE_GRID.cols);
      const tw = l / -dx;
      const y = f.up + dy * tw;
      const wz = z + dz * tw;
      if ((dy >= 0 || tw < f.up / -dy) && y <= lim.endH && wz >= lim.back && wz <= lim.front) hits++;
    }
    most = Math.max(most, hits / (2 * SHARE_GRID.cols));
  }
  return most;
}

/** The nearest lateral distance (m) to an end wall at which it fills no more than WALL_SHARE of any row. */
function shareReach(f: Framing, z: number, lim: ViewLimits, from: number): number {
  const limit = f.aspect >= PORTRAIT_ASPECT ? WALL_SHARE.landscape : WALL_SHARE.portrait;
  if (wallShare(f, from, z, lim) <= limit) return from;
  let lo = from;
  let hi: number = SHARE_GRID.far;
  for (let k = 0; k < SHARE_GRID.steps; k++) {
    const mid = (lo + hi) / 2;
    if (wallShare(f, mid, z, lim) <= limit) hi = mid;
    else lo = mid;
  }
  return hi;
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
  // South of the kerb line, the bottom corner rays (the widest per metre forward) must cross it between the end walls.
  const front = z > lim.front ? (f.aspect * t * (z - lim.front)) / -bz : 0;
  const hard = Math.max(sideReach(f, lim.endH), front);
  const soft = shareReach(f, z, lim, hard);
  // The wall share gives way before the visitor leaves the middle KEEP band of the width; the outside never does.
  const keep = (1 - 2 * KEEP) * (z - pz) * cp * f.aspect * t + (1 - 2 * KEEP) * -f.up * sp * f.aspect * t;
  const lo = Math.max(lim.minX + hard, Math.min(lim.minX + soft, px + keep));
  const hi = Math.min(lim.maxX - hard, Math.max(lim.maxX - soft, px - keep));
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
  /** The framing for the current aspect (same object; changes on resize). */
  readonly framing: Readonly<Framing>;
  resize(w: number, h: number): void;
  /** Follows the visitor at (x, z); snap lands at once (first frame, frozen time, reduced motion). */
  step(x: number, z: number, dt: number, snap: boolean): void;
}

export function createFollower(lim: ViewLimits): Follower {
  const framing: Framing = { up: 0, back: 0, pitch: 0, fov: 0, aspect: 16 / 9, moonAt: 0 };
  const pose: RigPose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, fov: 0 };
  const fx: SpringState = { x: 0, v: 0 };
  const fz: SpringState = { x: 0, v: 0 };
  const omega = 1 / FOLLOW.tauS;
  let first = true;
  framingFor(framing.aspect, framing);

  return {
    pose,
    framing,
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
