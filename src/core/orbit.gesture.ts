import { ORBIT } from './motion.ts';

/**
 * Free roam orbit gestures (cook/PLAN_3D.md F1): a right-button drag, or a left-button drag begun off the walkable
 * ground (the walls, the sky), turns the camera about the visitor; two fingers turn it with their midpoint and zoom
 * with their spread while one finger keeps walking; the wheel and a trackpad pinch zoom. Handlers only feed the orbit
 * (world/orbit.ts); they own no per-frame work.
 */

/** What the orbit takes from input: a turn in radians, a zoom factor, held turn keys and a grab while a drag lasts. */
export interface OrbitInput {
  turnBy(rad: number): void;
  zoomBy(k: number): void;
  /** -1 turns the view left, 1 right, 0 stops. */
  setKeys(dir: number): void;
  grab(on: boolean): void;
}

export const ORBIT_KEYS: Readonly<Record<string, number>> = { KeyQ: -1, KeyE: 1 };

/** What a pointer release was to the orbit: not its pointer, the end of a drag, or a tap (the caller walks there). */
export type OrbitRelease = 'miss' | 'drag' | 'tap';

export interface OrbitGesture {
  /** A pointer down; true when the orbit takes it (a second finger: the walk must let the first one go). */
  down(e: PointerEvent, walkable: boolean): boolean;
  /** True when the move belonged to the orbit. */
  move(e: PointerEvent): boolean;
  up(e: PointerEvent): OrbitRelease;
  /** Wheel or trackpad pinch (ctrl+wheel) zoom; rates are input.ts GESTURE's. */
  wheel(dy: number, rate: number): void;
}

const RAD_PER_PX = (ORBIT.dragDegPerPx * Math.PI) / 180;

export function createOrbitGesture(orbit: OrbitInput, surface: HTMLElement, tapPx: number): OrbitGesture {
  /** The touches down (two at most) and where each was last; the mouse drag uses slot 0. */
  const ids = new Int32Array(2).fill(-1);
  const xs = new Float64Array(2);
  const ys = new Float64Array(2);
  let mouse = false;
  let pair = false;
  let travelled = 0;
  let downX = 0;
  let downY = 0;

  const slotOf = (id: number): number => (ids[0] === id ? 0 : ids[1] === id ? 1 : -1);
  const spread = (): number => Math.hypot(xs[0]! - xs[1]!, ys[0]! - ys[1]!);

  function take(i: number, e: PointerEvent): void {
    ids[i] = e.pointerId;
    xs[i] = e.clientX;
    ys[i] = e.clientY;
    surface.setPointerCapture(e.pointerId);
  }

  return {
    down(e, walkable) {
      if (e.pointerType === 'mouse') {
        if (ids[0] !== -1 || (e.button === 0 && walkable) || (e.button !== 0 && e.button !== 2)) return false;
        mouse = true;
        travelled = 0;
        downX = e.clientX;
        downY = e.clientY;
        take(0, e);
        orbit.grab(true);
        return true;
      }
      const i = ids[0] === -1 ? 0 : ids[1] === -1 ? 1 : -1;
      if (i < 0) return true;
      ids[i] = e.pointerId;
      xs[i] = e.clientX;
      ys[i] = e.clientY;
      if (i === 0) return false;
      pair = true;
      surface.setPointerCapture(e.pointerId);
      orbit.grab(true);
      return true;
    },
    move(e) {
      const i = slotOf(e.pointerId);
      if (i < 0) return false;
      const dx = e.clientX - xs[i]!;
      if (mouse) {
        travelled = Math.max(travelled, Math.hypot(e.clientX - downX, e.clientY - downY));
        orbit.turnBy(-dx * RAD_PER_PX);
        xs[0] = e.clientX;
        return true;
      }
      if (!pair) {
        xs[i] = e.clientX;
        ys[i] = e.clientY;
        return false;
      }
      if (ids[0] === -1 || ids[1] === -1) return true;
      const before = spread();
      xs[i] = e.clientX;
      ys[i] = e.clientY;
      const after = spread();
      orbit.turnBy((-dx / 2) * RAD_PER_PX);
      if (before > 0 && after > 0) orbit.zoomBy(after / before);
      return true;
    },
    up(e) {
      const i = slotOf(e.pointerId);
      if (i < 0) return 'miss';
      ids[i] = -1;
      if (!mouse && !pair) return 'miss';
      if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
      if (mouse) {
        mouse = false;
        orbit.grab(false);
        return e.type === 'pointerup' && e.button === 0 && travelled < tapPx ? 'tap' : 'drag';
      }
      orbit.grab(false);
      if (ids[0] === -1 && ids[1] === -1) pair = false;
      return 'drag';
    },
    wheel(dy, rate) {
      orbit.zoomBy(Math.exp(-dy * rate));
    },
  };
}
