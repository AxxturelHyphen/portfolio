import type { CameraRig, LightRig, Loop, Machine } from '../types.ts';
import { createOrbitGesture, ORBIT_KEYS, type OrbitInput } from './orbit.gesture.ts';
import { createStickGesture, type StickPad } from './stick.gesture.ts';

/**
 * Unified input (spec section 7, cook/ARCH.md 2.1 and 2.5): pointer drag with inertia, wheel and pinch zoom, tap,
 * swipe between beds, keys. Input only sends machine events and calls the rig; it never moves anything itself.
 * Handlers accumulate into module-owned numbers; the 'input' frame stage applies them once per frame.
 * Proxies (ui) own clicks, hover and Enter on flowers and beds; the canvas gets what they do not.
 * Free roam (the optional `roam` dep, the default): arrows and WASD hold walk directions instead of stepping beds, a
 * pointer down on the canvas walks there and a drag steers toward the pointer; no pan, fling or swipe. Q and E, a
 * right-button drag, a drag begun off the walkable ground and two fingers orbit the camera, the wheel and a pinch zoom
 * it (core/orbit.gesture.ts). Enter or Space on the page or the canvas opens the focused flower (focused by walking up
 * to it, cook/ROAM_PLAN.md section 3); Shift held walks briskly. On touch, the optional `stick` dep makes a finger put
 * down in its corner a floating stick (core/stick.gesture.ts); a tap there still walks, a second finger still orbits.
 */

export const GESTURE = {
  /** Movement under this (px) is a tap. */
  tapPx: 8,
  tapMs: 300,
  /** Inside a bed: a horizontal drag over this distance, or a flick over this speed, steps to the next bed. */
  swipePx: 60,
  swipePxPerMs: 0.5,
  /** Pointer samples kept for the release velocity (ms window). */
  velocityWindowMs: 80,
  /** Wheel to zoom: k = exp(-deltaY * rate); trackpad pinch (ctrl+wheel) is finer grained. */
  wheelRate: 0.0015,
  pinchWheelRate: 0.01,
  lineHeightPx: 16,
} as const;

/** The visitor's controls in free roam. Bits: 1 left, 2 right, 4 up (away from the camera), 8 down. */
export interface RoamControl {
  setHeld(bits: number): void;
  /** Walk toward the ground under this point (CSS px). */
  pointAt(xPx: number, yPx: number): void;
  /** Opens the focused flower as activating its proxy would. */
  activate(): void;
  readonly orbit: OrbitInput;
  /** True when the point (CSS px) is open ground a press walks to, not a wall or the sky. */
  walkable(xPx: number, yPx: number): boolean;
  /** Stops the walk toward a pointer (a second finger came down to orbit). */
  halt(): void;
  /** The touch stick: x right, y down on screen, length 0..1; (0, 0) lets go. */
  stick(x: number, y: number): void;
  /** Shift held: a brisk walk. */
  setBrisk(on: boolean): void;
}

/** Walk keys in free roam: arrows by key, WASD by physical position. */
const WALK_KEYS: Readonly<Record<string, number>> = {
  ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2, ArrowUp: 4, KeyW: 4, ArrowDown: 8, KeyS: 8,
};

/** Focus whose keys belong to the control: fields and open dialogs (the panel with its film strip, the credits). */
export const OWN_KEYS = 'input, textarea, select, [contenteditable], dialog';
/** Also keeps the walk keys: the plan's sheet (ui/plan.ts), inert while closed, so focus inside it means it is open. */
export const OWN_WALK_KEYS = `${OWN_KEYS}, .pl-sheet`;

export interface InputDeps { machine: Machine; rig: CameraRig; light: LightRig; loop: Loop; surface: HTMLElement; roam?: RoamControl; stick?: StickPad }
export interface Input { /** Stage 'input': applies this frame's pan and zoom to the rig. */ frame(): void; dispose(): void }

const SAMPLES = 8;

