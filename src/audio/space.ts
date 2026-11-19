/**
 * Where the garden's sounds come from and how loud they are where the visitor stands. Distances are on the ground
 * plane in metres. Everything here is pure, so the engine stays a thin layer over Web Audio.
 */

export interface Spot { readonly x: number; readonly z: number }

/** The places that sound, read from the world layout by the garden (garden/sound.ts). */
export interface SoundMap {
  /** The Estanque water: centre and the radius of its shore. */
  pond: Spot & { readonly r: number };
  /** The music box: the mandala sundial's clockwork at the Estanque. */
  box: Spot;
  /** Trees and boxes a bird may call from. */
  perches: readonly Spot[];
}

/** Level 1 within `near`, falling as the square of the remaining way to silence at `far`. */
export function levelAt(d: number, near: number, far: number): number {
  if (d <= near) return 1;
  if (d >= far) return 0;
  const k = 1 - (d - near) / (far - near);
  return k * k;
}

/** Stereo position of a sound `dx` metres to the right: half way at 4 m, never hard to one side. */
export function panAt(dx: number): number {
  const p = dx / (Math.abs(dx) + 4);
  return p > 0.75 ? 0.75 : p < -0.75 ? -0.75 : p;
}

export const dist = (s: Spot, x: number, z: number): number => Math.hypot(s.x - x, s.z - z);

/**
 * A perch for the next call, between `min` and `max` metres from the visitor, picked with `r` in [0, 1); null when
 * none is in that ring (the bird stays quiet this time).
 */
export function perchFor(perches: readonly Spot[], x: number, z: number, min: number, max: number, r: number): Spot | null {
  let n = 0;
  for (const p of perches) {
    const d = dist(p, x, z);
    if (d >= min && d <= max) n++;
  }
  if (n === 0) return null;
  let pick = Math.floor(r * n);
  for (const p of perches) {
    const d = dist(p, x, z);
    if (d >= min && d <= max && pick-- === 0) return p;
  }
  return null;
}
