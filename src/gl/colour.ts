import type { Vector3 } from 'three';

/** sRGB 0..1 to linear, the exact piecewise curve. */
export function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Writes the linear colour of an sRGB hex ('#rrggbb') into `out`, scaled by `k`. Load time only (parses a string). */
export function linearHex(hex: string, out: Vector3, k = 1): Vector3 {
  const n = Number.parseInt(hex.slice(1), 16);
  return out.set(toLinear(((n >> 16) & 255) / 255) * k, toLinear(((n >> 8) & 255) / 255) * k, toLinear((n & 255) / 255) * k);
}

/** Display-referred (sRGB 0..1) colour of a hex, for values the film pass applies after its encode. */
export function displayHex(hex: string, out: Vector3): Vector3 {
  const n = Number.parseInt(hex.slice(1), 16);
  return out.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
