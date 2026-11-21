import type { EnclosureData } from './layout.ts';

/**
 * The closed garden of free roam as solid masonry (cook/ROAM_ART.md section 3): a straight back wall with a doorway at the
 * Salida under a stone lintel, two end walls, a low kerb along the front, square piers at the corners, along the back
 * wall and at both jambs of the doorway. Every run is a block THICK deep behind its face on a mossy base course, under a
 * coping that overhangs it. Built at load, only under free roam, as blocks for gl/masonry.ts: the rail keeps its own
 * wall (wall.ts).
 *
 * No two faces ever lie in one plane: every run's end is buried in a pier, a pier's top in its cap, a wall's top in its
 * coping, and the corner piers stand a step above the jamb and wall piers.
 */

/**
 * A straight run of wall from (x, z) along (cos yaw, -sin yaw), facing (sin yaw, cos yaw), len long and h high. Its stone
 * starts at `from`: 0 stands on the ground, above 0 is a lintel over an opening. A pier is a square column `len` on a side
 * whose front face is the run's face.
 */
export interface Run { x: number; z: number; yaw: number; len: number; h: number; from: number; pier: boolean }

/** The masonry's depth behind every face (m). */
export const THICK = 0.45;
/** Height of the Salida doorway under its lintel; the hedge behind it (enclosure.hedge.top) stands at least this high. */
export const DOOR_TOP = 2.3;
/** Piers stand this far proud of the wall on both faces, and this far above the coping's top. */
const PIER_PROUD = 0.12;
const PIER_S = THICK + 2 * PIER_PROUD;
const PIER_RISE = 0.22;
/** The corner piers stand a step above the others and are a little stouter, so piers that meet never share a face. */
const CORNER_STEP = 0.05;
const CORNER_S = PIER_S + 0.06;
/** A back wall stretch stops this far inside the jamb pier, so its end face never meets the pier's face in the opening. */
const JAMB_IN = 0.05;
/** A listed pier this much more than a pier's width near a corner, a jamb or the pier before it is left out (no slot of sky between two piers). */
const SNAP = 0.6;
/** Every block starts this far under the ground: the bank behind the path is at most 0.15 m high. */
const SINK = 0.25;
/** The base course stands proud of the face (a foot), and the wall stone starts this far down inside it. */
const BASE = { proud: 0.04, under: 0.05 } as const;
/** The coping course: height, overhang past both faces, and how far it reaches down over the wall's top. */
export const COPING = { h: 0.16, overhang: 0.07 } as const;
/** A pier's cap: overhang past the pier and height. */
const CAP = { overhang: 0.05, h: 0.1 } as const;
const DEG = Math.PI / 180;

/** Floats per block: centre x, bottom y, centre z, width (local x), height, depth (local z), yaw. */
export const BLOCK = 7;

/** The closed garden's blocks, one list per stone: wall stone, base course, coping. */
export interface Masonry { stone: Float32Array; base: Float32Array; coping: Float32Array }

/**
 * Each stone's atlas tile and tint: the wall warmer than the rail's (wall.ts WALL_TINT) at about its value, so the dusk
 * keeps it far; the base course mossy and darker; the coping pale and warm, catching the moon.
 */
export const STONES = {
  stone: { tile: 'tile/wall', tint: [0.8, 0.74, 0.64] },
  base: { tile: 'tile/wall-base', tint: [0.62, 0.64, 0.58] },
  coping: { tile: 'tile/coping', tint: [1, 0.97, 0.88] },
} as const satisfies Record<keyof Masonry, { tile: string; tint: readonly [number, number, number] }>;

/** Wall height on the back line at x: full, a low stretch, or 0 in the door gap. */
export function backHeightAt(e: EnclosureData, wallH: number, x: number): number {
  if (x > e.door[0] && x < e.door[1]) return 0;
  for (const [x0, x1, h] of e.low) if (x >= x0 && x <= x1) return h;
  return wallH;
}

const pierAt = (cx: number, cz: number, h: number, s = PIER_S): Run => ({ x: cx - s / 2, z: cz + s / 2, yaw: 0, len: s, h, from: 0, pier: true });

