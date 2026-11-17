import type { AtlasManifest, CutoutBatch, QuadParams } from '../types.ts';
import { WALL_STRIDE, type GroundBuild } from './ground.ts';
import { QUAD_FLAG, packPhase } from './quadflags.ts';

/**
 * The garden wall (cook/ART.md section 1): toy theatre flats and piers standing at the wall line, yawed alternately,
 * with a row of coping stones on top. The stone tile is laid at its real scale (the manifest size in metres): each flat
 * is cut into quads at the tile's period, every quad showing exactly its own metres of the seamless tile, so nothing is
 * stretched or squeezed (a narrow pier no longer squeezes 1.8 m of stone into streaks). The tile runs on
 * across the flats at its world position, so two flats meet on the same stones and their join shows no seam; the
 * period over the top course is mirrored in v, so the rows meet on the same texel line under the coping.
 * Each flat takes a slightly different shade. One instanced batch, painted before every bed. Load time only.
 */

export const WALL_TILE = 'tile/wall';
/** Piers stand a little proud of the flats; flats overlap so their yaw never opens a seam onto the sky. */
const PIER_PROUD = 0.25;
const OVERLAP = 0.4;
/**
 * The wall sits back in the place shadow as dark cool stone (a dark ground of cook/SHOTS.md B), never violet. The tile
 * is neutral stone (mean #626256): the tint darkens it and leans it a touch toward indigo, so the flowers carry the frame.
 */
const WALL_TINT = [0.76, 0.72, 0.68] as const;
/** Shade jitter per flat (fraction of the tint): small, so neighbouring flats never meet on a light-dark line. */
const SHADE_JITTER = 0.04;
/** The tile's outer texels fade in alpha (page border, mips): each quad stays this share of the tile inside it. */
const BORDER = 0.004;
/** World x where the tile starts: left of the first flat, so every offset is positive. */
const TILE_ORIGIN_X = -60;
/** Coping: a band of the tile's top course, overhanging the flat, catching the moon rim (brighter, warm). */
const COPING = { h: 0.16, overhang: 0.07, proud: 0.06, tint: [1, 0.97, 0.88] } as const;

function hash01(i: number, salt: number): number {
  let n = Math.imul(i ^ salt, 0x27d4eb2d);
  n = Math.imul(n ^ (n >>> 15), 0x165667b1);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967295;
}

/**
 * Cuts [0, len) at the multiples of `period` past `offset`; calls back with each piece's start and end (metres), its
 * start inside the tile and whether its tile period is an odd one (mirrored).
 */
function cuts(len: number, offset: number, period: number, each: (a: number, b: number, t0: number, odd: boolean) => void): number {
  let n = 0;
  let a = 0;
  while (a < len - 1e-4) {
    const r = (offset + a) % period;
    const t0 = period - r < 1e-3 ? 0 : r;
    const b = Math.min(len, a + period - t0);
    each(a, b, t0, Math.floor((offset + a + 1e-3) / period) % 2 === 1);
    a = b;
    n++;
  }
  return n;
}

interface Piece { x0: number; w: number; h: number; z: number; facing: number; shade: number; ou: number; ov: number }

function pieceOf(g: GroundBuild, i: number, wallZ: number, out: Piece): Piece {
  const o = i * WALL_STRIDE;
  const pier = (g.wall[o + 4] ?? 0) > 0.5;
  out.x0 = (g.wall[o] ?? 0) - (pier ? 0 : OVERLAP / 2);
  out.w = (g.wall[o + 1] ?? 0) - out.x0 + (pier ? 0 : OVERLAP / 2);
  out.h = g.wall[o + 3] ?? 0;
  out.z = wallZ + (pier ? PIER_PROUD : 0);
  out.facing = g.wall[o + 2] ?? 0;
  out.shade = 1 + SHADE_JITTER * (2 * hash01(i, 0x71) - 1);
  out.ou = out.x0 - TILE_ORIGIN_X;
  out.ov = 0;
  return out;
}

