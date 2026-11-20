import type { AtlasManifest, CutoutBatch, QuadParams } from '../types.ts';
import { bodySeed, takesBody, writeBody } from './body.ts';
import { CLUMP_STRIDE, type GroundBuild } from './ground.ts';
import { QUAD_FLAG, packPhase, turnFlag } from './quadflags.ts';

/**
 * Grass clumps (cook/ART.md section 1): each is three parallel blade cards 4 cm apart, leaning 6, 12 and 18 degrees,
 * never crossed quads; under the orbiting camera the middle card folds along its stem into a shallow V (body.ts), so a
 * clump keeps its body from the side. One instanced batch from the shared atlas. A clump sprite missing from the shared manifest draws
 * nothing. Species, height and tint vary per clump so no two neighbours repeat (cook/R02_FINDINGS.md 2). Clumps clear
 * of the wall foot turn as standees under free roam.
 */

const CARDS = 3;
/** The card that folds when the clump takes a body. */
const FOLDED = 1;
const GAP = 0.04;
const LEAN_DEG = [6, 12, 18] as const;
const DEG = Math.PI / 180;
/** Per-clump tints (viridian, olive, dusty rose-grey, moonlit straw), picked by a hash of the index so neighbours differ. */
const TINTS: readonly (readonly [number, number, number])[] = [[0.62, 0.78, 0.66], [0.78, 0.76, 0.52], [0.74, 0.62, 0.64], [0.9, 0.86, 0.72], [0.5, 0.64, 0.6]];
/** Free roam walks among the tufts: only live greens (fresh, olive, sap), so none reads as grey dead stalks. */
const ROAM_TINTS: readonly (readonly [number, number, number])[] = [[0.66, 0.8, 0.56], [0.8, 0.8, 0.5], [0.72, 0.84, 0.6], [0.86, 0.84, 0.56], [0.6, 0.76, 0.5]];

export function clumpSprite(m: AtlasManifest, variant: number): string | null {
  const id = `sh/clump-${variant + 1}`;
  return m.sprites[id] === undefined ? null : id;
}

export function writeClumps(g: GroundBuild, wallZ: number, m: AtlasManifest, createBatch: (page: number, capacity: number) => CutoutBatch): CutoutBatch | null {
  const first = clumpSprite(m, 0);
  if (g.clumpCount === 0 || first === null) return null;
  const page = m.sprites[first]?.page ?? 0;
  const bodied = takesBody(g.mode, g.tier);
  const batch = createBatch(page, g.clumpCount * (bodied ? CARDS + 1 : CARDS));
  const q: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0.5, py: 0, uv: [0, 0, 0, 0], sway: 0.04, phase: 0, lift: 0, facing: 0, tint: [1, 1, 1, 1] };
  const tints = g.mode === 'roam' ? ROAM_TINTS : TINTS;
  let at = 0;
  for (let i = 0; i < g.clumpCount; i++) {
    const o = i * CLUMP_STRIDE;
    const variant = g.clumps[o + 2] ?? 0;
    const id = clumpSprite(m, variant);
    const rect = id === null ? undefined : m.sprites[id];
    if (rect === undefined || rect.page !== page) continue;
    const h = g.clumps[o + 4] ?? 0.3;
    const side = (i * 7) % 3 === 0 ? -1 : 1;
    const tint = tints[(i * 5 + variant * 3) % tints.length] ?? tints[0];
    const flags = QUAD_FLAG.noShadow | turnFlag(g.clumps[o + 1] ?? 0, wallZ, true);
    for (let c = 0; c < 3; c++) (q.tint as number[])[c] = tint?.[c] ?? 1;
    for (let k = 0; k < CARDS; k++) {
      q.x = (g.clumps[o] ?? 0) + (k - 1) * 0.03;
      q.z = (g.clumps[o + 1] ?? 0) + (k - 1) * GAP;
      q.facing = g.clumps[o + 3] ?? 0;
      q.rot = side * (LEAN_DEG[k] ?? 0) * DEG;
      q.h = h * (1 - k * 0.12);
      q.w = q.h * (rect.size[0] / rect.size[1]);
      q.px = rect.pivot[0];
      q.py = rect.pivot[1];
      q.uv = rect.uv;
      q.phase = packPhase((i * 0.618034 + k * 0.3) * Math.PI * 2, flags);
      at += writeBody(batch.writer, at, q, bodied && k === FOLDED ? 'fold' : null, bodySeed(q.x, q.z));
    }
  }
  batch.writer.count = at;
  batch.writer.commit(0, at);
  return batch;
}
