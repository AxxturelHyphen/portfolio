import type { Vector4 } from 'three';

/**
 * The visitor's wake on the Estanque: while the roaming visitor walks along the bank, every WAKE.stride metres a soft
 * ripple starts at the nearest point of the water's edge and spreads out (pond.frag.glsl wakeSlope). A ring buffer of
 * WAKE_SOURCES vec4s (x, z, birth time, amplitude) the shader reads; a source older than WAKE_LIFE seconds (in the shader) is spent.
 */
export const WAKE_SOURCES = 6;
const WAKE = {
  /** Metres walked between two ripples. */
  stride: 0.55,
  /** How far outside the water's edge the visitor still stirs it (metres). */
  reach: 0.9,
  /** Where on the radius a ripple starts (1 is the edge): just inside, so the first ring is on the water. */
  start: 0.96,
} as const;

export interface Wake {
  /** One frame: the visitor's ground point, the shared clock and the water's rectangle. No allocation. */
  step(x: number, z: number, t: number, rect: Vector4): void;
  /** Drops every live ripple (reduced motion, rail). */
  clear(): void;
}

export function createWake(sources: readonly Vector4[]): Wake {
  let next = 0;
  let lastX = Number.NaN;
  let lastZ = Number.NaN;

  return {
    step(x, z, t, rect) {
      const cx = (rect.x + rect.z) * 0.5;
      const cz = (rect.y + rect.w) * 0.5;
      const rx = Math.abs(rect.z - rect.x) * 0.5;
      const rz = Math.abs(rect.w - rect.y) * 0.5;
      if (rx <= 0 || rz <= 0) return;
      const ux = (x - cx) / rx;
      const uz = (z - cz) / rz;
      const radius = Math.hypot(ux, uz);
      const outside = (radius - 1) * Math.min(rx, rz);
      if (outside > WAKE.reach || radius < 1e-3) {
        lastX = Number.NaN;
        return;
      }
      if (!Number.isNaN(lastX) && Math.hypot(x - lastX, z - lastZ) < WAKE.stride) return;
      lastX = x;
      lastZ = z;
      const k = Math.min(radius, WAKE.start) / radius;
      const amplitude = 1 - 0.6 * Math.max(0, outside) / WAKE.reach;
      sources[next]?.set(cx + ux * k * rx, cz + uz * k * rz, t, amplitude);
      next = (next + 1) % WAKE_SOURCES;
    },
    clear() {
      for (let i = 0; i < sources.length; i++) sources[i]!.w = 0;
      lastX = Number.NaN;
    },
  };
}
