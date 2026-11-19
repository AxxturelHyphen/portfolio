/**
 * Walk targets round solid props (world/roam.ts): a click walk whose straight line runs into a prop's box heads for a
 * corner of that box on the shorter way round, re-chosen every step, so the visitor slides past the prop instead of
 * stalling against it. Boxes are x0, z0, x1, z1 per prop, inflated here by the body radius. No allocation.
 */

/** How far outside the body-inflated box a detour corner sits (m), so the leg along a side never touches it. */
const CORNER_M = 0.12;
/** A corner this near (m) counts as reached: the route goes on from it. */
const REACHED_M = 0.05;
/** Shrinks the open box a line must enter to count as blocked: a body resting on a face may leave along it. */
const EPS = 1e-4;

/** The walk rectangle the body stays inside. */
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

/** Where the segment a to b first enters box i inflated by r (0..1), or -1 when it never enters the open box. */
export function entryOf(boxes: Float32Array, i: number, r: number, ax: number, az: number, bx: number, bz: number): number {
  let lo = 0;
  let hi = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const x0 = boxes[i]! - r + EPS;
  const z0 = boxes[i + 1]! - r + EPS;
  const x1 = boxes[i + 2]! + r - EPS;
  const z1 = boxes[i + 3]! + r - EPS;
  if (Math.abs(dx) < 1e-12) {
    if (ax <= x0 || ax >= x1) return -1;
  } else {
    const p = (x0 - ax) / dx;
    const q = (x1 - ax) / dx;
    lo = Math.max(lo, Math.min(p, q));
    hi = Math.min(hi, Math.max(p, q));
  }
  if (Math.abs(dz) < 1e-12) {
    if (az <= z0 || az >= z1) return -1;
  } else {
    const p = (z0 - az) / dz;
    const q = (z1 - az) / dz;
    lo = Math.max(lo, Math.min(p, q));
    hi = Math.min(hi, Math.max(p, q));
  }
  return lo < hi ? lo : -1;
}

/**
 * The share (0..1) of the way from a to b where the walk must stop so that b, if it lies in a box, is not entered:
 * the earliest entry into a box holding b, or 1 when b is clear.
 */
export function reachOf(boxes: Float32Array, r: number, ax: number, az: number, bx: number, bz: number): number {
  let s = 1;
  for (let i = 0; i + 3 < boxes.length; i += 4) {
    if (bx <= boxes[i]! - r || bx >= boxes[i + 2]! + r || bz <= boxes[i + 1]! - r || bz >= boxes[i + 3]! + r) continue;
    const e = entryOf(boxes, i, r, ax, az, bx, bz);
    if (e >= 0) s = Math.min(s, e);
  }
  return s;
}

const within = (b: Bounds, r: number, x: number, z: number): boolean => x >= b.minX + r && x <= b.maxX - r && z >= b.minZ + r && z <= b.maxZ - r;
const cornerX = (boxes: Float32Array, i: number, r: number, k: number): number =>
  k === 0 || k === 3 ? boxes[i]! - r - CORNER_M : boxes[i + 2]! + r + CORNER_M;
const cornerZ = (boxes: Float32Array, i: number, r: number, k: number): number =>
  k < 2 ? boxes[i + 1]! - r - CORNER_M : boxes[i + 3]! + r + CORNER_M;

/**
 * Writes into out where a walk from p to t heads now: t itself when no box is in the way, else the corner of the first
 * box in the way that starts the shortest route round it, one or two corners long.
 * Corners outside `bounds` are no route; with none left it heads straight at t and the stall give-up ends the walk.
 */
export function detour(boxes: Float32Array, r: number, bounds: Bounds, px: number, pz: number, tx: number, tz: number, out: Float32Array): void {
  out[0] = tx;
  out[1] = tz;
  let box = -1;
  let first = 2;
  for (let i = 0; i + 3 < boxes.length; i += 4) {
    const e = entryOf(boxes, i, r, px, pz, tx, tz);
    if (e >= 0 && e < first) {
      first = e;
      box = i;
    }
  }
  if (box < 0) return;
  let best = Infinity;
  for (let k = 0; k < 4; k++) {
    const cx = cornerX(boxes, box, r, k);
    const cz = cornerZ(boxes, box, r, k);
    const lead = Math.hypot(cx - px, cz - pz);
    if (lead < REACHED_M || !within(bounds, r, cx, cz) || entryOf(boxes, box, r, px, pz, cx, cz) >= 0) continue;
    let rest = entryOf(boxes, box, r, cx, cz, tx, tz) < 0 ? Math.hypot(tx - cx, tz - cz) : Infinity;
    for (let j = 1; j < 4; j += 2) {
      const n = (k + j) % 4;
      const nx = cornerX(boxes, box, r, n);
      const nz = cornerZ(boxes, box, r, n);
      if (within(bounds, r, nx, nz) && entryOf(boxes, box, r, nx, nz, tx, tz) < 0) rest = Math.min(rest, Math.hypot(nx - cx, nz - cz) + Math.hypot(tx - nx, tz - nz));
    }
    if (lead + rest < best) {
      best = lead + rest;
      out[0] = cx;
      out[1] = cz;
    }
  }
}
