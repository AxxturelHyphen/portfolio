import { HOLD, type Visitor } from './roam.ts';

/**
 * How the visitor's held input becomes a walk (garden/roam.drive.ts): walk keys pass through; the touch stick leads the
 * visitor by a walk target a little ahead in its direction (so props are walked round by the detour logic) and sets
 * the pace by how far it is pushed; Shift held is a brisk walk (roam.ts's pace: a faster walk, the gait advanced by the ground covered). Input
 * held while the body has barely moved for STRIDE.stuckS is a visitor wedged on a prop: a short rescue walks it toward
 * a point further along the held direction, round props, before the held input takes over again. No allocation.
 */

export const STRIDE = {
  brisk: 1.45,
  /** The stick's walk target leads the visitor by this far (m): far enough that the walk never slows to arrive. */
  leadM: 1,
  /** Under this share of the stick's throw the visitor stands; the pace starts at minPace past it. */
  deadZone: 0.18,
  minPace: 0.35,
  stuckS: 3,
  stuckMps: 0.08,
  /** The rescue walks toward a point this far (m) along the held direction for at most this long (s). */
  rescueM: 2.6,
  rescueS: 1.2,
} as const;

export interface Stride {
  /** The touch stick on screen: x right, y down, length 0..1; (0, 0) lets go. */
  stick(x: number, y: number): void;
  setBrisk(on: boolean): void;
  setHeld(bits: number): void;
  /** Steps the visitor (when no assisted move carries it) under the camera's yaw. */
  step(dt: number, yaw: number): void;
}

/** `steered` hears every held input that steers (a walk key or the stick pushed): it ends a walk to a Tab-reached slot. */
export function createStride(visitor: Visitor, steered: () => void): Stride {
  const pos = visitor.pos;
  let held = 0;
  let sx = 0;
  let sy = 0;
  let pace = 0;
  let brisk = false;
  let stuckS = 0;
  let rescueS = 0;
  let cos = 1;
  let sin = 0;
  /** The held direction in the world, unit length (0, 0 when none). */
  let wx = 0;
  let wz = 0;

  /** Screen direction (x right, y down) turned by the yaw into the world, as roam.ts turns held keys. */
  function aim(x: number, y: number): void {
    const d = Math.hypot(x, y);
    wx = d > 0 ? (x * cos - y * sin) / d : 0;
    wz = d > 0 ? (x * sin + y * cos) / d : 0;
  }

  function heldAim(): void {
    if (pace > 0) aim(sx, sy);
    else aim((held & HOLD.right ? 1 : 0) - (held & HOLD.left ? 1 : 0), (held & HOLD.down ? 1 : 0) - (held & HOLD.up ? 1 : 0));
  }

  function rescue(): void {
    stuckS = 0;
    if (wx === 0 && wz === 0) return;
    rescueS = STRIDE.rescueS;
    visitor.setHeld(0);
    visitor.walkTo(pos[0]! + wx * STRIDE.rescueM, pos[1]! + wz * STRIDE.rescueM);
  }

  return {
    stick(x, y) {
      const m = Math.min(1, Math.hypot(x, y));
      const was = pace > 0;
      pace = m < STRIDE.deadZone ? 0 : STRIDE.minPace + ((1 - STRIDE.minPace) * (m - STRIDE.deadZone)) / (1 - STRIDE.deadZone);
      sx = x;
      sy = y;
      if (pace > 0) steered();
      if (was && pace === 0) {
        rescueS = 0;
        stuckS = 0;
        visitor.halt();
      }
    },
    setBrisk(on) {
      brisk = on;
    },
    setHeld(bits) {
      if (bits !== 0) steered();
      held = bits;
      rescueS = 0;
      stuckS = 0;
      visitor.setHeld(bits);
    },
    step(dt, yaw) {
      cos = Math.cos(yaw);
      sin = Math.sin(yaw);
      heldAim();
      const rescuing = rescueS > 0;
      if (rescuing) {
        rescueS -= dt;
        if (rescueS <= 0) visitor.setHeld(held);
      } else if (pace > 0) {
        visitor.walkTo(pos[0]! + wx * STRIDE.leadM, pos[1]! + wz * STRIDE.leadM);
      }
      const x0 = pos[0]!;
      const z0 = pos[1]!;
      visitor.setPace((brisk ? STRIDE.brisk : 1) * (pace > 0 && !rescuing ? pace : 1));
      visitor.step(dt);
      const pushing = !rescuing && (held !== 0 || pace > 0);
      const crawl = dt > 0 && Math.hypot(pos[0]! - x0, pos[1]! - z0) / dt < STRIDE.stuckMps;
      stuckS = pushing && crawl ? stuckS + dt : 0;
      if (stuckS > STRIDE.stuckS) rescue();
    },
  };
}
