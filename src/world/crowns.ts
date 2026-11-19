import type { AtlasManifest, CutoutBatch, QuadParams } from '../types.ts';
import type { EnclosureData } from './layout.ts';
import { QUAD_FLAG, packPhase } from './quadflags.ts';
import { hash01 } from './wall.ts';

/**
 * What stands beyond the back wall under free roam (cook/ROAM_ART.md section 3, task 4): three groups of tree crowns
 * from the shipped ov/trees plates, far and cool, and a clipped hedge strip behind the two low stretches, cut in code
 * from the solid part of the v/hedge plate so the ground beyond never shows over the parapets. One batch each (crowns
 * on shared page 0, the hedge on page 1), both painted before the wall. Built at load, only under free roam.
 */

const HEDGE_SPRITE = 'v/hedge';
/**
 * The solid leafy part of the hedge plate, as shares of its rect: left of the arch, under the pale scratch halfway up the
 * plate (repeated on every piece it read as a row of magenta dashes after the grade).
 */
const HEDGE_CROP = { u: [0.04, 0.28], v: [0.02, 0.42] } as const;
/**
 * Pieces overlap by `overlap` and alternate in depth, so no straight vertical seam lines up across the strip. The strip
 * stands low and leafy over the parapets, a step lighter than the plate, so it reads as dark foliage, not a black slab.
 */
const HEDGE = { quadW: 0.85, overlap: 0.3, stagger: 0.12, jitter: 0.08, tint: [0.82, 0.96, 0.86] } as const;
/** Far things are cooler (cook/ROAM_ART.md depth rule); the view-depth haze lifts them further. */
const CROWN_TINT = [0.82, 0.82, 0.96] as const;

function quadOf(tint: Float32Array, uv: Float32Array): QuadParams {
  tint[3] = 1;
  return { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0, py: 0, uv, sway: 0, phase: packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.noShadow), lift: 0, facing: 0, tint };
}

/** The crown groups, far to near (paint order: the cutout material has no depth). */
export function writeCrowns(e: EnclosureData, m: AtlasManifest, createBatch: (page: number, capacity: number) => CutoutBatch): CutoutBatch | null {
  const spots = e.crowns.filter((c) => m.sprites[c.sprite] !== undefined).sort((a, b) => a.z - b.z);
  const first = spots[0];
  if (first === undefined) return null;
  const page = m.sprites[first.sprite]?.page ?? 0;
  const batch = createBatch(page, spots.length);
  const tint = new Float32Array(4);
  const q = quadOf(tint, new Float32Array(4));
  for (let c = 0; c < 3; c++) tint[c] = CROWN_TINT[c] ?? 1;
  let n = 0;
  for (const s of spots) {
    const rect = m.sprites[s.sprite];
    if (rect === undefined || rect.page !== page) continue;
    const k = s.h / rect.size[1];
    q.x = s.x;
    q.z = s.z;
    q.w = rect.size[0] * k;
    q.h = s.h;
    q.px = rect.pivot[0];
    q.py = rect.pivot[1];
    q.uv = rect.uv;
    batch.writer.set(n++, q);
  }
  batch.writer.count = n;
  batch.writer.commit(0, n);
  return batch;
}

/** The hedge strip: narrow quads of the solid hedge, alternate ones mirrored, their tops jittered. */
export function writeHedge(e: EnclosureData, m: AtlasManifest, createBatch: (page: number, capacity: number) => CutoutBatch): CutoutBatch | null {
  const rect = m.sprites[HEDGE_SPRITE];
  if (rect === undefined) return null;
  const counts = e.hedge.spans.map(([a, b]) => Math.max(1, Math.ceil((b - a) / HEDGE.quadW)));
  const batch = createBatch(rect.page, counts.reduce((s, c) => s + c, 0));
  const uv = new Float32Array(4);
  const tint = new Float32Array(4);
  const q = quadOf(tint, uv);
  for (let c = 0; c < 3; c++) tint[c] = HEDGE.tint[c] ?? 1;
  const [ru0, rv0, ru1, rv1] = rect.uv;
  const ua = ru0 + (ru1 - ru0) * HEDGE_CROP.u[0];
  const ub = ru0 + (ru1 - ru0) * HEDGE_CROP.u[1];
  const va = rv0 + (rv1 - rv0) * HEDGE_CROP.v[0];
  const vb = rv0 + (rv1 - rv0) * HEDGE_CROP.v[1];
  let n = 0;
  e.hedge.spans.forEach(([a, b], s) => {
    const count = counts[s] ?? 1;
    const w = (b - a) / count;
    for (let i = 0; i < count; i++) {
      const mirrored = (n & 1) === 1;
      q.x = a + i * w - HEDGE.overlap / 2;
      q.z = e.hedge.z - (mirrored ? HEDGE.stagger : 0);
      q.w = w + HEDGE.overlap;
      q.h = e.hedge.top + HEDGE.jitter * (hash01(n, 0x4e) - 0.5);
      uv[0] = mirrored ? ub : ua;
      uv[2] = mirrored ? ua : ub;
      uv[1] = va;
      uv[3] = vb;
      batch.writer.set(n++, q);
    }
  });
  batch.writer.count = n;
  batch.writer.commit(0, n);
  return batch;
}
