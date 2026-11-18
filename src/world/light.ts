/**
 * LightRig (ARCH 2.5, spec §3.2 and §7): the cursor light follows the pointer on its own follower; on touch it stays at
 * the last touch and drifts on a slow figure of eight when idle. Carried (free roam) it sits at the visitor and the
 * pointer no longer moves it, and the lamps (world/lamps.ts) burn: the carried lantern's flame and the active bed's
 * standing lanterns on screen. The gather light rises on the focused flower. Output is world space, read by the cutout
 * material (uCursor, uGather, uFocusBack, uMoonDir).
 */
import type { CameraRig, Clock, LightRig, Machine, ScreenPt, SlotId, SlotView, State } from '../types.ts';
import { LIGHT, follow } from '../core/motion.ts';
import { slotWorld } from './camera.ts';
import { findLamps, LAMPS, stepLamps } from './lamps.ts';
import type { BedScene3 } from './layout.ts';

/** Light geometry (world units and fractions of the view, no timings). */
const GEOM = {
  radiusOfView: 0.22,
  /** The light floats in front of the plane by this share of its radius, so it always reaches the paper. */
  liftOfRadius: 0.45,
  /** Smallest radius in metres: close shots still get a hand-sized pool. */
  minRadius: 1.1,
  planeZ: 0,
  restX: 0.5,
  restY: 0.42,
  moon: [-0.35, 0.8, 0.5],
  /** In a bed at rest the far layers fall back behind the flowers by this share of a focus (an 85 mm close shot). */
  bedRestBack: 0.6,
  /** Carried at the visitor (free roam): hand height and pool radius, metres. */
  carriedY: 0.9,
  carriedRadius: 1.6,
} as const;

/** Idle touch drift: starts after this long without a touch and fades in on this follower. */
const TOUCH = { idleAfterS: 2, driftInTauS: 1 } as const;

export interface GardenLight extends LightRig {
  /** The viewport in CSS px (the light is placed in screen space, then unprojected). */
  resize(w: number, h: number): void;
  /** The active bed's slots, for the gather light. */
  setSlots(slots: readonly SlotView[]): void;
  /** Free roam: the light sits at this [x, z] (read every frame); null gives it back to the pointer. */
  carry(at: Float32Array | null): void;
  /** Free roam: lamp 0 burns at this flame xyz (the carried lantern, read every frame). */
  carryFlame(flame: Float32Array): void;
  /** The active bed's standing lanterns become lamps 1 and 2 (free roam). Runs on a bed change, never per frame. */
  setLamps(scene: BedScene3 | null): void;
  /** The lamp list, LAMPS.count vec4s (flame xyz, strength); all dark until a flame is carried. */
  readonly lamps: Float32Array;
}

