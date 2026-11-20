import { clamp01, EASE_OUT } from '../core/motion.ts';
import type { RigPose } from './rail.ts';

/**
 * La Salida, the way out to the CV: one timeline per direction, read off the paper sheet's own animation clock so the
 * camera, the iron gate, the mode layers and the wipe never drift apart. Out: the gate's leaves swing open and the
 * camera pushes through the doorway; a sheet of the CV's paper sweeps in from the right with an inked deckle edge once
 * the gate is nearly open, the mode layers switch under it, then the paper lifts off the page. Back: the paper settles
 * over the CV, the layers switch under it, and the sheet sweeps out to the right while the camera pulls back out of the
 * doorway and the gate swings shut. 0.9 s at most either way.
 */
export const EXIT = {
  /** Out: the gate opens and the push starts at once; the push lands as the sheet covers the view. */
  out: { totalS: 0.9, sweepFromS: 0.22, coverS: 0.54, liftFromS: 0.62 },
  /** Back: paper over the CV, held while the layers switch, then swept away. */
  back: { totalS: 0.86, coverS: 0.12, sweepFromS: 0.46 },
  /** How far the camera travels through the doorway (world units) and how much the view narrows (degrees). */
  pushM: 2.6,
  narrowDeg: 6,
} as const;

/**
 * Shared with the camera, the mode layers and the iron gate (gl/irongate.ts, which swings open on the push). push 0..1
 * along the view; hold, when >= 0, stands in for ch.mode.
 */
export const exitGate = { push: 0, hold: -1 };

/** The mode progress the layers show: held while the garden must stay seen (out) or the CV stay put (back). */
export const heldMode = (p: number): number => (exitGate.hold < 0 ? p : exitGate.hold);

const easeIn = (x: number): number => x * x * x;

/** Push 0..1 at `t` seconds into a run: an accelerating step through on the way out, a settling pull back on return. */
export function pushAt(out: boolean, t: number): number {
  if (out) return easeIn(clamp01(t / EXIT.out.coverS));
  return 1 - EASE_OUT(clamp01((t - EXIT.back.sweepFromS) / (EXIT.back.totalS - EXIT.back.sweepFromS)));
}

/** The layer hold at `t` seconds: -1 once the paper covers the view, so the switch happens out of sight. */
export const holdAt = (out: boolean, t: number): number =>
  out ? (t < EXIT.out.coverS ? 0 : -1) : t < EXIT.back.coverS ? 1 : -1;

/** Moves the camera forward along its view by the current push. No allocation. */
export function pushThrough(pose: RigPose): void {
  const k = exitGate.push;
  if (k <= 0) return;
  const d = k * EXIT.pushM;
  const cp = Math.cos(pose.pitch);
  pose.x += Math.sin(pose.yaw) * cp * d;
  pose.y += Math.sin(pose.pitch) * d;
  pose.z -= Math.cos(pose.yaw) * cp * d;
  pose.fov -= k * EXIT.narrowDeg;
  if (pose.fov < 1) pose.fov = 1;
}
