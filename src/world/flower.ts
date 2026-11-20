/**
 * Flower (ARCH 2.8, spec §3.3 and §7): a project flower that rests at the bloom stage of its status and opens in
 * stop-motion when focused. Bloom poses advance on the stepped 12 fps clock, one pose per tick opening (750 ms over
 * 10 poses) and two per tick closing (375 ms), starting one tick after focus. The turn toward the camera runs at
 * full rate, from the slot's hinge to face the camera. A visited flower (garden memory) stays open instead of closing.
 * Frozen time (?t) and reduced motion show the target pose at once.
 * Entering the project unfurls it further: on the open channel (setEntered), it opens to its last pose, swells and leans
 * back a little in UNFURL_STEPS stop-motion steps while the iris closes on it, and folds back as the panel closes.
 * Frozen time and reduced motion switch it open or shut at once.
 * Its life (flower.life.ts) sways and breathes it at rest, opens it toward a visitor within reach and pops it as the
 * project opens; a flower within reach opens like a focused one.
 */
import type { Clock, Flower, InstanceWriter, Project, QuadParams, SlotView, SpriteRect, BloomDef, SpriteId } from '../types.ts';
import { BLOOM_POSES, EASE_OUT, STEP_FPS, UI, bloomAt, clamp01 } from '../core/motion.ts';
import { packPhase } from './quadflags.ts';
import { createFlowerLife } from './flower.life.ts';

const LAST_POSE = BLOOM_POSES.length - 1;
const CLOSE_POSES_PER_TICK = 2;
const WHITE: readonly number[] = [1, 1, 1, 1];
/**
 * The unfurl on entering: extra scale, lean in radians around the base, the stop-motion steps it moves in, and `lead`,
 * the share of the iris's closing leg by which it is fully open (early, while the iris still shows the flower whole).
 */
export const UNFURL = { scale: 0.3, lean: 0.09, steps: 6, lead: 0.35 } as const;
const NO_UV: readonly number[] = [0, 0, 0, 0];

/** One scratch quad for every flower: write() fills it and hands it to the writer, which copies it. */
const quad: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0.5, py: 0, uv: NO_UV, sway: 0, phase: 0, lift: 0, facing: 0, tint: WHITE };

export interface FlowerOptions {
  slot: SlotView;
  bloom: BloomDef;
  sprites: Readonly<Record<SpriteId, SpriteRect>>;
  /** Slot scale from the BedScene (world size = sprite size x scale). */
  scale: number;
  /** Read every frame; a Machine fits. */
  env: { readonly state: { readonly reduced: boolean } };
  /** Slot yaw in radians, plus turns the right edge toward the camera; focus turns it to face the camera. */
  hinge: number;
  /** QUAD_FLAG.turn when the flower stands as a standee (quadflags.ts turnFlag), else 0 or left out. */
  turn?: number;
  /** Free roam: the visitor's [x, z], read every frame (left out or null: no visitor). */
  visitor?: ArrayLike<number> | null;
}

export interface GardenFlower extends Flower {
  /** Current openness 0..1, quantised to the bloom's steps. */
  readonly openness: number;
  /** True when update() changed what write() would output since the last write(). */
  readonly dirty: boolean;
  /** Visited this or an earlier visit: rests open. */
  setVisited(on: boolean): void;
  /** Current unfurl 0..1, quantised to UNFURL.steps. */
  readonly unfurl: number;
  /** The project is being entered: `k` how far (the open channel up to the iris shut), `up` whether it is wanted open. */
  setEntered(k: number, up: boolean): void;
}

/** The unfurl shown for an entering amount: stepped, or all or nothing under frozen time and reduced motion. */
export function unfurlOf(k: number, up: boolean, instant: boolean): number {
  if (instant) return up ? 1 : 0;
  const n = UNFURL.steps - 1;
  return Math.round(clamp01(k) * n) / n;
}

/** Bloom pose at rest for a status: rest values are pose fractions (cook/ART.md 3.5: idea 1, wip 7, shipped 9). */
export function restPose(bloom: BloomDef, status: Project['status']): number {
  return Math.round(clamp01(bloom.rest[status]) * LAST_POSE);
}

/** The drawing shown at a pose: frames are replaced by pose, never chosen by openness (no frame skipped or scaled). */
export function frameAt(pose: number, frames: number): number {
  return frames <= 1 ? 0 : Math.round((pose * (frames - 1)) / LAST_POSE);
}

