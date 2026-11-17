/**
 * LightRig (ARCH 2.5, spec §3.2 and §7): the cursor light follows the pointer on its own follower; on touch it stays at
 * the last touch and drifts on a slow figure of eight when idle. The gather light rises on the focused flower.
 * Output is world space, read by the cutout material (uCursor, uGather, uFocusBack, uMoonDir).
 */
import type { CameraRig, Clock, LightRig, Machine, SlotId, SlotView, State } from '../types.ts';
import { LIGHT, follow } from '../core/motion.ts';
import { slotWorld } from './camera.ts';

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
} as const;

/** Idle touch drift: starts after this long without a touch and fades in on this follower. */
const TOUCH = { idleAfterS: 2, driftInTauS: 1 } as const;

export interface GardenLight extends LightRig {
  /** The viewport in CSS px (the light is placed in screen space, then unprojected). */
  resize(w: number, h: number): void;
  /** The active bed's slots, for the gather light. */
  setSlots(slots: readonly SlotView[]): void;
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

  function stepScreen(c: Clock, dt: number): void {
    if (!hasPointer) {
      tx = width * GEOM.restX;
      ty = height * GEOM.restY;
    }
    const speed = Number.isNaN(prevTx) || dt <= 0 ? 0 : Math.hypot(tx - prevTx, ty - prevTy) / dt;
    prevTx = tx;
    prevTy = ty;
    const fast = speed > LIGHT.swellSpeedPxS;
    swell = follow(swell, fast ? 1 : 0, fast ? LIGHT.cursorTauS : LIGHT.swellRelaxS, dt);

    idleS = moved ? 0 : idleS + dt;
    moved = false;
    drift = follow(drift, touch && idleS >= TOUCH.idleAfterS ? 1 : 0, TOUCH.driftInTauS, dt);
    const phase = (2 * Math.PI * c.t) / LIGHT.idleDriftPeriodS;
    const amp = drift * LIGHT.idleDriftAmp * height;
    const gx = tx + amp * Math.sin(phase);
    const gy = ty + amp * 0.5 * Math.sin(2 * phase);

    if (Number.isNaN(fx)) {
      fx = gx;
      fy = gy;
    } else {
      fx = follow(fx, gx, LIGHT.cursorTauS, dt);
      fy = follow(fy, gy, LIGHT.cursorTauS, dt);
    }
  }

  function stepGather(s: State, ch: Machine['ch'], dt: number): void {
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
    gatherAmount = f.target >= 0.5 ? Math.max(gatherAmount, f.value) : follow(gatherAmount, 0, LIGHT.gatherOutTauS, dt);
    gather[3] = gatherAmount;
    restBack = follow(restBack, slots.length > 0 ? GEOM.bedRestBack : 0, LIGHT.gatherOutTauS, dt);
    /** A bed's rest light is part of its composed shot; on the overview the ground is lit only once a hand is there. */
    handThrow = follow(handThrow, hasPointer || slots.length > 0 ? 1 : 0, LIGHT.gatherOutTauS, dt);
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
      touch = kind === 'touch';
      tx = xPx;
      ty = yPx;
      moved = true;
    },
    update(c: Clock, s: State, ch: Machine['ch'], rig: CameraRig) {
      const dt = c.dt;
      stepScreen(c, dt);
      /** In a bed the light moves on the plane of its flowers; the overview keeps the garden's middle plane. */
      const planeZ = slots.length > 0 ? slots[0]!.world[2] : GEOM.planeZ;
      rig.unproject(fx, fy, planeZ, hit);
      const viewH = Math.abs(rig.pose.z - planeZ) * 2 * Math.tan((rig.pose.fov * Math.PI) / 360);
      const r = Math.max(GEOM.minRadius, viewH * GEOM.radiusOfView) * (1 + LIGHT.swell * swell);
      cursor[0] = hit[0]!;
      cursor[1] = hit[1]!;
      cursor[2] = planeZ + r * GEOM.liftOfRadius;
      cursor[3] = r;
      stepGather(s, ch, dt);
    },
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
    },
    setSlots(v) {
      slots = v;
    },
  };
}
