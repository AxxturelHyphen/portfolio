import type { Clock } from '../types.ts';
import { STEP_FPS } from './motion.ts';

/**
 * The one deterministic clock (cook/ARCH.md 2.3). `dt` is real frame time clamped to 0.05 s and drives channels,
 * camera and UI. `t` is content time: it follows the frames (long gaps clamped, so a hidden tab never jumps) or is
 * frozen by `?t`. Content that animates in stop-motion reads step12(t), never t directly.
 */

export const MAX_DT_S = 0.05;

/** The loop's handle: one advance() per rAF, before any stage runs. */
export interface ClockDriver extends Clock {
  advance(nowMs: number): void;
  /** Freezes content time at `t` seconds (`?t`, the test API). Channels keep running on real dt. */
  setT(t: number): void;
}

class FrameClock implements ClockDriver {
  now = 0;
  dt = 0;
  t = 0;
  frame = 0;
  frozen = false;
  private last = -1;

  constructor(frozenT: number | undefined) {
    if (frozenT !== undefined) this.setT(frozenT);
  }

  advance(nowMs: number): void {
    const d = this.last < 0 ? 0 : (nowMs - this.last) / 1000;
    this.dt = d < 0 ? 0 : d > MAX_DT_S ? MAX_DT_S : d;
    this.last = nowMs;
    this.now = nowMs;
    this.frame++;
    if (!this.frozen) this.t += this.dt;
  }

  setT(t: number): void {
    this.t = t;
    this.frozen = true;
  }
}

export const createClock = (frozenT?: number): ClockDriver => new FrameClock(frozenT);

/** floor(t * 12) / 12: stepped content time (spec section 2); never for camera, UI or channels. */
export const step12 = (t: number): number => Math.floor(t * STEP_FPS + 1e-6) / STEP_FPS;
