/**
 * The floating touch stick of free roam (core/input.ts): a finger put down in the stick's corner (ui/stick.ts draws
 * it) sets the stick's origin there; dragged past a tap's travel it pushes the stick, clamped to its throw, and the
 * walk follows the push each frame. A finger lifted before it moved is a tap (the caller walks to the ground tapped).
 * Handlers only keep numbers; no allocation.
 */

/** The stick's drawing: input moves it, it never takes events (pointer-events none). */
export interface StickPad {
  /** True when a touch down at this point (CSS px) starts the stick. */
  zone(xPx: number, yPx: number): boolean;
  /** Its throw (px): the knob pushed this far is full pace. */
  readonly reachPx: number;
  /** Shows the stick with its origin here. */
  show(xPx: number, yPx: number): void;
  /** The knob's offset from the origin (px, already clamped to the throw). */
  knob(dx: number, dy: number): void;
  hide(): void;
}

/** What a stick release was: not its finger, a tap, or the end of a push. */
export type StickRelease = 'miss' | 'tap' | 'push';

export interface StickGesture {
  /** A touch down; true when the stick takes it. */
  down(e: PointerEvent): boolean;
  /** True when the move belonged to the stick. */
  move(e: PointerEvent): boolean;
  up(e: PointerEvent): StickRelease;
  /** Lets go at once (a second finger came down, the window lost focus); true when it was pushing. */
  cancel(): boolean;
  /** True while the stick is pushed: x and y are the push (x right, y down, length 0..1). */
  readonly pushing: boolean;
  readonly x: number;
  readonly y: number;
}

export function createStickGesture(pad: StickPad, surface: HTMLElement, tapPx: number, tapMs: number): StickGesture {
  let id = -1;
  let ox = 0;
  let oy = 0;
  let t0 = 0;
  let pushing = false;
  let x = 0;
  let y = 0;

  function cancel(): boolean {
    const was = pushing;
    if (id !== -1 && surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
    id = -1;
    pushing = false;
    x = 0;
    y = 0;
    pad.hide();
    return was;
  }

  return {
    get pushing() {
      return pushing;
    },
    get x() {
      return x;
    },
    get y() {
      return y;
    },
    down(e) {
      if (id !== -1 || e.pointerType !== 'touch' || !pad.zone(e.clientX, e.clientY)) return false;
      id = e.pointerId;
      ox = e.clientX;
      oy = e.clientY;
      t0 = e.timeStamp;
      pushing = false;
      surface.setPointerCapture(id);
      pad.show(ox, oy);
      return true;
    },
    move(e) {
      if (e.pointerId !== id) return false;
      const dx = e.clientX - ox;
      const dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d >= tapPx) pushing = true;
      const k = d > pad.reachPx ? pad.reachPx / d : 1;
      x = (dx * k) / pad.reachPx;
      y = (dy * k) / pad.reachPx;
      pad.knob(dx * k, dy * k);
      return true;
    },
    up(e) {
      if (e.pointerId !== id) return 'miss';
      const tap = !pushing && e.type === 'pointerup' && e.timeStamp - t0 < tapMs;
      cancel();
      return tap ? 'tap' : 'push';
    },
    cancel,
  };
}
