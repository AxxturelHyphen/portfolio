import type { BedId } from '../types.ts';
import type { BedScene3, Placement3 } from './layout.ts';
import { builtIn } from './mode.ts';

/**
 * Free roam's props built as real geometry (gl/props.ts) in place of their cutout cards (world/bed.build.ts leaves the
 * cards out): the standing lanterns, the terracotta pot under the potted rose, the bench the cat sits on, the Puerta's
 * two gilt iron gate leaves and the Rosaleda's ladder obelisk against the wall (its climbing roses stay cards). Pure data
 * from the beds' placements: where each stands, how tall and how turned. Their collision boxes stay the items' own
 * `block` (world/occluders.ts propBlocks), which the solids fill. Load time only.
 */

export const SOLID_PROP = { lantern: 'sh/lantern', pot: 'sh/pot-a', bench: 'v/bench', gateL: 'pu/leaf-l', gateR: 'pu/leaf-r', trellis: 'v/trestle' } as const;
/** The sprites free roam builds whole (the lanterns go by their prefix). */
const WHOLE = new Set<string>([SOLID_PROP.pot, SOLID_PROP.bench, SOLID_PROP.gateL, SOLID_PROP.gateR, SOLID_PROP.trellis]);

/** The bench's seat height (m): the cat's y on it in the bed file. */
export const BENCH_SEAT = 0.47;
/** Items above this height rest on something; a resting lantern this near a bench (m, along x) stands on its seat. */
const RESTING_Y = 0.05;
const BENCH_REACH = 0.5;
/** A lantern on the seat keeps this far in from the seat's ends (m). */
const SEAT_INSET = 0.1;
const DEG = Math.PI / 180;
/** A prop's height when its placement draws none (world/lamps.ts LAMPS.defaultH). */
const DEFAULT_H = 0.4;

/** Whether free roam builds this sprite as a solid instead of a card. */
export function isSolidProp(sprite: string): boolean {
  return sprite.startsWith(SOLID_PROP.lantern) || WHOLE.has(sprite);
}

/** A standing prop: its foot (y above the ground there), height and yaw (radians, from the card's hinge). */
export interface PropSpot { x: number; y: number; z: number; h: number; yaw: number }
/** A gate leaf: where it stands, and which way its hinge edge lies along the leaf (-1 left, 1 right). */
export interface GateSpot extends PropSpot { side: -1 | 1 }
/** The obelisk: its foot centred under its collision box, which is `w` wide and `d` deep. */
export interface TrellisSpot extends PropSpot { w: number; d: number }
/** A bench filling its collision box: x from x0 to x1, centred on z, `depth` deep. */
export interface BenchSpot { x0: number; x1: number; z: number; depth: number }

const benchOf = (it: Placement3): BenchSpot | null =>
  (it.block === undefined ? null : { x0: it.x - it.block[0], x1: it.x + it.block[1], z: it.z, depth: it.block[2] });

/**
 * Where a lantern stands: on the ground at its foot, or, resting above the ground near a bench, on the bench's seat
 * (kept inside its ends). `items` are the placements of the lantern's bed.
 */
export function lanternRest(it: Placement3, items: readonly Placement3[]): { x: number; y: number } {
  if (it.y <= RESTING_Y) return { x: it.x, y: it.y };
  for (const o of items) {
    if (o.sprite !== SOLID_PROP.bench || !builtIn(o, 'roam')) continue;
    const b = benchOf(o);
    if (b === null || Math.abs(it.z - b.z) > b.depth / 2 || it.x < b.x0 - BENCH_REACH || it.x > b.x1 + BENCH_REACH) continue;
    return { x: Math.min(b.x1 - SEAT_INSET, Math.max(b.x0 + SEAT_INSET, it.x)), y: BENCH_SEAT };
  }
  return { x: it.x, y: it.y };
}

export interface SolidProps { lanterns: PropSpot[]; pots: PropSpot[]; benches: BenchSpot[]; gates: GateSpot[]; trellises: TrellisSpot[] }

/** Every solid prop free roam builds in the beds. */
export function solidProps(scenes: Readonly<Partial<Record<BedId, BedScene3>>>): SolidProps {
  const out: SolidProps = { lanterns: [], pots: [], benches: [], gates: [], trellises: [] };
  for (const scene of Object.values(scenes)) {
    const items = scene.layers.flatMap((l) => l.items).filter((it) => builtIn(it, 'roam'));
    for (const it of items) {
      const spot = { x: it.x, y: it.y, z: it.z, h: (it.h ?? DEFAULT_H) * it.scale, yaw: -it.hinge * DEG };
      if (it.sprite.startsWith(SOLID_PROP.lantern)) out.lanterns.push({ ...spot, ...lanternRest(it, items) });
      else if (it.sprite === SOLID_PROP.pot) out.pots.push(spot);
      else if (it.sprite === SOLID_PROP.gateL || it.sprite === SOLID_PROP.gateR) out.gates.push({ ...spot, side: it.sprite === SOLID_PROP.gateL ? -1 : 1 });
      else if (it.sprite === SOLID_PROP.trellis && it.block !== undefined) {
        const [left, right, depth] = it.block;
        out.trellises.push({ ...spot, x: it.x + (right - left) / 2, w: left + right, d: depth });
      }
      else if (it.sprite === SOLID_PROP.bench) {
        const b = benchOf(it);
        if (b !== null) out.benches.push(b);
      }
    }
  }
  return out;
}
