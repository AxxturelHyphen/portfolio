/**
 * A room off the walk rectangle (the grotto behind the back wall): rectangles the visitor's body may also stand in,
 * joined to the garden through a doorway. The body stays inside the union of the walk rectangle and the rooms; a walk
 * target on the other side of the doorway line heads first for the doorway's near side, then its far side, so the walk
 * never runs into the wall beside it. Pure, no allocation.
 */

export interface Annex {
  /** Rectangles the body may stand in besides the walk rectangle, as x0, z0, x1, z1 per room; they overlap it and each other. */
  rooms: Float32Array;
  /** The doorway's centre line x, its line z (north of it is the room side) and the half width of its clear band (m). */
  door: { x: number; z: number; band: number };
  /** Where a walk heads before the doorway: outside (south of it) and inside (north), as z on the door's line x. */
  porchZ: number;
  innerZ: number;
}

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

/**
 * Pushes (x, z) in `pos` to the nearest point of the union of `walk` and the annex's rooms, each shrunk by r, and removes
 * the velocity that runs out of it. True when the point moved.
 */
export function clampToAreas(walk: Rect, annex: Annex, r: number, pos: Float32Array, vel: Float32Array): boolean {
  const x = pos[0]!;
  const z = pos[1]!;
  let bx = Math.min(walk.maxX - r, Math.max(walk.minX + r, x));
  let bz = Math.min(walk.maxZ - r, Math.max(walk.minZ + r, z));
  let best = (bx - x) ** 2 + (bz - z) ** 2;
  if (best === 0) return false;
  const rooms = annex.rooms;
  for (let i = 0; i + 3 < rooms.length; i += 4) {
    const cx = Math.min(rooms[i + 2]! - r, Math.max(rooms[i]! + r, x));
    const cz = Math.min(rooms[i + 3]! - r, Math.max(rooms[i + 1]! + r, z));
    const d = (cx - x) ** 2 + (cz - z) ** 2;
    if (d === 0) return false;
    if (d < best) {
      best = d;
      bx = cx;
      bz = cz;
    }
  }
  if (bx > x && vel[0]! < 0) vel[0] = 0;
  if (bx < x && vel[0]! > 0) vel[0] = 0;
  if (bz > z && vel[1]! < 0) vel[1] = 0;
  if (bz < z && vel[1]! > 0) vel[1] = 0;
  pos[0] = bx;
  pos[1] = bz;
  return true;
}

/**
 * Writes into aim the doorway point a walk from (x, z) to a target at tz must pass first, when the two lie on either side of
 * the doorway line: its near side until the body is in the clear band, then its far side. False when no waypoint is needed.
 */
export function annexAim(annex: Annex, x: number, z: number, tz: number, aim: Float32Array): boolean {
  const d = annex.door;
  const inside = z < d.z;
  if (inside === tz < d.z) return false;
  const inBand = Math.abs(x - d.x) <= d.band;
  const nearZ = inside ? annex.innerZ : annex.porchZ;
  const farZ = inside ? annex.porchZ : annex.innerZ;
  aim[0] = d.x;
  aim[1] = inBand ? farZ : nearZ;
  return true;
}
