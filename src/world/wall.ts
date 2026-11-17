import type { AtlasManifest, CutoutBatch, QuadParams } from '../types.ts';
import { WALL_STRIDE, type GroundBuild } from './ground.ts';
import { QUAD_FLAG, packPhase } from './quadflags.ts';

/**
 * The garden wall (cook/ART.md section 1): toy theatre flats and piers standing at the wall line, each one quad of the
 * shared stone tile (its own page, uv 0..1), yawed alternately. One instanced batch, painted before every bed.
 */

export const WALL_TILE = 'tile/wall';
/** Piers stand a little proud of the flats; flats overlap so their yaw never opens a seam onto the sky. */
const PIER_PROUD = 0.25;
const OVERLAP = 0.18;
/** The wall sits back in the place shadow: its stone is printed darker than the plants in front of it. */
const WALL_TINT = [0.5, 0.48, 0.52, 1] as const;

export function writeWall(g: GroundBuild, wallZ: number, m: AtlasManifest, createBatch: (page: number, capacity: number) => CutoutBatch): CutoutBatch | null {
  const rect = m.sprites[WALL_TILE];
  if (g.wallCount === 0 || rect === undefined) return null;
  const batch = createBatch(rect.page, g.wallCount);
  const q: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0, py: 0, uv: rect.uv, sway: 0, phase: 0, lift: 0, facing: 0, tint: WALL_TINT };
  const flags = QUAD_FLAG.noLean | QUAD_FLAG.noShadow;
  for (let i = 0; i < g.wallCount; i++) {
    const o = i * WALL_STRIDE;
    const pier = (g.wall[o + 4] ?? 0) > 0.5;
    q.x = (g.wall[o] ?? 0) - (pier ? 0 : OVERLAP / 2);
    q.w = (g.wall[o + 1] ?? 0) - q.x + (pier ? 0 : OVERLAP / 2);
    q.facing = g.wall[o + 2] ?? 0;
    q.h = g.wall[o + 3] ?? 0;
    q.z = wallZ + (pier ? PIER_PROUD : 0);
    q.phase = packPhase(0, flags);
    batch.writer.set(i, q);
  }
  batch.writer.count = g.wallCount;
  batch.writer.commit(0, g.wallCount);
  return batch;
}
