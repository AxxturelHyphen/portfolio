import type { Clock, CutoutBatch, QuadParams, SlotId } from '../types.ts';
import { PET, STEP_FPS } from '../core/motion.ts';
import { DEG } from './layout.ts';

/**
 * A pet (a slot of kind 'pet', the Rosaleda cat): one cutout of its bed batch that reacts by transforms of its own quad
 * only, on the 12 fps clock. Activated, it wakes: a squash, a long stretch, its head side turned toward the visitor
 * (the card turns over when the visitor stands on its tail side, else the head lifts), a tail-flick wobble, then it
 * curls back to sleep. A visitor walking up within PET.nearM twitches its ears once (a small lift), again only after
 * walking away past PET.rearmM. Reduced motion and frozen time keep it asleep. Nothing allocates per frame.
 */

export interface PetRef { slot: SlotId; batch: CutoutBatch; at: number; quad: QuadParams }

export interface Pet {
  readonly slot: SlotId;
  wake(): void;
  /** `visitor`: its [x, z] (free roam), else null. */
  update(c: Clock, visitor: Float32Array | null, reduced: boolean): void;
}

/** A pose key: seconds from the start, width and height scale, turn (0 rest, 1 turned), head lift and wobble (0 or 1). */
type Key = readonly [t: number, sx: number, sy: number, turn: number, wobble: number];

const WAKE: readonly Key[] = [
  [0, 1, 1, 0, 0],
  [0.25, 1.08, 0.84, 0, 0],
  [0.5, 1, 1.03, 0, 0],
  [0.9, 1.22, 0.9, 0, 0],
  [1.4, 1.22, 0.9, 0, 0],
  [1.75, 1.02, 1.05, 1, 0],
  [2.6, 1, 1.03, 1, 1],
  [2.9, 1, 1, 1, 0],
  [3.3, 1.03, 0.93, 0, 0],
  [PET.wakeS, 1, 1, 0, 0],
];

const TWITCH: readonly Key[] = [
  [0, 1, 1, 0, 0],
  [0.08, 0.98, 1.06, 0, 0],
  [0.17, 1.01, 0.98, 0, 0],
  [0.25, 0.99, 1.04, 0, 0],
  [0.33, 1, 0.99, 0, 0],
  [PET.twitchS, 1, 1, 0, 0],
];

/** Tail flick: rotation about the pivot, its amplitude and rate. Head lift when the card does not turn over. */
const FLICK = { deg: 3, hz: 3 } as const;
const LIFT_DEG = 4;

const pose = { sx: 1, sy: 1, turn: 0, wobble: 0 };

/** Writes the keys' pose at s seconds into `pose` (linear between keys, the last one past the end). */
function sample(keys: readonly Key[], s: number): void {
  let i = 1;
  while (i < keys.length - 1 && keys[i]![0] < s) i++;
  const a = keys[i - 1]!;
  const b = keys[i]!;
  const k = Math.min(1, Math.max(0, (s - a[0]) / Math.max(1e-6, b[0] - a[0])));
  pose.sx = a[1] + (b[1] - a[1]) * k;
  pose.sy = a[2] + (b[2] - a[2]) * k;
  pose.turn = a[3] + (b[3] - a[3]) * k;
  pose.wobble = k < 1 ? a[4] : b[4];
}

export function createPet(ref: PetRef): Pet {
  const { batch, at, quad } = ref;
  const base = { x: quad.x, z: quad.z, w: quad.w, h: quad.h, rot: quad.rot };
  /** Where the card's middle sits from its pivot, in widths: turning over keeps the middle in place. */
  const mid = 0.5 - quad.px;
  let keys: readonly Key[] | null = null;
  let start = Number.NaN;
  let shown = -1;
  let flip = false;
  let armed = true;
  let woken = false;

  function write(s: number): void {
    const sign = flip ? 1 - 2 * pose.turn : 1;
    quad.w = base.w * sign * pose.sx;
    quad.h = base.h * pose.sy;
    quad.x = base.x + mid * base.w * (1 - sign);
    quad.rot = base.rot + (flip ? 0 : pose.turn * LIFT_DEG * DEG) + pose.wobble * FLICK.deg * DEG * Math.sin(2 * Math.PI * FLICK.hz * s);
    batch.writer.set(at, quad);
    batch.writer.commit(at, at + 1);
  }

  function rest(): void {
    keys = null;
    shown = -1;
    pose.sx = 1;
    pose.sy = 1;
    pose.turn = 0;
    pose.wobble = 0;
    write(0);
  }

  return {
    slot: ref.slot,
    wake() {
      woken = true;
    },
    update(c, visitor, reduced) {
      const vx = visitor?.[0] ?? Number.NaN;
      const d = visitor === null ? Infinity : Math.hypot(vx - base.x, (visitor[1] ?? 0) - base.z);
      let next: readonly Key[] | null = null;
      if (woken && keys !== WAKE) next = WAKE;
      else if (armed && d < PET.nearM && keys === null) next = TWITCH;
      woken = false;
      if (d < PET.nearM) armed = false;
      else if (d > PET.rearmM) armed = true;
      if (next !== null && !reduced && !c.frozen) {
        keys = next;
        start = c.t;
        shown = -1;
        flip = (vx > base.x) === (base.w > 0);
      }
      if (keys === null) return;
      if (reduced || c.frozen) {
        rest();
        return;
      }
      const step = Math.floor((c.t - start) * STEP_FPS);
      if (step === shown) return;
      shown = step;
      const s = step / STEP_FPS;
      const end = keys[keys.length - 1]![0];
      if (s >= end) {
        rest();
        return;
      }
      sample(keys, s);
      write(s);
    },
  };
}
