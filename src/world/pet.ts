import type { Clock, CutoutBatch, QuadParams, SlotId } from '../types.ts';
import { PET, STEP_FPS } from '../core/motion.ts';
import { DEG } from './layout.ts';

/**
 * A pet (a slot of kind 'pet', the Rosaleda cat): one cutout of its bed batch that moves by transforms of its own quad
 * only, on the 12 fps clock. Activated, it wakes: a squash, a long stretch, its head side turned toward the visitor
 * (the card turns over when the visitor stands on its tail side, else the head lifts) and a tail-flick wobble. With a
 * visitor about it then hops down in front of its bench (an arc, a squash on landing), trots beside the visitor for
 * LIFE.trotS (a stepped bob, the card turned to face its way, never past the bed's edge and never in front of the
 * visitor), trots back, hops up and curls to sleep. A visitor walking up within PET.nearM twitches its ears once (a
 * small lift), again only after walking away past PET.rearmM. Reduced motion keeps the wake alone (no flick, no hop);
 * frozen time keeps it asleep. Its proxy's world point moves with it. Nothing allocates per frame.
 */

export interface PetRef { slot: SlotId; batch: CutoutBatch; at: number; quad: QuadParams }

/** Where a pet may roam: the bed's x range (it stops at either edge) and its proxy's world point, moved with it. */
export interface PetRange { edge: readonly [number, number]; anchor: [number, number, number] | null }

export interface Pet {
  readonly slot: SlotId;
  /** True from waking until it lies asleep again. */
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

/** After a hop, from its end: the squash of the landing (down) or of curling up on the bench (up). */
const LAND: readonly Key[] = [[0, 1.18, 0.78, 0, 0], [0.17, 0.94, 1.06, 0, 0], [0.34, 1, 1, 0, 0]];
const CURL: readonly Key[] = [[0, 1.1, 0.85, 0, 0], [0.25, 1.04, 0.92, 0, 0], [0.6, 1, 1, 0, 0]];

/** Tail flick: rotation about the pivot, its amplitude and rate. Head lift when the card does not turn over. */
const FLICK = { deg: 3, hz: 3 } as const;
const LIFT_DEG = 4;

/**
 * The walk: hop length (s), its arc's height (m) and the stretch in the air; the landing spot off the bench (m, toward
 * the visitor and to the front); trot time (s), pace (m/s), the stand-off beside the visitor and behind it (m), the
 * reach that counts as arrived (m) and the stepped bob (m, and the width and height scales of its two steps).
 */
const LIFE = {
  hopS: 0.5, hopM: 0.2, air: [0.94, 1.08], landSideM: 0.3, landFrontM: 0.45,
  trotS: 4, trotMps: 1.8, besideM: 0.85, behindM: 0.15, arriveM: 0.05, bobM: 0.03, bob: [0.97, 1.04, 1.03, 0.97],
} as const;

type Phase = 'sleep' | 'twitch' | 'wake' | 'rise' | 'down' | 'trot' | 'back' | 'up';

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

export function createPet(ref: PetRef, range: PetRange): Pet {
  const { batch, at, quad } = ref;
  const { anchor } = range;
  const base = { x: quad.x, y: quad.y, z: quad.z, w: quad.w, h: quad.h, rot: quad.rot };
  const slot0 = anchor === null ? null : { x: anchor[0], y: anchor[1], z: anchor[2] };
  /** Where the card's middle sits from its pivot, in widths: turning over keeps the middle in place. */
  const mid = 0.5 - quad.px;
  /** The side its head faces at rest (+1 toward +x). */
  const head = base.w > 0 ? -1 : 1;
  let phase: Phase = 'sleep';
  let start = Number.NaN;
  let shown = -1;
  let flip = false;
  let armed = true;
  let woken = false;
  /** Where it stands on the ground (pivot, as if not turned over), the way it faces (1 as at rest) and its trot steps. */
  let gx = base.x;
  let gz = base.z;
  let face = 1;
  let strides = 0;
  /** The landing spot in front of the bench and the x range it trots within. */
  let lx = base.x;
  let lz = base.z;
  let minX = base.x;
  let maxX = base.x;

  const faceOf = (dx: number): number => (Math.abs(dx) < 0.01 ? face : Math.sign(dx) === head ? 1 : -1);

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
    gx = base.x;
    gz = base.z;
    write(base.x, base.y, base.z, 1, 1, 1, 0);
  }

  /** The keyed wake on the bench, s seconds in; the flick only with motion allowed. */
  function onBench(keys: readonly Key[], s: number, still: boolean): void {
    sample(keys, s);
    const sign = flip ? 1 - 2 * pose.turn : 1;
    const flick = still ? 0 : pose.wobble * FLICK.deg * DEG * Math.sin(2 * Math.PI * FLICK.hz * s);
    write(base.x, base.y, base.z, sign, pose.sx, pose.sy, (flip ? 0 : pose.turn * LIFT_DEG * DEG) + flick);
  }

