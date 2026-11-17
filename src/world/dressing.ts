import type { AtlasManifest, CutoutBatch, QuadParams, SpriteRect } from '../types.ts';
import { clumpSprite } from './clumps.ts';
import { DRESS_KIND, DRESS_STRIDE, type GroundBuild } from './ground.ts';
import { QUAD_FLAG, packPhase } from './quadflags.ts';

/**
 * The near-ground dressing (cook/LOOK_NOTES.md 4): grass clumps, a low leafy plant, its leaves lying flat as litter
 * and fallen petals, all from the shared atlas, in one instanced batch painted over the beds (pieces are sorted far
 * to near, the material has no depth). Standing pieces cast their contact shadow; flat ones lie on the ground.
 * Nearer pieces are mixed toward the night shade so the foreground frames the picture instead of competing with it.
 */

const CLUMP_CARDS = 2;
const DEG = Math.PI / 180;
/** The night colour the nearest pieces are mixed toward (ART.md 2.2 wall in shade). */
const NIGHT = [0.15, 0.12, 0.24] as const;
/** Below this shade a piece reads as foreground framing (a near silhouette). */
const NEAR_SHADE = 0.5;
const PETALS = ['sh/petal-1', 'sh/petal-2', 'sh/petal-3'] as const;

function spriteOf(m: AtlasManifest, kind: number, i: number): string | null {
  if (kind < DRESS_KIND.leafy) return clumpSprite(m, kind - DRESS_KIND.clump);
  if (kind === DRESS_KIND.petal) return PETALS[i % PETALS.length] ?? null;
  return 'sh/ivy';
}

export function writeDressing(g: GroundBuild, m: AtlasManifest, createBatch: (page: number, capacity: number) => CutoutBatch): CutoutBatch | null {
  const probe = m.sprites['sh/ivy'];
  if (g.dressCount === 0 || probe === undefined) return null;
  const page = probe.page;
  const batch = createBatch(page, g.dressCount * CLUMP_CARDS);
  const tint: [number, number, number, number] = [1, 1, 1, 1];
  const q: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0.5, py: 0, uv: [0, 0, 0, 0], sway: 0, phase: 0, lift: 0, facing: 0, tint };
  let at = 0;
  for (let i = 0; i < g.dressCount; i++) {
    const o = i * DRESS_STRIDE;
    const kind = g.dress[o + 2] ?? 0;
    const id = spriteOf(m, kind, i);
    const rect: SpriteRect | undefined = id === null ? undefined : m.sprites[id];
    if (rect === undefined || rect.page !== page) continue;
    const shade = g.dress[o + 5] ?? 1;
    for (let c = 0; c < 3; c++) tint[c] = (NIGHT[c] ?? 0) + (1 - (NIGHT[c] ?? 0)) * shade * shade;
    const flat = kind === DRESS_KIND.litter || kind === DRESS_KIND.petal;
    const cards = kind < DRESS_KIND.leafy ? CLUMP_CARDS : 1;
    const h = g.dress[o + 4] ?? 0.3;
    const side = i % 2 === 0 ? 1 : -1;
    /** The nearest pieces are true dark framing: their night tint is applied uncapped. */
    const flags = (flat ? QUAD_FLAG.flat | QUAD_FLAG.noShadow : 0) | (shade < NEAR_SHADE ? QUAD_FLAG.silhouette : 0);
    for (let k = 0; k < cards; k++) {
      q.x = (g.dress[o] ?? 0) + k * 0.05 * side;
      q.y = 0;
      q.z = (g.dress[o + 1] ?? 0) + k * 0.03;
      q.facing = g.dress[o + 3] ?? 0;
      q.rot = flat ? (g.dress[o + 3] ?? 0) * 3 : side * (6 + 10 * k) * DEG;
      q.h = h * (1 - k * 0.15);
      q.w = q.h * (rect.size[0] / rect.size[1]) * (side < 0 && !flat ? -1 : 1);
      q.px = rect.pivot[0];
      q.py = rect.pivot[1];
      q.uv = rect.uv;
      q.sway = flat ? 0 : 0.03;
      q.phase = packPhase((i * 0.618034 + k * 0.3) * Math.PI * 2, flags);
      batch.writer.set(at++, q);
    }
  }
  batch.writer.count = at;
  batch.writer.commit(0, at);
  return batch;
}