/** Openness quantised to `steps` levels (steps < 2 means open or closed). */
export function quantise(openness: number, steps: number): number {
  const n = Math.max(1, steps - 1);
  return Math.round(clamp01(openness) * n) / n;
}

export function createFlower(o: FlowerOptions): GardenFlower {
  const { slot, bloom, sprites, scale, env, hinge } = o;
  const rest = restPose(bloom, slot.project?.status ?? 'idea');
  const petals = bloom.petals ?? [];
  const frames = bloom.frames ?? [];
  const quads = bloom.mode === 'petals' ? petals.length : 1;
  const swayPhase = (slot.world[0] * 1.37) % (2 * Math.PI);
  const phase = o.turn === undefined || o.turn === 0 ? swayPhase : packPhase(swayPhase, o.turn);
  let focused = false;
  let visited = false;
  let pose = rest;
  let shownPose = -1;
  let lastTick = -1;
  let turn = 0;
  let openness = quantise(bloomAt(rest), bloom.steps);
  let dirty = true;
  let enterK = 0;
  let enterUp = false;
  let unfurl = 0;
  const life = createFlowerLife(slot, swayPhase);
  const visitor = o.visitor ?? null;
  const facingOf = (): number => -hinge * (1 - EASE_OUT(turn));

  function setQuad(rect: SpriteRect | undefined, z: number, rot: number, k: number): void {
    const u = EASE_OUT(unfurl);
    const s = scale * k * (1 + UNFURL.scale * u) * life.scale;
    rot += UNFURL.lean * u + life.rot;
    quad.x = slot.world[0];
    quad.y = slot.world[1];
    quad.z = z;
    quad.rot = rot;
    quad.w = rect === undefined ? 0 : rect.size[0] * s;
    quad.h = rect === undefined ? 0 : rect.size[1] * s;
    quad.px = rect === undefined ? 0.5 : rect.pivot[0];
    quad.py = rect === undefined ? 0 : rect.pivot[1];
    quad.uv = rect === undefined ? NO_UV : rect.uv;
    quad.phase = phase;
    quad.facing = facingOf() + life.yaw;
  }

  return {
    slot,
    quads,
    get openness() { return openness; },
    get dirty() { return dirty; },
    get unfurl() { return unfurl; },
    setFocused(on) {
      focused = on;
    },
    setVisited(on) {
      visited = on;
    },
    setEntered(k, up) {
      if (up && !enterUp) life.pop();
      enterK = k;
      enterUp = up;
    },
    update(c: Clock) {
      const still = env.state.reduced;
      if (life.step(c, visitor, facingOf(), still)) dirty = true;
      const target = focused || visited || enterUp || life.near ? LAST_POSE : rest;
      const tick = Math.floor(c.t * STEP_FPS);
      if (c.frozen || still) {
        pose = target;
      } else if (lastTick >= 0 && tick > lastTick) {
        const n = tick - lastTick;
        pose = pose < target ? Math.min(target, pose + n) : Math.max(target, pose - n * CLOSE_POSES_PER_TICK);
      }
      lastTick = tick;
      const nextOpen = quantise(bloomAt(pose), bloom.steps);
      const nextTurn = c.frozen ? (focused ? 1 : 0) : clamp01(turn + ((focused ? 1 : -1) * c.dt) / UI.flowerTurnS);
      const nextUnfurl = unfurlOf(enterK, enterUp, c.frozen || still);
      if (pose !== shownPose || nextOpen !== openness || nextTurn !== turn || nextUnfurl !== unfurl) dirty = true;
      openness = nextOpen;
      turn = nextTurn;
      unfurl = nextUnfurl;
    },
    write(w: InstanceWriter, at: number) {
      dirty = false;
      shownPose = pose;
      if (bloom.mode === 'frames') {
        const id = frames[frameAt(pose, frames.length)];
        setQuad(id === undefined ? undefined : sprites[id], slot.world[2], 0, 1);
        w.set(at, quad);
        return 1;
      }
      for (let i = 0; i < petals.length; i++) {
        const p = petals[i]!;
        const k = clamp01((openness - p.delay) / Math.max(1e-6, 1 - p.delay));
        const rot = p.angle + p.closed[0] + (p.open[0] - p.closed[0]) * k;
        const sc = p.closed[1] + (p.open[1] - p.closed[1]) * k;
        setQuad(sprites[p.sprite], slot.world[2] + p.ring * 1e-3, rot, sc);
        w.set(at + i, quad);
      }
      return petals.length;
    },
  };
}
