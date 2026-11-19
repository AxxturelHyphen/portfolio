import type { BedId } from '../types.ts';
import { ROAM } from '../core/motion.ts';
import { framingFor, type Framing } from './follow.ts';
import type { BedScene3, EnclosureData, Placement3 } from './layout.ts';
import { builtIn } from './mode.ts';

/**
 * Tall cards the visitor could walk behind (cook/ROAM_ART.md section 3 follow-up). The follow camera rides `back` metres
 * south of the visitor and `up` metres high, so the ray to the visitor's ground point crosses a card d metres in front
 * of the visitor at height up * d / back: the card, from its bottom edge to its top, covers the visitor while d lies
 * between bottom * back / up and top * back / up (or back itself once the top reaches the camera). Each named card
 * blocks just that band of ground north of it, as wide as the card on screen, for the landscape and the phone framing.
 * Position and height come from the bed's own item as free roam builds it (its roam variant where one exists); only the
 * card's width to height ratio is listed in garden.json. A card that would block the way to a place the visitor must
 * reach fades instead (its item's `fade` flag, cutout.vert.glsl) and gets no band, even when its sprite is listed.
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
        if (it.sprite !== o.sprite || it.fade === true || !builtIn(it, 'roam')) continue;
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

/**
 * Low, wide props (under lowH tall with whatever rests on them, at least wide across: benches, barrows) keep the visitor
 * `m` off their lens side, so the figure's soles never stop on the screen row of the prop's feet, where it covers the
 * prop and reads as standing in it. Props narrower than the figure (pots, lanterns, cans) keep their plain box, so the
 * walk along the path stays open, and so does a tall stack (the armillary on the sundial's drum): its box is just the
 * drawn footprint.
 */
export const PROP_STANDOFF = { lowH: 1.2, wide: 0.6, m: 0.5 } as const;

/** Items above this height (m) rest on something (the cat on the bench, the armillary on its drum). */
const RESTING_Y = 0.05;

/** The top of a prop with what rests on it: the highest item standing within its box above the ground. */
function stackTop(it: Placement3, items: readonly Placement3[]): number {
  const [left, right, depth] = it.block ?? [0, 0, 0];
  let top = (it.h ?? 0) * it.scale;
  for (const o of items) {
    if (o === it || o.y <= RESTING_Y || !builtIn(o, 'roam')) continue;
    if (o.x < it.x - left || o.x > it.x + right || Math.abs(o.z - it.z) > depth / 2) continue;
    top = Math.max(top, o.y + (o.h ?? 0) * o.scale);
  }
  return top;
}

/**
 * Solid props (benches, cans, pots, lanterns, a barrow) are boxes the visitor walks round, so the figure never stands
 * inside one and the depth test always finds the prop wholly in front of the figure or wholly behind it. Each is the
 * item's `block` (reach left and right of its foot, depth) from the placements free roam builds, reaching
 * PROP_STANDOFF further south (toward the lens) for low props.
 */
export function propBlocks(scenes: Readonly<Record<BedId, BedScene3>>): Float32Array {
  const out: number[] = [];
  for (const scene of Object.values(scenes)) {
    const items = scene.layers.flatMap((l) => l.items);
    for (const it of items) {
      if (it.block === undefined || !builtIn(it, 'roam')) continue;
      const [left, right, depth] = it.block;
      const standoff = left + right >= PROP_STANDOFF.wide && stackTop(it, items) < PROP_STANDOFF.lowH ? PROP_STANDOFF.m : 0;
      out.push(it.x - left, it.z - depth / 2, it.x + right, it.z + depth / 2 + standoff);
    }
  }
  return new Float32Array(out);
}
