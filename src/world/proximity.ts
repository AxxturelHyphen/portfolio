/**
 * Proximity focus of free roam (cook/ROAM_PLAN.md section 3, P4): in the entered bed, the nearest project, link or prop
 * slot within reach of the visitor is the one to focus. A held slot is kept until the visitor is more than the
 * hysteresis past the reach, or another slot is nearer by more than the hysteresis. When anything else chooses the
 * focus (hover, keyboard, a tap, Esc), proximity yields until the visitor has walked a metre from where that happened.
 * Distances are in the ground plane (x, z), to a slot's stand point where it has one. The cat on its leash (world/pet.leash.ts)
 * walks at the visitor's heel and never takes the focus. No allocation per frame.
 */
import type { SlotId, SlotView } from '../types.ts';
import { catLeash } from './pet.leash.ts';

export const PROXIMITY = { reachM: 2.2, hysteresisM: 0.4, yieldM: 1 } as const;

/**
 * Ground distance from (x, z) to where a slot is reached from: its own stand point (a flower out on the water, which
 * no shore comes near enough), else the slot itself.
 */
export function reachDist(v: SlotView, x: number, z: number): number {
  return v.stand === undefined ? Math.hypot(v.world[0] - x, v.world[2] - z) : Math.hypot(v.stand[0] - x, v.stand[1] - z);
}

export interface Proximity {
  /** The slot proximity wants focused after the last update (null: none). */
  readonly want: SlotId | null;
  /** The slots of the entered bed (empty while none is entered). */
  setSlots(slots: readonly SlotView[]): void;
  /** Something else chose the focus with the visitor at (x, z): proximity steps aside until it walks away. */
  yieldAt(x: number, z: number): void;
  /** Recomputes `want` for the visitor at (x, z). False while proximity yields (then `want` is not to be applied). */
  update(x: number, z: number): boolean;
}

const NONE: readonly SlotView[] = [];

export function createProximity(): Proximity {
  let slots = NONE;
  let held: SlotView | null = null;
  let yielding = false;
  let yx = 0;
  let yz = 0;

  return {
    get want() {
      return held === null ? null : held.id;
    },
    setSlots(next) {
      slots = next;
      if (held !== null && !next.includes(held)) held = null;
    },
    yieldAt(x, z) {
      yielding = true;
      yx = x;
      yz = z;
      held = null;
    },
    update(x, z) {
      if (yielding) {
        if (Math.hypot(x - yx, z - yz) < PROXIMITY.yieldM) return false;
        yielding = false;
      }
      let best: SlotView | null = null;
      let bestD = Infinity;
      for (let i = 0; i < slots.length; i++) {
        const v = slots[i]!;
        if (v.kind === 'pet' && catLeash.on) continue;
        const d = reachDist(v, x, z);
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
      if (held !== null) {
        const d = reachDist(held, x, z);
        const keep = d <= PROXIMITY.reachM + PROXIMITY.hysteresisM && !(best !== held && bestD < d - PROXIMITY.hysteresisM);
        if (keep) return true;
      }
      held = best !== null && bestD <= PROXIMITY.reachM ? best : null;
      return true;
    },
  };
}
