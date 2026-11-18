import type { BedId } from '../types.ts';
import { ROAM } from '../core/motion.ts';
import type { BedScene3, EnclosureData } from './layout.ts';
import { builtIn } from './mode.ts';

/**
 * Tall cards the visitor could walk behind (cook/ROAM_ART.md section 3 follow-up): seen from the follow camera, a card
 * of height H at distance d in front of the visitor covers the visitor while d is under back * H / up (the camera's
 * offset and height), and always once H reaches the camera. Each named card blocks that strip north of it, as wide as
 * the card plus a margin, so the visitor is never hidden. Position and height come from the bed's own item as free roam
 * builds it (its roam variant where one exists), so the strip follows the art; only the card's width to height ratio is
 * listed in garden.json.
 */

/** Extra width each side of the card (m): standees turn a little and the camera may sit off the visitor near the ends. */
const SIDE_MARGIN = 0.35;

export function occluderBlocks(e: EnclosureData, scenes: Readonly<Record<BedId, BedScene3>>, back: number, up: number): Float32Array {
  const out: number[] = [];
  for (const o of e.occluders) {
    for (const l of scenes[o.bed].layers) {
      for (const it of l.items) {
        if (it.sprite !== o.sprite || !builtIn(it, 'roam')) continue;
        const top = it.y + (it.h ?? 0) * it.scale;
        const half = ((it.h ?? 0) * it.scale * o.aspect) / 2 + SIDE_MARGIN;
        const depth = top >= up ? back : (back * top) / up;
        const z0 = Math.max(e.walk.minZ - ROAM.radius, it.z - depth);
        if (it.z <= z0) continue;
        // A strip that leaves less than a body's width to a side of the walk area closes that gap too.
        const x0 = it.x - half - 2 * ROAM.radius < e.walk.minX ? e.walk.minX - ROAM.radius : it.x - half;
        const x1 = it.x + half + 2 * ROAM.radius > e.walk.maxX ? e.walk.maxX + ROAM.radius : it.x + half;
        out.push(x0, z0, x1, it.z);
      }
    }
  }
  return new Float32Array(out);
}
