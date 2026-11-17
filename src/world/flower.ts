/**
 * Flower (ARCH 2.8, spec §3.3 and §7): a project flower that rests at the bloom stage of its status and opens in
 * stop-motion when focused. Bloom poses advance on the stepped 12 fps clock, one pose per tick opening (750 ms over
 * 10 poses) and two per tick closing (375 ms), starting one tick after focus. The turn toward the camera runs at
 * full rate, from the slot's hinge to face the camera. A visited flower (garden memory) stays open instead of closing.
 * Frozen time (?t) and reduced motion show the target pose at once.
 */
import type { Clock, Flower, InstanceWriter, Project, QuadParams, SlotView, SpriteRect, BloomDef, SpriteId } from '../types.ts';
import { BLOOM_POSES, EASE_OUT, STEP_FPS, UI, bloomAt, clamp01 } from '../core/motion.ts';

const LAST_POSE = BLOOM_POSES.length - 1;
const CLOSE_POSES_PER_TICK = 2;
const WHITE: readonly number[] = [1, 1, 1, 1];
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
}

export interface GardenFlower extends Flower {
  /** Current openness 0..1, quantised to the bloom's steps. */
  readonly openness: number;
  /** True when update() changed what write() would output since the last write(). */
  readonly dirty: boolean;
  /** Visited this or an earlier visit: rests open. */
  setVisited(on: boolean): void;
}

/** Bloom stage at rest for a status, as the first pose at least that open. */
export function restPose(bloom: BloomDef, status: Project['status']): number {
  const stage = clamp01(bloom.rest[status]);
  for (let i = 0; i <= LAST_POSE; i++) if (bloomAt(i) >= stage - 1e-6) return i;
  return LAST_POSE;
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
  const phase = (slot.world[0] * 1.37) % (2 * Math.PI);
  let focused = false;
  let visited = false;
  let pose = rest;
  let lastTick = -1;
  let turn = 0;
  let openness = quantise(bloomAt(rest), bloom.steps);
  let dirty = true;

  function setQuad(rect: SpriteRect | undefined, z: number, rot: number, k: number): void {
    const s = scale * k;
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
    quad.facing = -hinge * (1 - EASE_OUT(turn));
  }

  return {
    slot,
    quads,
    get openness() { return openness; },
    get dirty() { return dirty; },
    setFocused(on) {
      focused = on;
    },
    setVisited(on) {
      visited = on;
    },
    update(c: Clock) {
      const target = focused || visited ? LAST_POSE : rest;
      const tick = Math.floor(c.t * STEP_FPS);
      if (c.frozen || env.state.reduced) {
        pose = target;
      } else if (lastTick >= 0 && tick > lastTick) {
        const n = tick - lastTick;
        pose = pose < target ? Math.min(target, pose + n) : Math.max(target, pose - n * CLOSE_POSES_PER_TICK);
      }
      lastTick = tick;
      const nextOpen = quantise(bloomAt(pose), bloom.steps);
      const nextTurn = clamp01(turn + ((focused ? 1 : -1) * c.dt) / UI.flowerTurnS);
      if (nextOpen !== openness || nextTurn !== turn) dirty = true;
      openness = nextOpen;
      turn = nextTurn;
    },
    write(w: InstanceWriter, at: number) {
      dirty = false;
      if (bloom.mode === 'frames') {
        const i = Math.round(openness * Math.max(0, frames.length - 1));
        const id = frames[i];
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