/** Every run of the closed garden: back wall stretches, the lintel, end walls, the front kerb, then the piers. */
export function enclosureRuns(e: EnclosureData, wallZ: number, wallH: number): Run[] {
  const [x0, x1] = e.x;
  const [d0, d1] = e.door;
  const left = x0 - THICK;
  const right = x1 + THICK;
  const cutsAt = [left, ...e.low.flatMap(([a, b]) => [a, b]), d0 - JAMB_IN, d1 + JAMB_IN, right].sort((a, b) => a - b);
  const runs: Run[] = [];
  for (let i = 0; i + 1 < cutsAt.length; i++) {
    const a = cutsAt[i] as number;
    const b = cutsAt[i + 1] as number;
    const h = a >= d0 - JAMB_IN - 1e-6 && b <= d1 + JAMB_IN + 1e-6 ? 0 : backHeightAt(e, wallH, (a + b) / 2);
    if (h > 0 && b - a > 1e-3) runs.push({ x: a, z: wallZ, yaw: 0, len: b - a, h, from: 0, pier: false });
  }
  runs.push({ x: d0 - PIER_S / 2, z: wallZ, yaw: 0, len: d1 - d0 + PIER_S, h: wallH, from: DOOR_TOP, pier: false });
  runs.push({ x: x0, z: e.front, yaw: 90 * DEG, len: e.front - wallZ, h: e.endH, from: 0, pier: false });
  runs.push({ x: x1, z: wallZ, yaw: -90 * DEG, len: e.front - wallZ, h: e.endH, from: 0, pier: false });
  runs.push({ x: x0, z: e.front, yaw: 0, len: x1 - x0, h: e.kerbH, from: 0, pier: false });

  const top = (h: number): number => h + COPING.h / 2 + PIER_RISE;
  const midZ = wallZ - THICK / 2;
  let last = -Infinity;
  for (const px of [...e.piers].sort((a, b) => a - b)) {
    const near = Math.min(Math.abs(px - x0), Math.abs(px - x1), Math.abs(px - d0), Math.abs(px - d1), px - last);
    if (near < SNAP + PIER_S) continue;
    last = px;
    runs.push(pierAt(px, midZ, top(Math.max(backHeightAt(e, wallH, px - PIER_S), backHeightAt(e, wallH, px + PIER_S)))));
  }
  // The jamb piers' plinths are the doorway's edges, so the gate's pins stand clear of them.
  const jamb = PIER_S / 2 + BASE.proud;
  runs.push(pierAt(d0 - jamb, midZ, top(wallH)), pierAt(d1 + jamb, midZ, top(wallH)));
  const corner = top(Math.max(wallH, e.endH)) + CORNER_STEP;
  for (const cx of [x0 - THICK / 2, x1 + THICK / 2]) runs.push(pierAt(cx, midZ, corner, CORNER_S), pierAt(cx, e.front - THICK / 2, top(e.endH) + CORNER_STEP, CORNER_S));
  return runs;
}

/** Appends one block in the run's frame: x along the run, z out of its face (negative behind it), y up. */
function block(out: number[], r: Run, xa: number, xb: number, za: number, zb: number, ya: number, yb: number): void {
  if (xb - xa < 1e-4 || yb - ya < 1e-4) return;
  const cos = Math.cos(r.yaw);
  const sin = Math.sin(r.yaw);
  const u = (xa + xb) / 2;
  const v = (za + zb) / 2;
  out.push(r.x + u * cos + v * sin, ya, r.z - u * sin + v * cos, xb - xa, yb - ya, zb - za, r.yaw);
}

/** The blocks of every run: stone over a base course of height baseH, coping on walls and caps on piers. */
export function masonryOf(runs: readonly Run[], baseH: number): Masonry {
  const stone: number[] = [];
  const base: number[] = [];
  const coping: number[] = [];
  for (const r of runs) {
    if (r.pier) {
      const p = BASE.proud;
      block(base, r, -p, r.len + p, -r.len - p, p, -SINK, baseH + 0.1);
      block(stone, r, 0, r.len, -r.len, 0, baseH, r.h);
      const o = CAP.overhang;
      block(coping, r, -o, r.len + o, -r.len - o, o, r.h - 0.02, r.h + CAP.h - 0.02);
      continue;
    }
    const copeY = r.h - COPING.h / 2;
    if (r.from === 0) block(base, r, 0, r.len, -THICK - BASE.proud, BASE.proud, -SINK, Math.min(baseH, copeY));
    block(stone, r, 0, r.len, -THICK, 0, r.from === 0 ? baseH - BASE.under : r.from, copeY + 0.02);
    const o = COPING.overhang;
    block(coping, r, 0, r.len, -THICK - o, o, copeY, r.h + COPING.h / 2);
  }
  return { stone: new Float32Array(stone), base: new Float32Array(base), coping: new Float32Array(coping) };
}
