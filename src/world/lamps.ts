/**
 * The lanterns that burn with their own amber light under free roam (cook/ROAM_PLAN.md 3, P5): lamp 0 is the lantern
 * the visitor carries, lamps 1 and 2 are the active bed's standing lantern props while they are on screen. Each lamp is
 * a vec4 (flame xyz, strength) in one flat array, the layout of the shader's uLamp[3].
 */
import { follow } from '../core/motion.ts';
import type { BedScene3 } from './layout.ts';

export const LAMPS = {
  /** Lamps in the shader: the carried lantern and up to `standing` props. */
  count: 3,
  standing: 2,
  prefix: 'sh/lantern',
  /** The flame sits at this share of a standing prop's height (the candle inside the cage). */
  flameOfHeight: 0.55,
  defaultH: 0.4,
  /** A standing lamp lights up and dims on this follower as it enters or leaves the screen, so no pool pops. */
  fadeTauS: 0.35,
} as const;

/**
 * Flame positions of a bed's standing lantern props, at most LAMPS.standing, into `out` (vec4s, strength 0). Runs on a
 * bed change, never per frame. Returns how many were found.
 */
export function findLamps(scene: BedScene3 | null, out: Float32Array): number {
  out.fill(0);
  if (scene === null) return 0;
  let n = 0;
  for (const layer of scene.layers) {
    for (const it of layer.items) {
      if (n >= LAMPS.standing || !it.sprite.startsWith(LAMPS.prefix)) continue;
      const o = n * 4;
      out[o] = it.x;
      out[o + 1] = it.y + (it.h ?? LAMPS.defaultH) * it.scale * LAMPS.flameOfHeight;
      out[o + 2] = it.z;
      n++;
    }
  }
  return n;
}

/** Whether a world point is on screen (the rig's projection). */
export type OnScreen = (x: number, y: number, z: number) => boolean;

/**
 * One frame of the lamp list: the carried flame (strength 1) first, then each found standing lamp easing toward 1 on
 * screen and 0 off it (snapped under frozen time). `standing` holds `n` vec4s from findLamps; `out` gets LAMPS.count.
 */
export function stepLamps(out: Float32Array, cx: number, cy: number, cz: number, standing: Float32Array, n: number,
  onScreen: OnScreen, dt: number, snap: boolean): void {
  out[0] = cx;
  out[1] = cy;
  out[2] = cz;
  out[3] = 1;
  for (let i = 0; i < LAMPS.standing; i++) {
    const o = (i + 1) * 4;
    const s = i * 4;
    const shown = i < n && onScreen(standing[s]!, standing[s + 1]!, standing[s + 2]!);
    out[o] = standing[s]!;
    out[o + 1] = standing[s + 1]!;
    out[o + 2] = standing[s + 2]!;
    const want = shown ? 1 : 0;
    out[o + 3] = snap ? want : follow(out[o + 3]!, want, LAMPS.fadeTauS, dt);
  }
}