export function createInput(d: InputDeps): Input {
  const { machine, rig, light, loop, surface } = d;
  const roam = d.roam ?? null;
  const ids = new Int32Array(2).fill(-1);
  const px = new Float64Array(2);
  const py = new Float64Array(2);
  const sampleT = new Float64Array(SAMPLES);
  const sampleX = new Float64Array(SAMPLES);
  let sampleN = 0;
  let downX = 0;
  let downY = 0;
  let downT = 0;
  let travelled = 0;
  let pinchDist = 0;
  let panPx = 0;
  let zoomLog = 0;
  let zoomAt = 0;
  let held = 0;
  let steerId = -1;
  let steerX = 0;
  let steerY = 0;
  let turn = 0;
  const gesture = roam === null ? null : createOrbitGesture(roam.orbit, surface, GESTURE.tapPx);
  const stick = roam === null || d.stick === undefined ? null : createStickGesture(d.stick, surface, GESTURE.tapPx, GESTURE.tapMs);

  const garden = (): boolean => machine.state.mode === 'garden';
  const phase = (): string => machine.state.phase;
  const inOverview = (): boolean => phase() === 'overview';
  const panelUp = (): boolean => {
    const p = phase();
    return p === 'opening' || p === 'inspect' || p === 'closing';
  };

  /** Any input during the intro skips it (MOTION D: 300 ms cross-fade, no snap). */
  function anyInput(): void {
    loop.wake();
    if (phase() === 'intro') machine.send({ type: 'SKIP_INTRO' });
  }

  function slot(id: number): number {
    return ids[0] === id ? 0 : ids[1] === id ? 1 : -1;
  }

  function pushSample(t: number, x: number): void {
    const i = sampleN % SAMPLES;
    sampleT[i] = t;
    sampleX[i] = x;
    sampleN++;
  }

  /** px per second over the last velocityWindowMs of samples. */
  function releaseVelocity(now: number): number {
    const n = Math.min(sampleN, SAMPLES);
    let oldest = -1;
    for (let k = 1; k <= n; k++) {
      const i = (sampleN - k) % SAMPLES;
      if (now - (sampleT[i] ?? 0) > GESTURE.velocityWindowMs) break;
      oldest = i;
    }
    if (oldest < 0) return 0;
    const newest = (sampleN - 1) % SAMPLES;
    const dt = (sampleT[newest] ?? 0) - (sampleT[oldest] ?? 0);
    return dt > 0 ? (((sampleX[newest] ?? 0) - (sampleX[oldest] ?? 0)) / dt) * 1000 : 0;
  }

  const pinching = (): boolean => ids[0] !== -1 && ids[1] !== -1;
  const spread = (): number => Math.hypot((px[0] ?? 0) - (px[1] ?? 0), (py[0] ?? 0) - (py[1] ?? 0));

  function onDown(e: PointerEvent): void {
    if (!garden() || (e.pointerType === 'mouse' && e.button !== 0 && roam === null)) return;
    anyInput();
    if (roam !== null) {
      roamDown(e);
      return;
    }
    const i = ids[0] === -1 ? 0 : ids[1] === -1 ? 1 : -1;
    if (i < 0) return;
    ids[i] = e.pointerId;
    px[i] = e.clientX;
    py[i] = e.clientY;
    surface.setPointerCapture(e.pointerId);
    if (e.pointerType !== 'mouse') light.setPointer(e.clientX, e.clientY, 'touch');
    if (pinching()) {
      pinchDist = spread();
      return;
    }
    downX = e.clientX;
    downY = e.clientY;
    downT = e.timeStamp;
    travelled = 0;
    sampleN = 0;
    pushSample(e.timeStamp, e.clientX);
  }

  /** Free roam: one pointer at a time walks toward the ground under it while held. */
  function roamDown(e: PointerEvent): void {
    if (panelUp() || roam === null || gesture === null) return;
    if (gesture.down(e, e.pointerType !== 'mouse' || roam.walkable(e.clientX, e.clientY))) {
      if (steerId !== -1 && e.pointerType !== 'mouse') {
        steerId = -1;
        roam.halt();
      }
      if (stick?.cancel() === true) roam.stick(0, 0);
      return;
    }
    if (steerId !== -1 || stick?.down(e) === true) return;
    steerId = e.pointerId;
    steerX = downX = e.clientX;
    steerY = downY = e.clientY;
    downT = e.timeStamp;
    travelled = 0;
    surface.setPointerCapture(e.pointerId);
    roam?.pointAt(steerX, steerY);
  }

  function roamUp(e: PointerEvent): void {
    const orbited = gesture?.up(e) ?? 'miss';
    const stuck = stick?.up(e) ?? 'miss';
    if (stuck === 'push') roam?.stick(0, 0);
    if (orbited === 'tap' || stuck === 'tap') roam?.pointAt(e.clientX, e.clientY);
    if (stuck === 'tap' && phase() === 'focus') machine.send({ type: 'BLUR' });
    if (stuck !== 'miss') return;
    if (orbited !== 'miss' || e.pointerId !== steerId) return;
    steerId = -1;
    if (e.type === 'pointerup') roam?.pointAt(e.clientX, e.clientY);
    if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
    if (e.type !== 'pointercancel' && travelled < GESTURE.tapPx && e.timeStamp - downT < GESTURE.tapMs && phase() === 'focus') machine.send({ type: 'BLUR' });
  }

  function onMove(e: PointerEvent): void {
    if (!garden()) return;
    if (roam !== null) {
      if (gesture?.move(e) === true || stick?.move(e) === true) loop.wake();
      if (e.pointerId !== steerId) return;
      loop.wake();
      steerX = e.clientX;
      steerY = e.clientY;
      travelled = Math.max(travelled, Math.hypot(e.clientX - downX, e.clientY - downY));
      return;
    }
    if (e.pointerType === 'mouse') light.setPointer(e.clientX, e.clientY, 'mouse');
    const i = slot(e.pointerId);
    if (i < 0) return;
    loop.wake();
    if (e.pointerType !== 'mouse') light.setPointer(e.clientX, e.clientY, 'touch');
    const dx = e.clientX - (px[i] ?? 0);
    px[i] = e.clientX;
    py[i] = e.clientY;
    if (pinching()) {
      const dist = spread();
      if (pinchDist > 0 && dist > 0 && inOverview()) {
        zoomLog += Math.log(dist / pinchDist);
        zoomAt = ((px[0] ?? 0) + (px[1] ?? 0)) / 2;
        panPx += dx / 2;
      }
      pinchDist = dist;
      return;
    }
    travelled = Math.max(travelled, Math.hypot(e.clientX - downX, e.clientY - downY));
    pushSample(e.timeStamp, e.clientX);
    if (inOverview()) panPx += dx;
  }

  function onUp(e: PointerEvent): void {
    if (roam !== null) {
      roamUp(e);
      return;
    }
    const i = slot(e.pointerId);
    if (i < 0) return;
    const wasPinch = pinching();
    ids[i] = -1;
    if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
    if (wasPinch) {
      pinchDist = 0;
      sampleN = 0;
      return;
    }
    if (e.type === 'pointercancel' || !garden()) return;
    const dx = e.clientX - downX;
    const vx = releaseVelocity(e.timeStamp);
    if (travelled < GESTURE.tapPx && e.timeStamp - downT < GESTURE.tapMs) {
      if (phase() === 'focus') machine.send({ type: 'BLUR' });
      return;
    }
    if (inOverview()) {
      rig.fling(vx);
      return;
    }
    const p = phase();
    if (p !== 'bed' && p !== 'focus' && p !== 'travel') return;
    if (Math.abs(dx) > Math.abs(e.clientY - downY) && (Math.abs(dx) > GESTURE.swipePx || Math.abs(vx) > GESTURE.swipePxPerMs * 1000)) {
      machine.send({ type: 'STEP_BED', dir: dx < 0 ? 1 : -1 });
    }
  }

  function onWheel(e: WheelEvent): void {
    if (!garden()) return;
    e.preventDefault();
    anyInput();
    const unit = e.deltaMode === 1 ? GESTURE.lineHeightPx : e.deltaMode === 2 ? innerHeight : 1;
    const dy = e.deltaY * unit;
    if (gesture !== null) gesture.wheel(dy, e.ctrlKey ? GESTURE.pinchWheelRate : GESTURE.wheelRate);
    if (roam !== null || !inOverview()) return;
    const dx = e.deltaX * unit;
    if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy)) {
      panPx -= dx;
      return;
    }
    zoomLog -= dy * (e.ctrlKey ? GESTURE.pinchWheelRate : GESTURE.wheelRate);
    zoomAt = e.clientX;
  }

  function onKey(e: KeyboardEvent): void {
    if (!garden() || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof Element && t.closest(OWN_KEYS)) return;
    anyInput();
    const p = phase();
    if (roam !== null && e.key === 'Shift') roam.setBrisk(true);
    if (roam !== null && roamKey(e, t)) return;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        if (panelUp() || p === 'intro') return;
        e.preventDefault();
        machine.send({ type: 'STEP_BED', dir: e.key === 'ArrowLeft' ? -1 : 1 });
        return;
      case 'Escape':
        machine.send({ type: 'BACK' });
        return;
      case 'Enter':
      case ' ':
        if (t !== document.body && t !== surface) return;
        if (p === 'overview' && e.key === 'Enter') {
          e.preventDefault();
          machine.send({ type: 'STEP_BED', dir: 1 });
        } else if (roam !== null && p === 'focus') {
          e.preventDefault();
          roam.activate();
        }
        return;
      default:
    }
  }

  /**
   * Free roam: a walk key held anywhere but in a field, an open dialog (the panel with its film strip, the credits) or
   * the open plan sheet, so a clicked tag or toggle never leaves the keys dead. Space and Enter stay the buttons'.
   */
  function roamKey(e: KeyboardEvent, t: EventTarget | null): boolean {
    const bit = WALK_KEYS[e.code] ?? WALK_KEYS[e.key];
    const dir = ORBIT_KEYS[e.code];
    if (bit === undefined && dir === undefined) return false;
    const owned = t instanceof Element && t.closest(OWN_WALK_KEYS) !== null;
    if (owned || panelUp() || phase() === 'intro') return true;
    e.preventDefault();
    if (bit !== undefined) setHeld(held | bit);
    else if (dir !== undefined) setTurn(dir);
    return true;
  }

  function setTurn(dir: number): void {
    if (dir === turn) return;
    turn = dir;
    roam?.orbit.setKeys(dir);
    loop.wake();
  }

  function setHeld(bits: number): void {
    if (bits === held) return;
    held = bits;
    roam?.setHeld(bits);
    loop.wake();
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Shift') roam?.setBrisk(false);
    const bit = WALK_KEYS[e.code] ?? WALK_KEYS[e.key];
    if (bit !== undefined) setHeld(held & ~bit);
    if (ORBIT_KEYS[e.code] === turn) setTurn(0);
  }

  const ac = new AbortController();
  const passive = { passive: true, signal: ac.signal };
  surface.addEventListener('pointerdown', onDown, passive);
  surface.addEventListener('pointerup', onUp, passive);
  surface.addEventListener('pointercancel', onUp, passive);
  surface.addEventListener('lostpointercapture', onUp, passive);
  surface.addEventListener('wheel', onWheel, { passive: false, signal: ac.signal });
  window.addEventListener('pointermove', onMove, passive);
  window.addEventListener('keydown', onKey, { signal: ac.signal });
  if (roam !== null) {
    window.addEventListener('keyup', onKeyUp, { signal: ac.signal });
    window.addEventListener('blur', () => {
      setHeld(0);
      setTurn(0);
      roam.setBrisk(false);
      if (stick?.cancel() === true) roam.stick(0, 0);
    }, { signal: ac.signal });
    surface.addEventListener('contextmenu', (e) => e.preventDefault(), { signal: ac.signal });
  }

  return {
    frame(): void {
      if (steerId !== -1) roam?.pointAt(steerX, steerY);
      if (stick?.pushing === true) roam?.stick(stick.x, stick.y);
      if (panPx !== 0) {
        rig.panBy(panPx);
        panPx = 0;
      }
      if (zoomLog !== 0) {
        rig.zoomBy(Math.exp(zoomLog), zoomAt);
        zoomLog = 0;
      }
    },
    dispose(): void {
      ac.abort();
    },
  };
}
