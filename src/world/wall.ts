import type { AtlasManifest, CutoutBatch, QuadParams } from '../types.ts';
import { WALL_STRIDE, type GroundBuild } from './ground.ts';
import { QUAD_FLAG, packPhase } from './quadflags.ts';

/**
 * The garden wall (cook/ART.md section 1): toy theatre flats and piers standing at the wall line, each one quad of the
 * shared stone tile (its own page), yawed alternately, with a row of coping stones on top. Each flat shows its own
 * window of the tile, mirrored on every other flat, and its own shade, so the wall never reads as one repeated tile.
 * One instanced batch, painted before every bed. Load time only.
 */

export const WALL_TILE = 'tile/wall';
/** Piers stand a little proud of the flats; flats overlap so their yaw never opens a seam onto the sky. */
const PIER_PROUD = 0.25;
const OVERLAP = 0.18;
/** The wall sits back in the place shadow, printed darker and cooler (indigo, not violet) than the plants. */
const WALL_TINT = [0.8, 0.78, 0.52] as const;
/** Shade jitter per flat (fraction of the tint). */
const SHADE_JITTER = 0.14;
/** Share of the tile each flat shows, at a per-flat offset. */
const WINDOW = 0.72;
/** Coping: a band of the tile's top course, overhanging the flat, catching the moon. */
const COPING = { h: 0.16, overhang: 0.07, proud: 0.06, band: 0.1, tint: [1, 0.96, 0.7] } as const;

function hash01(i: number, salt: number): number {
  let n = Math.imul(i ^ salt, 0x27d4eb2d);
  n = Math.imul(n ^ (n >>> 15), 0x165667b1);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967295;
}

/** Sub-rectangle of `r` (u0, v0, u1, v1), mirrored when `flip`. */
function windowOf(r: ArrayLike<number>, i: number, flip: boolean, out: Float32Array): Float32Array {
  const u0 = r[0] ?? 0;
  const v0 = r[1] ?? 0;
  const du = (r[2] ?? 1) - u0;
  const dv = (r[3] ?? 1) - v0;
  const ou = u0 + du * (1 - WINDOW) * hash01(i, 0x3a);
  const ov = v0 + dv * (1 - WINDOW) * hash01(i, 0x5b);
  const a = ou;
  const b = ou + du * WINDOW;
  out[0] = flip ? b : a;
  out[1] = ov;
  out[2] = flip ? a : b;
  out[3] = ov + dv * WINDOW;
  return out;
}

export function writeWall(g: GroundBuild, wallZ: number, m: AtlasManifest, createBatch: (page: number, capacity: number) => CutoutBatch): CutoutBatch | null {
  const rect = m.sprites[WALL_TILE];
  if (g.wallCount === 0 || rect === undefined) return null;
  const batch = createBatch(rect.page, g.wallCount * 2);
  const uv = new Float32Array(4);
  const tint = new Float32Array(4);
  const q: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0, py: 0, uv, sway: 0, phase: 0, lift: 0, facing: 0, tint };
  q.phase = packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.noShadow);
  const ru = rect.uv;
  const bandV = ((ru[3] ?? 1) - (ru[1] ?? 0)) * COPING.band;
  let n = 0;
  for (let i = 0; i < g.wallCount; i++) {
    const o = i * WALL_STRIDE;
    const pier = (g.wall[o + 4] ?? 0) > 0.5;
    const x0 = (g.wall[o] ?? 0) - (pier ? 0 : OVERLAP / 2);
    const w = (g.wall[o + 1] ?? 0) - x0 + (pier ? 0 : OVERLAP / 2);
    const h = g.wall[o + 3] ?? 0;
    const z = wallZ + (pier ? PIER_PROUD : 0);
    const shade = 1 + SHADE_JITTER * (2 * hash01(i, 0x71) - 1);
    q.facing = g.wall[o + 2] ?? 0;

    q.x = x0;
    q.y = 0;
    q.z = z;
    q.w = w;
    q.h = h;
    windowOf(ru, i, i % 2 === 1, uv);
    for (let c = 0; c < 3; c++) tint[c] = (WALL_TINT[c] ?? 1) * shade;
    tint[3] = 1;
    batch.writer.set(n++, q);

    if (h <= COPING.h) continue;
    q.x = x0 - COPING.overhang;
    q.y = h - COPING.h * 0.5;
    q.z = z + COPING.proud;
    q.w = w + 2 * COPING.overhang;
    q.h = COPING.h;
    uv[0] = ru[0] ?? 0;
    uv[2] = ru[2] ?? 1;
    uv[3] = ru[3] ?? 1;
    uv[1] = uv[3] - bandV;
    for (let c = 0; c < 3; c++) tint[c] = (COPING.tint[c] ?? 1) * shade;
    batch.writer.set(n++, q);
  }
  batch.writer.count = n;
  batch.writer.commit(0, n);
  return batch;
}
