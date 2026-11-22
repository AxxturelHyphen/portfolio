import type { Clock, CutoutBatch, QuadParams, SlotId } from '../types.ts';
import { PET, STEP_FPS } from '../core/motion.ts';
import { DEG } from './layout.ts';
import { createFollow } from './pet.follow.ts';
import { catLeash, type Leash } from './pet.leash.ts';

/**
 * A pet (a slot of kind 'pet', the Rosaleda cat): one cutout of its bed batch that moves by transforms of its own quad
 * only, every frame (on the 12 fps step under reduced motion). Activated, it wakes: a squash, a long stretch, its head
 * side turned toward the visitor (the card turns over when the visitor stands on its tail side, else the head lifts)
 * and a tail-flick wobble. Activated in free roam it is tied for good (world/pet.leash.ts): it hops down in front of its
 * bench (an arc, a squash on landing) and follows the visitor across the garden (world/pet.follow.ts steers it),
 * trotting with a two-height bob, its card turned to its way of travel only after a clear stretch of it, standing when
 * they stop and after a while sitting with one flick of its tail. A reload keeps it following (it starts from its
 * landing spot); start over lets it go back to sleep on its bench. A visitor walking up to it asleep twitches its ears
 * once (a small lift), again only after walking away past PET.rearmM. Reduced motion follows without the bob, the hop
 * or the flick (the rail keeps the wake alone); frozen time keeps it asleep. Its proxy's world point moves with it.
 * Nothing allocates per frame.
 */

export interface PetRef { slot: SlotId; batch: CutoutBatch; at: number; quad: QuadParams }

/** The pet's bed: its x range (the hop down lands inside it) and its proxy's world point, moved with it. */
export interface PetRange { edge: readonly [number, number]; anchor: [number, number, number] | null }

