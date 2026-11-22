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

/** True when the point lies inside another box (inflated by r) than `skip`: such a detour corner cannot be stood on. */
function taken(boxes: Float32Array, r: number, x: number, z: number, skip: number): boolean {
  for (let i = 0; i + 3 < boxes.length; i += 4) {
    if (i !== skip && x > boxes[i]! - r && x < boxes[i + 2]! + r && z > boxes[i + 1]! - r && z < boxes[i + 3]! + r) return true;
  }
  return false;
}

/** True when the segment a to b enters a box (inflated by r) other than `skip`: a side leg there runs into a neighbour. */
function crosses(boxes: Float32Array, r: number, ax: number, az: number, bx: number, bz: number, skip: number): boolean {
  for (let i = 0; i + 3 < boxes.length; i += 4) if (i !== skip && entryOf(boxes, i, r, ax, az, bx, bz) >= 0) return true;
  return false;
}

const within = (b: Bounds, r: number, x: number, z: number): boolean => x >= b.minX + r && x <= b.maxX - r && z >= b.minZ + r && z <= b.maxZ - r;
const cornerX = (boxes: Float32Array, i: number, r: number, k: number): number =>
  k === 0 || k === 3 ? boxes[i]! - r - CORNER_M : boxes[i + 2]! + r + CORNER_M;
const cornerZ = (boxes: Float32Array, i: number, r: number, k: number): number =>
  k < 2 ? boxes[i + 1]! - r - CORNER_M : boxes[i + 3]! + r + CORNER_M;

const group = new Float32Array(4);

/** Writes into `group` box i grown over every box too near it for the body to pass between: walked round as one. */
function gather(boxes: Float32Array, i: number, r: number): void {
  for (let k = 0; k < 4; k++) group[k] = boxes[i + k]!;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j + 3 < boxes.length; j += 4) {
      if (boxes[j]! - r >= group[2]! + r || boxes[j + 2]! + r <= group[0]! - r || boxes[j + 1]! - r >= group[3]! + r || boxes[j + 3]! + r <= group[1]! - r) continue;
      group[0] = Math.min(group[0]!, boxes[j]!);
      group[1] = Math.min(group[1]!, boxes[j + 1]!);
      group[2] = Math.max(group[2]!, boxes[j + 2]!);
      group[3] = Math.max(group[3]!, boxes[j + 3]!);
    }
  }
}
const inGroup = (r: number, x: number, z: number): boolean => x > group[0]! - r && x < group[2]! + r && z > group[1]! - r && z < group[3]! + r;

/**
 * Writes into out where a walk from p to t heads now: t itself when no box is in the way, else the corner of the first
 * box in the way that starts the shortest route round it, one or two corners long. Props standing too close for the
 * body to pass between count as one box, unless p or t lies in the gap: then a second corner inside a neighbour, or a
 * side leg into one, is no route either (two props standing together). Corners outside `bounds` or inside another
 * box are no route; with none left it heads straight at t and the stall give-up ends the walk.
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
  gather(boxes, box, r);
  const joined = !inGroup(r, px, pz) && !inGroup(r, tx, tz);
  const from = joined ? group : boxes;
  const at = joined ? 0 : box;
  let best = Infinity;
  for (let k = 0; k < 4; k++) {
    const cx = cornerX(from, at, r, k);
    const cz = cornerZ(from, at, r, k);
    const lead = Math.hypot(cx - px, cz - pz);
    if (lead < REACHED_M || !within(bounds, r, cx, cz) || taken(boxes, r, cx, cz, joined ? -1 : box) || entryOf(from, at, r, px, pz, cx, cz) >= 0) continue;
    let rest = entryOf(from, at, r, cx, cz, tx, tz) < 0 ? Math.hypot(tx - cx, tz - cz) : Infinity;
    for (let j = 1; j < 4; j += 2) {
      const n = (k + j) % 4;
      const nx = cornerX(from, at, r, n);
      const nz = cornerZ(from, at, r, n);
      if (!within(bounds, r, nx, nz) || entryOf(from, at, r, nx, nz, tx, tz) >= 0) continue;
      if (!joined && (taken(boxes, r, nx, nz, box) || crosses(boxes, r, cx, cz, nx, nz, box))) continue;
      rest = Math.min(rest, Math.hypot(nx - cx, nz - cz) + Math.hypot(tx - nx, tz - nz));
    }
    if (lead + rest < best) {
      best = lead + rest;
      out[0] = cx;
      out[1] = cz;
    }
  }
}
