import type { Channel } from '../types.ts';
import { clamp01, omegaFor, springStep, type SpringState } from './motion.ts';

/**
 * Transition channels (cook/ARCH.md 2.3): a value in 0..1 that can be retargeted at any moment and always continues
 * from its current value and velocity. Nothing here allocates after construction, so tick() is safe in frame code.
 */

/** The machine's view of a channel: the public Channel plus the knobs the transition table needs. */
export interface DriveChannel extends Channel {
  /** Changes the duration of the remaining motion without a jump (spring: new omega; tween: re-based). */
  retime(durationS: number): void;
  /** Places the channel at `value` moving with `velocity` (per second), keeping its target. */
  set(value: number, velocity: number): void;
}

class SpringChannel implements DriveChannel {
  private readonly s: SpringState = { x: 0, v: 0 };
  private omega: number;
  private goal = 0;
  private done = true;
  /** A snap from outside the machine (test API, ?shot) settles the channel: the next tick reports it once. */
  private snapped = false;

  constructor(durationS: number) {
    this.omega = omegaFor(durationS);
  }

  get value(): number { return this.s.x; }
  get target(): number { return this.goal; }
  get velocity(): number { return this.s.v; }
  get settled(): boolean { return this.done; }

  to(target: number): void {
    const t = clamp01(target);
    if (t === this.goal) return;
    this.goal = t;
    this.done = this.s.x === t && this.s.v === 0;
  }

  snap(v: number): void {
    this.s.x = clamp01(v);
    this.s.v = 0;
    this.goal = this.s.x;
    this.done = true;
    this.snapped = true;
  }

  /** Coasts to a stop: the target becomes where the current velocity carries it, so there is no kink. */
  hold(): void {
    this.goal = clamp01(this.s.x + this.s.v / this.omega);
    this.done = this.s.x === this.goal && this.s.v === 0;
  }

  retime(durationS: number): void {
    this.omega = omegaFor(durationS);
  }

  set(value: number, velocity: number): void {
    this.s.x = clamp01(value);
    this.s.v = velocity;
    this.done = this.s.x === this.goal && velocity === 0;
  }

  tick(dt: number): boolean {
    if (this.done) {
      const snapped = this.snapped;
      this.snapped = false;
      return snapped;
    }
    let settled = springStep(this.s, this.goal, this.omega, dt);
    if (this.s.x < 0 || this.s.x > 1) {
      this.s.x = clamp01(this.s.x);
      this.s.v = 0;
      settled = this.s.x === this.goal;
    }
    this.done = settled;
    return settled;
  }
}

class TweenChannel implements DriveChannel {
  private from = 0;
  private goal = 0;
  private x = 0;
  private v = 0;
  private elapsed = 0;
  private span = 0;
  private done = true;
  /** As in SpringChannel: the tick after a snap reports the settle once. */
  private snapped = false;
  private readonly durationS: number;
  private readonly ease: (x: number) => number;

  constructor(durationS: number, ease: (x: number) => number) {
    this.durationS = durationS;
    this.ease = ease;
  }

  get value(): number { return this.x; }
  get target(): number { return this.goal; }
  get velocity(): number { return this.v; }
  get settled(): boolean { return this.done; }

  /** Re-bases from the current value; the time scales with the distance, so a reversal halfway takes half as long. */
  to(target: number): void {
    const t = clamp01(target);
    if (t === this.goal) return;
    this.rebase(t, this.durationS * Math.abs(t - this.x));
  }

  snap(v: number): void {
    this.x = this.from = this.goal = clamp01(v);
    this.v = 0;
    this.done = true;
    this.snapped = true;
  }

  hold(): void {
    this.snap(this.x);
  }

  /** Finishes the current motion within `durationS` from where it is (used by the intro skip). Never slows it down. */
  retime(durationS: number): void {
    if (this.done || this.span - this.elapsed <= durationS) return;
    this.rebase(this.goal, durationS);
  }

  set(value: number, velocity: number): void {
    this.x = clamp01(value);
    this.v = velocity;
    this.rebase(this.goal, this.durationS * Math.abs(this.goal - this.x));
  }

  tick(dt: number): boolean {
    if (this.done) {
      const snapped = this.snapped;
      this.snapped = false;
      return snapped;
    }
    this.elapsed += dt;
    const prev = this.x;
    if (this.elapsed >= this.span) {
      this.x = this.goal;
      this.v = 0;
      this.done = true;
      return true;
    }
    this.x = this.from + (this.goal - this.from) * this.ease(this.elapsed / this.span);
    this.v = dt > 0 ? (this.x - prev) / dt : this.v;
    return false;
  }

  private rebase(target: number, spanS: number): void {
    this.from = this.x;
    this.goal = target;
    this.elapsed = 0;
    this.span = spanS;
    this.done = this.x === target;
    if (this.done) this.v = 0;
  }
}

/** Critically damped spring, closed form, exact for any dt, never leaves 0..1. Starts settled at 0. */
export const spring = (durationS: number): DriveChannel => new SpringChannel(durationS);

/** Eased clock over `durationS` for the full 0..1 distance; to() mid-flight re-bases so the value stays continuous. */
export const tween = (durationS: number, ease: (x: number) => number): DriveChannel => new TweenChannel(durationS, ease);
