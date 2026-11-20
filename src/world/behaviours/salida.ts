/**
 * Salida behaviour: swallows on the stepped clock (cook/ART.md 2.6 "Other swallows"). Three birds fly loops from the
 * upper right over the low wall and back to the branch; each pose is a real drawing (dive, glide, up-wing) swapped on
 * twos of the 12 fps clock, never a scaled or squeezed sprite. Between loops a bird rests out of sight behind the
 * canopy, so the perched pair on the branch stays the still note. Frozen time freezes the loop where it stands.
 * The bed is also the way out to the CV: switching to the Herbario from here runs the paper exit (world/salida.exit.ts).
 */
import type { BedBehaviour, Clock, QuadParams, SpriteRect, State } from '../../types.ts';
import { STEP_FPS } from '../../core/motion.ts';
import type { StreamBedCtx } from '../bed.ts';
import { QUAD_FLAG, packPhase } from '../quadflags.ts';
import { createSalidaExit } from '../salida.exit.ts';

const POSES = ['sa/swallow-glide', 'sa/swallow-up', 'sa/swallow-dive', 'sa/swallow-up'] as const;
/** Ticks of the 12 fps clock per pose: on twos. */
const HOLD = 2;
/** One loop: start (upper right, behind the canopy), the low point over the wall, the end back at the canopy. */
const LOOP = { x0: 46.5, x1: 38.0, yTop: 4.4, yLow: 2.3, z: -3.0, seconds: 5.5 } as const;
const BIRDS = [
  { offset: 0, every: 11, w: 0.34, dz: 0 },
  { offset: 4.2, every: 14, w: 0.28, dz: -1.2 },
  { offset: 8.1, every: 17, w: 0.24, dz: -2.0 },
] as const;

export default function salida(ctx: StreamBedCtx): BedBehaviour {
  const exit = createSalidaExit(ctx.machine);
  const swallows = createSwallows(ctx);
  return {
    update(c: Clock) {
      exit.update();
      swallows.update(c);
    },
    onState(s: State, prev: State) {
      exit.onState(s, prev);
    },
    dispose() {
      exit.dispose();
      swallows.dispose();
    },
  };
}

function createSwallows(ctx: StreamBedCtx): { update(c: Clock): void; dispose(): void } {
  const { actors, sprites } = ctx;
  const rects: SpriteRect[] = [];
  for (const id of POSES) {
    const r = sprites[id];
    if (r !== undefined) rects.push(r);
  }
  if (rects.length === 0) return { update() {}, dispose() {} };
  const tint = [0.72, 0.74, 0.8, 1];
  const q: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0.5, py: 0.5, uv: [0, 0, 0, 0], sway: 0, phase: packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.noShadow), lift: 0, facing: 0, tint };
  let lastTick = -1;

  return {
    update(c: Clock) {
      const tick = Math.floor(c.t * STEP_FPS / HOLD);
      if (tick === lastTick) return;
      lastTick = tick;
      const t = tick * HOLD / STEP_FPS;
      let n = 0;
      for (let b = 0; b < BIRDS.length; b++) {
        const bird = BIRDS[b];
        if (bird === undefined) continue;
        const local = (t + bird.offset) % bird.every;
        if (local > LOOP.seconds) continue;
        const k = local / LOOP.seconds;
        const rect = rects[(tick + b) % rects.length];
        if (rect === undefined) continue;
        const aspect = rect.size[1] / Math.max(1e-6, rect.size[0]);
        q.x = LOOP.x0 + (LOOP.x1 - LOOP.x0) * k;
        q.y = LOOP.yTop - (LOOP.yTop - LOOP.yLow) * Math.sin(Math.PI * k);
        q.z = LOOP.z + bird.dz;
        q.rot = (k < 0.5 ? 0.25 : -0.2) * (1 - 2 * Math.abs(k - 0.5));
        q.w = bird.w;
        q.h = bird.w * aspect;
        q.px = rect.pivot[0];
        q.py = rect.pivot[1];
        q.uv = rect.uv;
        actors.set(n++, q);
      }
      actors.count = n;
      actors.commit(0, n);
    },
    dispose() {
      actors.count = 0;
    },
  };
}
