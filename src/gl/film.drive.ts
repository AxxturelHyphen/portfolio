import type { Vector3, Vector4 } from 'three';
import type { Clock, FilmUniforms } from '../types.ts';
import { FILM, STEP_FPS } from '../core/motion.ts';

/**
 * The film pass's own per-frame motion (cook/MOTION.md B25, B26, C3 to C7): gate weave, exposure flicker, the
 * halation that trails the flicker, a rare hairline scratch, and the breathing of the hand-tint regions.
 * All of it is a pure function of content time plus two small pieces of state, so stills at a fixed ?t repeat.
 */
export interface FilmExtras { uScratch: { value: Vector3 }; uHalGain: { value: number } }

/** Std of the smoothstep-interpolated knot noise, used to turn an rms target into an amplitude. */
const KNOT_NOISE_STD = 0.45;
const SEED_FPS = 24;
/** Halation gain at rest (cook/SHOTS.md B: +0.17 at the edge over a mid ground). */
export const HALATION_GAIN = 2.0;
/** A scratch, once the 6 s gap has passed, starts on a tick with this chance: about one every 9 s. */
const SCRATCH_CHANCE = 1 / (3 * STEP_FPS);
const SCRATCH_OPACITY = 0.32;
/** Hand-tint regions: x, width, hue shift (radians), amount. Warm left, neutral centre, cool right. */
const REGIONS = [[0.12, 0.32, 0.045, 1], [0.5, 0.3, 0.0, 0], [0.88, 0.34, -0.05, 1]] as const;
const TINT_BREATH = { amountRms: 0.03, hueRms: 0.0175, hz: 0.6 } as const;

function knot(i: number, salt: number): number {
  let n = Math.imul(i ^ salt, 0x27d4eb2d);
  n = Math.imul(n ^ (n >>> 15), 0x165667b1);
  n ^= n >>> 13;
  return ((n >>> 0) / 4294967295) * 2 - 1;
}

/** Smooth value noise over integer knots at `rate` per second: no content above `rate` Hz. */
function knotNoise(t: number, rate: number, salt: number): number {
  const x = t * rate;
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return knot(i, salt) + (knot(i + 1, salt) - knot(i, salt)) * s;
}

const clampAbs = (v: number, limit: number): number => (v > limit ? limit : v < -limit ? -limit : v);

export interface FilmDrive { tick(c: Clock, reduced: boolean, exposure: number): void }

export function createFilmDrive(u: FilmUniforms, x: FilmExtras): FilmDrive {
  let lagged = 0;
  let lastNow = -1;
  let scratchTick = -1e9;
  let lastTick = -1;

  for (let i = 0; i < REGIONS.length; i++) {
    const r = REGIONS[i];
    if (r !== undefined) u.uTint.value[i]?.set(r[0], r[1], r[2], r[3]);
  }

  const breathe = (t: number): void => {
    for (let i = 0; i < REGIONS.length; i++) {
      const r = REGIONS[i];
      const v: Vector4 | undefined = u.uTint.value[i];
      if (r === undefined || v === undefined) continue;
      v.z = r[2] + knotNoise(t, TINT_BREATH.hz, 0x71 + i) * (TINT_BREATH.hueRms / KNOT_NOISE_STD);
      v.w = r[3] * (1 + knotNoise(t, TINT_BREATH.hz, 0x91 + i) * (TINT_BREATH.amountRms / KNOT_NOISE_STD));
    }
  };

  const scratch = (t: number): void => {
    const tick = Math.floor(t * STEP_FPS);
    const s = x.uScratch.value;
    if (tick === lastTick) return;
    lastTick = tick;
    if (tick - scratchTick < FILM.scratchTicks) return;
    s.y = 0;
    if ((tick - scratchTick) / STEP_FPS < FILM.scratchMinGapS || (knot(tick, 0x5c) + 1) / 2 > SCRATCH_CHANCE) return;
    scratchTick = tick;
    const res = u.uRes.value;
    const aspect = res.y > 0 ? res.x / res.y : 1;
    const p = u.uProtect.value;
    let sx = 0.08 + 0.84 * (knot(tick, 0x2d) + 1) / 2;
    if (p.z > 0 && Math.abs(sx - p.x) * aspect < p.z + 0.02) sx = p.x + (sx < p.x ? -1 : 1) * (p.z + 0.06) / aspect;
    s.set(sx < 0.02 ? sx + 0.5 : sx > 0.98 ? sx - 0.5 : sx, SCRATCH_OPACITY, knot(tick, 0x33) * 3);
  };

  return {
    tick(c, reduced, exposure) {
      u.uTime.value = c.t;
      u.uSeed.value = Math.floor(c.t * SEED_FPS);
      u.uStatic.value = reduced ? 1 : 0;
      const weave = u.uWeave.value;
      if (reduced) {
        weave.set(0, 0);
        u.uFlicker.value = exposure - 1;
        x.uScratch.value.y = 0;
        x.uHalGain.value = HALATION_GAIN;
        return;
      }
      const res = u.uRes.value;
      const aspect = res.y > 0 ? res.x / res.y : 1;
      const wAmp = FILM.weaveRms / KNOT_NOISE_STD;
      weave.set(
        clampAbs(knotNoise(c.t, STEP_FPS, 0x51) * wAmp, FILM.weaveClamp) / aspect,
        clampAbs(knotNoise(c.t, STEP_FPS, 0x9e) * wAmp, FILM.weaveClamp),
      );
      const flicker = clampAbs(knotNoise(c.t, FILM.flickerMaxHz, 0x3c) * (FILM.flickerRms / KNOT_NOISE_STD), FILM.flickerClamp);
      u.uFlicker.value = (1 + flicker) * exposure - 1;
      const dt = lastNow < 0 ? 0 : Math.min(0.1, (c.now - lastNow) / 1000);
      lastNow = c.now;
      lagged += (flicker - lagged) * (dt > 0 ? 1 - Math.exp(-dt / FILM.halationLagS) : 1);
      x.uHalGain.value = HALATION_GAIN * (1 + lagged * 2);
      scratch(c.t);
      breathe(c.t);
    },
  };
}