export function createLight(): GardenLight {
  const cursor = new Float32Array(4);
  const gather = new Float32Array(4);
  const back = new Float32Array(4);
  const moonDir = new Float32Array(3);
  const ml = Math.hypot(GEOM.moon[0], GEOM.moon[1], GEOM.moon[2]);
  moonDir[0] = GEOM.moon[0] / ml;
  moonDir[1] = GEOM.moon[1] / ml;
  moonDir[2] = GEOM.moon[2] / ml;

  const hit = new Float32Array(3);
  let width = 1280;
  let height = 720;
  let hasPointer = false;
  /** False until a pointer reports anywhere but (0,0): headless Chromium fires one stray move there on load. */
  let leftOrigin = false;
  let touch = false;
  let tx = 0;
  let ty = 0;
  let prevTx = NaN;
  let prevTy = NaN;
  let fx = NaN;
  let fy = NaN;
  let swell = 0;
  let drift = 0;
  let idleS = 0;
  let moved = false;
  let gatherAmount = 0;
  let restBack = 0;
  let handThrow = 0;
  let gatherSlot: SlotId | null = null;
  let slots: readonly SlotView[] = [];
  let carried: Float32Array | null = null;
  let flame: Float32Array | null = null;
  const lamps = new Float32Array(LAMPS.count * 4);
  const standing = new Float32Array(LAMPS.standing * 4);
  let standingN = 0;
  const seen: ScreenPt = { x: 0, y: 0, scale: 0, visible: false };
  let lampRig: CameraRig | null = null;
  const onScreen = (x: number, y: number, z: number): boolean => lampRig !== null && lampRig.project(x, y, z, seen).visible;

  /** A follower step; under frozen time (`?t`, the test API) it lands on its target so stills never depend on load. */
  const ease = (v: number, to: number, tauS: number, dt: number, snap: boolean): number => (snap ? to : follow(v, to, tauS, dt));

  function stepScreen(c: Clock, dt: number, pointer: boolean): void {
    if (!pointer) {
      tx = width * GEOM.restX;
      ty = height * GEOM.restY;
    }
    const speed = Number.isNaN(prevTx) || dt <= 0 ? 0 : Math.hypot(tx - prevTx, ty - prevTy) / dt;
    prevTx = tx;
    prevTy = ty;
    const fast = speed > LIGHT.swellSpeedPxS;
    swell = ease(swell, fast ? 1 : 0, fast ? LIGHT.cursorTauS : LIGHT.swellRelaxS, dt, c.frozen);

    idleS = moved ? 0 : idleS + dt;
    moved = false;
    drift = ease(drift, touch && idleS >= TOUCH.idleAfterS ? 1 : 0, TOUCH.driftInTauS, dt, c.frozen);
    const phase = (2 * Math.PI * c.t) / LIGHT.idleDriftPeriodS;
    const amp = drift * LIGHT.idleDriftAmp * height;
    const gx = tx + amp * Math.sin(phase);
    const gy = ty + amp * 0.5 * Math.sin(2 * phase);

    if (Number.isNaN(fx) || c.frozen) {
      fx = gx;
      fy = gy;
    } else {
      fx = follow(fx, gx, LIGHT.cursorTauS, dt);
      fy = follow(fy, gy, LIGHT.cursorTauS, dt);
    }
  }

  function stepGather(s: State, ch: Machine['ch'], dt: number, snap: boolean, pointer: boolean): void {
    if (slotWorld(slots, s.slot, hit)) {
      gather[0] = hit[0]!;
      gather[1] = hit[1]!;
      gather[2] = hit[2]! + cursor[3]! * 0.8 * GEOM.liftOfRadius;
    }
    const f = ch.focus;
    if (s.slot !== gatherSlot) {
      gatherSlot = s.slot;
      gatherAmount = Math.min(gatherAmount, f.value);
    }
    gatherAmount = f.target >= 0.5 ? Math.max(gatherAmount, f.value) : ease(gatherAmount, 0, LIGHT.gatherOutTauS, dt, snap);
    gather[3] = gatherAmount;
    restBack = ease(restBack, slots.length > 0 ? GEOM.bedRestBack : 0, LIGHT.gatherOutTauS, dt, snap);
    /** A bed's rest light is part of its composed shot; on the overview the ground is lit only once a hand is there. */
    handThrow = ease(handThrow, pointer || slots.length > 0 ? 1 : 0, LIGHT.gatherOutTauS, dt, snap);
    const toGather = Math.min(1, gatherAmount * 4);
    back[0] = cursor[0]! + (gather[0]! - cursor[0]!) * toGather;
    back[1] = cursor[1]! + (gather[1]! - cursor[1]!) * toGather;
    back[2] = cursor[2]! - cursor[3]! * GEOM.liftOfRadius + (gather[2]! - cursor[2]! + cursor[3]! * GEOM.liftOfRadius) * toGather;
    back[3] = Math.max(gatherAmount, restBack);
  }

  return {
    cursor,
    gather,
    back,
    moonDir,
    get handThrow() {
      return handThrow;
    },
    setPointer(xPx, yPx, kind) {
      hasPointer = true;
      if (xPx !== 0 || yPx !== 0) leftOrigin = true;
      touch = kind === 'touch';
      tx = xPx;
      ty = yPx;
      moved = true;
    },
    update(c: Clock, s: State, ch: Machine['ch'], rig: CameraRig) {
      const dt = c.dt;
      if (carried !== null) {
        cursor[0] = carried[0]!;
        cursor[1] = GEOM.carriedY;
        cursor[2] = carried[1]! + GEOM.carriedRadius * GEOM.liftOfRadius;
        cursor[3] = GEOM.carriedRadius;
        stepGather(s, ch, dt, c.frozen, true);
        if (flame !== null) {
          lampRig = rig;
          stepLamps(lamps, flame[0]!, flame[1]!, flame[2]!, standing, standingN, onScreen, dt, c.frozen);
        }
        return;
      }
      /** Under frozen time (`?t`, the test API) a pointer still at (0,0) is the stray load event, not a hand: stills keep the rest light. */
      const pointer = hasPointer && (leftOrigin || !c.frozen);
      stepScreen(c, dt, pointer);
      /** In a bed the light moves on the plane of its flowers; the overview keeps the garden's middle plane. */
      const planeZ = slots.length > 0 ? slots[0]!.world[2] : GEOM.planeZ;
      rig.unproject(fx, fy, planeZ, hit);
      const viewH = Math.abs(rig.pose.z - planeZ) * 2 * Math.tan((rig.pose.fov * Math.PI) / 360);
      const r = Math.max(GEOM.minRadius, viewH * GEOM.radiusOfView) * (1 + LIGHT.swell * swell);
      cursor[0] = hit[0]!;
      cursor[1] = hit[1]!;
      cursor[2] = planeZ + r * GEOM.liftOfRadius;
      cursor[3] = r;
      stepGather(s, ch, dt, c.frozen, pointer);
    },
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
    },
    setSlots(v) {
      slots = v;
    },
    carry(at) {
      carried = at;
    },
    carryFlame(f) {
      flame = f;
    },
    setLamps(scene) {
      standingN = findLamps(scene, standing);
      for (let i = 1; i < LAMPS.count; i++) lamps[i * 4 + 3] = 0;
    },
    lamps,
  };
}