export interface Pet {
  readonly slot: SlotId;
  /** True while it moves on the frame clock: waking, hopping, trotting or flicking its tail. */
  readonly busy: boolean;
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

/** The wake up to the turned head, before it hops down. */
const RISE: readonly Key[] = WAKE.slice(0, 8);

const TWITCH: readonly Key[] = [
  [0, 1, 1, 0, 0],
  [0.08, 0.98, 1.06, 0, 0],
  [0.17, 1.01, 0.98, 0, 0],
  [0.25, 0.99, 1.04, 0, 0],
  [0.33, 1, 0.99, 0, 0],
  [PET.twitchS, 1, 1, 0, 0],
];

/** After the hop down, from its end: the squash of the landing. */
const LAND: readonly Key[] = [[0, 1.18, 0.78, 0, 0], [0.17, 0.94, 1.06, 0, 0], [0.34, 1, 1, 0, 0]];

/** Tail flick: rotation about the pivot, its amplitude and rate. Head lift when the card does not turn over. */
const FLICK = { deg: 3, hz: 3 } as const;
const LIFT_DEG = 4;

/**
 * The walk: hop length (s), its arc's height (m) and the stretch in the air; the landing spot off the bench (m, toward
 * the visitor and to the front); the stepped bob of the trot (m, and the width and height scales of its two steps);
 * seconds standing before it sits, the sitting pose (width and height scales) and its one tail flick (s).
 */
const LIFE = {
  hopS: 0.5, hopM: 0.2, air: [0.94, 1.08], landSideM: 0.3, landFrontM: 0.45, bobM: 0.03, bob: [0.97, 1.04, 1.03, 0.97],
  sitS: 3, sit: [1.06, 0.88], flickS: 0.7,
} as const;

type Phase = 'sleep' | 'twitch' | 'wake' | 'rise' | 'down' | 'follow';

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

const endOf = (keys: readonly Key[]): number => keys[keys.length - 1]![0];

export function createPet(ref: PetRef, range: PetRange, leash: Leash = catLeash): Pet {
  const { batch, at, quad } = ref;
  const { anchor } = range;
  const base = { x: quad.x, y: quad.y, z: quad.z, w: quad.w, h: quad.h, rot: quad.rot };
  const slot0 = anchor === null ? null : { x: anchor[0], y: anchor[1], z: anchor[2] };
  /** Where the card's middle sits from its pivot, in widths: turning over keeps the middle in place. */
  const mid = 0.5 - quad.px;
  /** The side its head faces at rest (+1 toward +x). */
  const head = base.w > 0 ? -1 : 1;
  const follow = createFollow(leash);
  let phase: Phase = 'sleep';
  let start = Number.NaN;
  let shown = -1;
  let flip = false;
  let armed = true;
  let woken = false;
  /** Following the visitor (until start over lets it go). */
  let tied = false;
  /** The way it faces (1 as at rest), its trot steps and the standing pose last written (0 stand, 1 sit, -1 none). */
  let face = 1;
  let strides = 0;
  let posed = -1;
  /** The landing spot in front of the bench. */
  let lx = base.x;
  let lz = base.z;

  const faceOf = (dx: number): number => (Math.sign(dx) === head ? 1 : -1);

  function write(x: number, y: number, z: number, sign: number, sx: number, sy: number, rot: number): void {
    quad.w = base.w * sign * sx;
    quad.h = base.h * sy;
    quad.x = x + mid * base.w * (1 - sign);
    quad.y = y;
    quad.z = z;
    quad.rot = base.rot + rot;
    batch.writer.set(at, quad);
    batch.writer.commit(at, at + 1);
    if (anchor === null || slot0 === null) return;
    anchor[0] = slot0.x + (x - base.x);
    anchor[1] = slot0.y + (y - base.y);
    anchor[2] = slot0.z + (z - base.z);
  }

  function begin(next: Phase, t: number): void {
    phase = next;
    start = t;
    shown = -1;
  }

  function rest(): void {
    phase = 'sleep';
    shown = -1;
    face = 1;
    leash.moving = false;
    leash.at.fill(Number.NaN);
    write(base.x, base.y, base.z, 1, 1, 1, 0);
  }

  /** The keyed wake on the bench, s seconds in; the flick only with motion allowed. */
  function onBench(keys: readonly Key[], s: number, still: boolean): void {
    sample(keys, s);
    const sign = flip ? 1 - 2 * pose.turn : 1;
    const flick = still ? 0 : pose.wobble * FLICK.deg * DEG * Math.sin(2 * Math.PI * FLICK.hz * s);
    write(base.x, base.y, base.z, sign, pose.sx, pose.sy, (flip ? 0 : pose.turn * LIFT_DEG * DEG) + flick);
  }

  /** A hop off the bench, k of the way (0..1), to the landing spot. */
  function hop(k: number): void {
    const y = base.y * (1 - k) + LIFE.hopM * 4 * k * (1 - k);
    write(base.x + (lx - base.x) * k, y, base.z + (lz - base.z) * k, face, LIFE.air[0], LIFE.air[1], 0);
  }

  /** The landing spot toward the visitor at vx, inside the bed's edge; the card turns that way. */
  function land(vx: number): void {
    const toward = vx >= base.x ? 1 : -1;
    lx = Math.min(range.edge[1], Math.max(range.edge[0], base.x + LIFE.landSideM * toward));
    lz = base.z + LIFE.landFrontM;
    face = faceOf(toward);
  }

  /** Follows the visitor at (vx, vz) from the landing spot. */
  function tie(vx: number, vz: number, t: number): void {
    follow.start(lx, lz, face * head, vx, vz);
    tied = true;
    posed = -1;
    begin('follow', t);
  }

  /** One following step of n frames of the 12 fps step: trots (a two-height bob, none under reduced motion) or stands, then sits and flicks its tail once. */
  function walk(n: number, vx: number, vz: number, t: number, reduced: boolean): void {
    const moved = follow.step(vx, vz, n / STEP_FPS, t);
    leash.moving = follow.moving;
    leash.at[0] = follow.x;
    leash.at[1] = follow.z;
    const turned = follow.dir * head;
    if (moved > 0) {
      face = turned;
      posed = -1;
      strides += n;
      const odd = reduced ? 0 : Math.floor(strides) % 2;
      const bob = reduced ? 1 : 0;
      write(follow.x, odd * LIFE.bobM, follow.z, face, bob || LIFE.bob[odd * 2]!, bob || LIFE.bob[odd * 2 + 1]!, 0);
      return;
    }
    const sat = follow.still > LIFE.sitS ? 1 : 0;
    const flicking = sat === 1 && !reduced && follow.still < LIFE.sitS + LIFE.flickS;
    if (!flicking && posed === sat && face === turned) return;
    face = turned;
    posed = sat;
    const flick = flicking ? FLICK.deg * DEG * Math.sin(2 * Math.PI * FLICK.hz * (follow.still - LIFE.sitS)) : 0;
    write(follow.x, 0, follow.z, face, sat === 1 ? LIFE.sit[0] : 1, sat === 1 ? LIFE.sit[1] : 1, flick);
  }

  return {
    slot: ref.slot,
    get busy() {
      if (phase !== 'follow') return phase !== 'sleep';
      return follow.moving || (follow.still > LIFE.sitS && follow.still < LIFE.sitS + LIFE.flickS);
    },
    wake() {
      woken = true;
    },
    update(c, visitor, reduced) {
      const vx = visitor?.[0] ?? Number.NaN;
      const vz = visitor?.[1] ?? Number.NaN;
      const d = visitor === null ? Infinity : Math.hypot(vx - base.x, vz - base.z);
      if (tied && !leash.on) {
        tied = false;
        rest();
      }
      if (woken && visitor !== null) leash.tie();
      let next: Phase | null = null;
      if (woken && (phase === 'sleep' || phase === 'twitch')) next = reduced || visitor === null ? 'wake' : 'rise';
      else if (armed && d < PET.nearM && phase === 'sleep' && !reduced && !leash.on) next = 'twitch';
      woken = false;
      if (d < PET.nearM) armed = false;
      else if (d > PET.rearmM) armed = true;
      if (c.frozen) {
        if (phase !== 'sleep') rest();
        return;
      }
      if (next !== null) {
        begin(next, c.t);
        flip = (vx > base.x) === (base.w > 0);
      } else if (phase === 'sleep' && leash.on && visitor !== null) {
        land(vx);
        tie(vx, vz, c.t);
      }
      if (phase === 'sleep') return;
      if (reduced && (phase === 'twitch' || phase === 'rise' || phase === 'down')) {
        if (leash.on && visitor !== null) {
          land(vx);
          tie(vx, vz, c.t);
        } else rest();
        return;
      }
      const raw = (c.t - start) * STEP_FPS;
      const step = reduced ? Math.floor(raw) : raw;
      if (step === shown) return;
      const n = shown < 0 ? 1 : step - shown;
      shown = step;
      const s = step / STEP_FPS;
      switch (phase) {
        case 'twitch':
        case 'wake': {
          const keys = phase === 'wake' ? WAKE : TWITCH;
          if (s < endOf(keys)) onBench(keys, s, reduced);
          else if (phase === 'wake' && leash.on && visitor !== null) {
            land(vx);
            tie(vx, vz, c.t);
          } else rest();
          return;
        }
        case 'rise':
          if (s < endOf(RISE)) onBench(RISE, s, false);
          else if (visitor === null) begin('wake', c.t - endOf(RISE));
          else {
            land(vx);
            begin('down', c.t);
          }
          return;
        case 'down':
          if (s < LIFE.hopS) {
            hop(s / LIFE.hopS);
            return;
          }
          sample(LAND, s - LIFE.hopS);
          write(lx, 0, lz, face, pose.sx, pose.sy, 0);
          if (s - LIFE.hopS < endOf(LAND)) return;
          if (leash.on && visitor !== null) tie(vx, vz, c.t);
          else rest();
          return;
        case 'follow':
          if (visitor === null) rest();
          else walk(n, vx, vz, c.t, reduced);
          return;
      }
    },
  };
}