  /** A hop between the bench and the ground, k of the way (0..1), from (ax, ay, az) to (bx, by, bz). */
  function hop(k: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const y = ay + (by - ay) * k + LIFE.hopM * 4 * k * (1 - k);
    write(ax + (bx - ax) * k, y, az + (bz - az) * k, face, LIFE.air[0], LIFE.air[1], 0);
  }

  /** n trot steps toward (tx, tz); true once there. Standing, it faces the visitor at vx. */
  function trot(n: number, tx: number, tz: number, vx: number): boolean {
    const dx = tx - gx;
    const dz = tz - gz;
    const d = Math.hypot(dx, dz);
    if (d <= LIFE.arriveM) {
      face = Number.isNaN(vx) ? face : faceOf(vx - gx);
      write(gx, 0, gz, face, 1, 1, 0);
      return true;
    }
    const k = Math.min(1, (LIFE.trotMps * n) / (STEP_FPS * d));
    gx += dx * k;
    gz += dz * k;
    face = faceOf(dx);
    strides += n;
    const odd = strides % 2;
    write(gx, odd * LIFE.bobM, gz, face, LIFE.bob[odd * 2]!, LIFE.bob[odd * 2 + 1]!, 0);
    return false;
  }

  /** Leaves the bench toward the visitor at vx: the landing spot and the x range follow from it. */
  function hopDown(vx: number, t: number): void {
    const toward = vx >= base.x ? 1 : -1;
    lx = base.x + LIFE.landSideM * toward;
    lz = base.z + LIFE.landFrontM;
    minX = Math.min(range.edge[0], lx);
    maxX = Math.max(range.edge[1], lx);
    face = faceOf(toward);
    begin('down', t);
  }

  return {
    slot: ref.slot,
    get busy() {
      return phase !== 'sleep';
    },
    wake() {
      woken = true;
    },
    update(c, visitor, reduced) {
      const vx = visitor?.[0] ?? Number.NaN;
      const vz = visitor?.[1] ?? Number.NaN;
      const d = visitor === null ? Infinity : Math.hypot(vx - base.x, vz - base.z);
      let next: Phase | null = null;
      if (woken && (phase === 'sleep' || phase === 'twitch')) next = reduced || visitor === null ? 'wake' : 'rise';
      else if (armed && d < PET.nearM && phase === 'sleep' && !reduced) next = 'twitch';
      woken = false;
      if (d < PET.nearM) armed = false;
      else if (d > PET.rearmM) armed = true;
      if (next !== null && !c.frozen) {
        begin(next, c.t);
        flip = (vx > base.x) === (base.w > 0);
      }
      if (phase === 'sleep') return;
      if (c.frozen || (reduced && phase !== 'wake')) {
        rest();
        return;
      }
      const step = Math.floor((c.t - start) * STEP_FPS);
      if (step === shown) return;
      const n = shown < 0 ? 1 : step - shown;
      shown = step;
      const s = step / STEP_FPS;
      switch (phase) {
        case 'twitch':
        case 'wake': {
          const keys = phase === 'wake' ? WAKE : TWITCH;
          if (s >= endOf(keys)) rest();
          else onBench(keys, s, reduced);
          return;
        }
        case 'rise':
          if (s < endOf(RISE)) onBench(RISE, s, false);
          else if (visitor === null) begin('wake', c.t - endOf(RISE));
          else hopDown(vx, c.t);
          return;
        case 'down':
          if (s < LIFE.hopS) {
            hop(s / LIFE.hopS, base.x, base.y, base.z, lx, 0, lz);
            return;
          }
          gx = lx;
          gz = lz;
          sample(LAND, s - LIFE.hopS);
          write(gx, 0, gz, face, pose.sx, pose.sy, 0);
          if (s - LIFE.hopS >= endOf(LAND)) begin('trot', c.t);
          return;
        case 'trot': {
          if (visitor === null || s >= LIFE.trotS) {
            begin('back', c.t);
            return;
          }
          const side = Math.abs(gx - vx) > 0.2 ? Math.sign(gx - vx) : -face * head;
          const tx = Math.min(maxX, Math.max(minX, vx + side * LIFE.besideM));
          trot(n, tx, Math.max(lz, vz - LIFE.behindM), vx);
          return;
        }
        case 'back':
          if (trot(n, lx, lz, Number.NaN)) {
            face = faceOf(base.x - gx);
            begin('up', c.t);
          }
          return;
        case 'up':
          if (s < LIFE.hopS) hop(s / LIFE.hopS, gx, 0, gz, base.x, base.y, base.z);
          else if (s - LIFE.hopS < endOf(CURL)) {
            sample(CURL, s - LIFE.hopS);
            write(base.x, base.y, base.z, 1, pose.sx, pose.sy, 0);
          } else rest();
          return;
      }
    },
  };
}