export function writeWall(g: GroundBuild, wallZ: number, m: AtlasManifest, createBatch: (page: number, capacity: number) => CutoutBatch): CutoutBatch | null {
  const rect = m.sprites[WALL_TILE];
  if (g.wallCount === 0 || rect === undefined) return null;
  const tw = rect.size[0];
  const th = rect.size[1];
  const ru = rect.uv;
  const spanU = (ru[2] ?? 1) - (ru[0] ?? 0);
  const spanV = (ru[3] ?? 1) - (ru[1] ?? 0);
  const u0 = (ru[0] ?? 0) + spanU * BORDER;
  const v0 = (ru[1] ?? 0) + spanV * BORDER;
  const du = (spanU * (1 - 2 * BORDER)) / tw;
  const dv = (spanV * (1 - 2 * BORDER)) / th;
  const p: Piece = { x0: 0, w: 0, h: 0, z: 0, facing: 0, shade: 1, ou: 0, ov: 0 };
  const none = (): void => undefined;

  let capacity = 0;
  for (let i = 0; i < g.wallCount; i++) {
    pieceOf(g, i, wallZ, p);
    const cols = cuts(p.w, p.ou, tw, none);
    capacity += cols * cuts(p.h, p.ov, th, none) + cuts(p.w + 2 * COPING.overhang, p.ou, tw, none);
  }
  const batch = createBatch(rect.page, capacity);
  const uv = new Float32Array(4);
  const tint = new Float32Array(4);
  tint[3] = 1;
  const q: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0, py: 0, uv, sway: 0, phase: 0, lift: 0, facing: 0, tint };
  q.phase = packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.noShadow);
  let n = 0;
  let rowA = 0;
  let rowB = 0;
  let rowT = 0;
  let rowOdd = false;
  let baseZ = 0;
  // Columns step along the flat's own yawed direction (the shader yaws each quad about its own origin).
  const column = (a: number, b: number, t0: number): void => {
    q.x = p.x0 + a * Math.cos(p.facing);
    q.z = baseZ - a * Math.sin(p.facing);
    q.w = b - a;
    q.y = rowA;
    q.h = rowB - rowA;
    const s0 = t0;
    const s1 = t0 + b - a;
    const r0 = rowOdd ? th - rowT : rowT;
    const r1 = rowOdd ? th - rowT - (rowB - rowA) : rowT + rowB - rowA;
    uv[0] = u0 + s0 * du;
    uv[2] = u0 + s1 * du;
    uv[1] = v0 + r0 * dv;
    uv[3] = v0 + r1 * dv;
    batch.writer.set(n++, q);
  };
  for (let i = 0; i < g.wallCount; i++) {
    pieceOf(g, i, wallZ, p);
    q.facing = p.facing;
    baseZ = p.z;
    for (let c = 0; c < 3; c++) tint[c] = (WALL_TINT[c] ?? 1) * p.shade;
    cuts(p.h, p.ov, th, (a, b, t0, odd) => {
      rowA = a;
      rowB = b;
      rowT = t0;
      rowOdd = odd;
      cuts(p.w, p.ou, tw, column);
    });
    if (p.h <= COPING.h) continue;
    // Coping: the tile's top course at real scale, overhanging the flat.
    baseZ = p.z + COPING.proud;
    for (let c = 0; c < 3; c++) tint[c] = Math.min(1, (COPING.tint[c] ?? 1) * p.shade);
    rowA = p.h - COPING.h * 0.5;
    rowB = rowA + COPING.h;
    rowT = th - COPING.h;
    rowOdd = false;
    const x0 = p.x0;
    p.x0 = x0 - COPING.overhang;
    cuts(p.w + 2 * COPING.overhang, p.ou - COPING.overhang, tw, column);
    p.x0 = x0;
  }
  batch.writer.count = n;
  batch.writer.commit(0, n);
  return batch;
}
