/**
 * The moth's flutter: an irregular wing beat that now and then holds the wings out in a short glide, a bob of the body
 * on each downstroke, and an erratic path of quick darts over a slow drift. Every value is a pure function of the
 * content clock, so a frozen still (`?t`) is exact and nothing accumulates frame to frame.
 */

export const FLUTTER = {
  /** Mean wing beats per second, and how far the rate swings either side of it, and how fast it swings (rad/s). */
  beatHz: 9,
  beatSwingHz: 2.5,
  swingRate: 0.7,
  /** Openness held through a glide, and the band of the glide wave in which the wings hold. */
  glideOpen: 0.85,
  glideBand: [0.6, 0.9],
  /** Body lift on the downstroke (metres). */
  bobM: 0.012,
  /** Slow drift per axis x, y, z (metres) at wander 1. */
  driftM: [0.08, 0.05, 0.06],
  /** Darts per axis: reach (metres) at wander 1, the beat each holds, and the time each quick move takes (s). */
  dartM: [0.15, 0.09, 0.11],
  dartS: [0.53, 0.71, 0.89],
  dartEaseS: 0.12,
} as const;

const TAU = Math.PI * 2;

/** Deterministic noise in -1..1 for an integer key. */
function hash(k: number): number {
  const s = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

function smooth(e0: number, e1: number, x: number): number {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
}

/**
 * Writes the flutter at time t into out: x, y, z offsets (metres) and the wing openness (0 raised together, 1 spread
 * flat). `wander` scales the path (0 holds the body on its line); `still` spreads the wings and holds everything.
 */
export function flutterAt(t: number, wander: number, still: boolean, out: Float32Array): void {
  if (still) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    return;
  }
  const w = FLUTTER.swingRate;
  const phase = TAU * (FLUTTER.beatHz * t + (FLUTTER.beatSwingHz / w) * Math.sin(w * t));
  const beat = Math.pow(0.5 + 0.5 * Math.cos(phase), 0.6);
  const glide = smooth(FLUTTER.glideBand[0], FLUTTER.glideBand[1], Math.sin(0.9 * t + 1.3 * Math.sin(0.37 * t)));
  out[3] = beat + (FLUTTER.glideOpen - beat) * glide;
  for (let i = 0; i < 3; i++) {
    const drift = FLUTTER.driftM[i]! * Math.sin(t * (1.3 + 0.4 * i) + i * 2.1) * Math.cos(t * (0.47 + 0.2 * i));
    const span = FLUTTER.dartS[i]!;
    const k = Math.floor(t / span);
    const f = smooth(0, FLUTTER.dartEaseS, t - k * span);
    const from = hash((k - 1) * 3 + i);
    const dart = FLUTTER.dartM[i]! * (from + (hash(k * 3 + i) - from) * f);
    out[i] = wander * (drift + dart);
  }
  out[1] = out[1]! + FLUTTER.bobM * (1 - glide) * Math.sin(phase);
}
