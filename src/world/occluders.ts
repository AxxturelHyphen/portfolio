import type { BedId } from '../types.ts';
import { ROAM } from '../core/motion.ts';
import { framingFor, type Framing } from './follow.ts';
import type { BedScene3, EnclosureData } from './layout.ts';
import { builtIn } from './mode.ts';

/**
 * Tall cards the visitor could walk behind (cook/ROAM_ART.md section 3 follow-up). The follow camera rides `back` metres
 * south of the visitor and `up` metres high, so the ray to the visitor's ground point crosses a card d metres in front
 * of the visitor at height up * d / back: the card, from its bottom edge to its top, covers the visitor while d lies
 * between bottom * back / up and top * back / up (or back itself once the top reaches the camera). Each named card
 * blocks just that band of ground north of it, as wide as the card on screen, for the landscape and the phone framing.
 * Position and height come from the bed's own item as free roam builds it (its roam variant where one exists); only the
 * card's width to height ratio is listed in garden.json. A card that would block the way to a place the visitor must
 * reach fades instead (its item's `fade` flag, cutout.vert.glsl) and is not listed.
 */

/** Extra width each side of the card (m): the camera may sit a little off the visitor near the end walls. */
const SIDE_MARGIN = 0.1;
/** The framings whose views the bands must cover: landscape and phone. */
const FRAMINGS: readonly Framing[] = [16 / 9, 9 / 16].map((a) => framingFor(a, {} as Framing));

export function occluderBlocks(e: EnclosureData, scenes: Readonly<Record<BedId, BedScene3>>): Float32Array {
  const out: number[] = [];
  const northmost = e.walk.minZ + ROAM.radius;
  for (const o of e.occluders) {
    for (const l of scenes[o.bed].layers) {
      for (const it of l.items) {
        if (it.sprite !== o.sprite || !builtIn(it, 'roam')) continue;
        const h = (it.h ?? 0) * it.scale;
        const top = it.y + h;
        let near = Infinity;
        let far = 0;
        for (const f of FRAMINGS) {
          near = Math.min(near, (it.y * f.back) / f.up);
          far = Math.max(far, top >= f.up ? f.back : (top * f.back) / f.up);
        }
        const z1 = it.z - near;
        // No body centre stands north of z1: the card never comes between the camera and the visitor.
        if (z1 <= northmost) continue;
        const half = (h * o.aspect) / 2 + SIDE_MARGIN;
        out.push(it.x - half, Math.max(e.walk.minZ - ROAM.radius, it.z - far), it.x + half, z1);
      }
    }
  }
  return new Float32Array(out);
}
