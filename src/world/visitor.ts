/**
 * The visitor seen as the lantern they carry (cook/ROAM_PLAN.md 3, P5): an archival lantern cutout hanging from the hook
 * of a thin dark carrying crook planted at the visitor's ground point. The crook leans with the walk; the lantern swings
 * from its hook like a pendulum, bobs on twos while walking and casts a soft shadow straight below. Its flame is lamp 0
 * (world/lamps.ts). One actor batch drawn after every cutout with a depth test, so the rig passes behind what stands
 * nearer the lens. The crook is cut from a solid patch of the lantern plate, tinted near black: no new texture or
 * program. Nothing is allocated per frame.
 */
import type { Clock, InstanceWriter, QuadParams, SpriteRect } from '../types.ts';
import { ROAM, follow } from '../core/motion.ts';
import { QUAD_FLAG, packPhase } from './quadflags.ts';

export const LANTERN = {
  /**
   * The pierced tin lantern: its ring hangs naturally from a hook, and it is neither the candle lantern standing at the
   * Rosaleda stand point nor the cage at the gate, so the carried one is never mistaken for a prop.
   */
  sprite: 'sh/lantern-tin',
  /** The plate's size multiplier on landscape and on portrait screens (the phone frame is narrower). */
  scaleWide: 1.4,
  scaleTall: 0.95,
  /** The flame at this share of the lantern's height. */
  flameOfHeight: 0.4,
  /** The bob while walking: its height (m) and steps per second, drawn on twos of 12 fps. */
  bobM: 0.022,
  stepHz: 2.4,
  fps: 12,
} as const;

/**
 * The carrying crook (metres, at scale 1.4): shaft height, hook radius, line widths, its near-black tint, the lean per
 * m/s of walk and its clamp. Near the pond the hook turns to the bank side, so the lantern never hangs over the water.
 */
export const CROOK = {
  heightM: 1.1, hookM: 0.075, shaftW: 0.024, hookW: 0.02, hookSegments: 4, hookSweep: 1.15,
  tint: [0.07, 0.05, 0.035], leanPerMS: 0.05, maxLean: 0.16, leanTauS: 0.25, pondNear: 1.6, sideTauS: 0.3,
} as const;
/** The solid patch of the lantern plate the crook is cut from (shares of the sprite's uv rect). */
const PATCH = [0.47, 0.3, 0.53, 0.36] as const;

/** The pendulum: length to the centre of mass (m), gravity, damping (1/s), how much of the walk's push it feels, clamp. */
export const PENDULUM = { lengthM: 0.3, g: 9.81, damping: 2.4, gain: 0.12, maxRad: 0.35, velTauS: 0.05, maxStepS: 1 / 120 } as const;

/** Swing state from the hand's x motion (screen and world x agree: the roam camera's yaw is fixed). */
export interface Pendulum { angle: number; spin: number; hand: number; vel: number }

export function createPendulum(): Pendulum {
  return { angle: 0, spin: 0, hand: NaN, vel: 0 };
}

/**
 * One frame: the hand at `x` pushes the lantern by its acceleration and gravity pulls it back. `still` (reduced motion,
 * frozen time) keeps it hanging straight. The angle is positive when the lantern's foot swings toward +x.
 */
export function stepPendulum(p: Pendulum, x: number, dt: number, still: boolean): void {
  if (Number.isNaN(p.hand) || dt <= 0 || still) {
    p.hand = x;
    p.vel = 0;
    if (still) {
      p.angle = 0;
      p.spin = 0;
    }
    return;
  }
  const vel = follow(p.vel, (x - p.hand) / dt, PENDULUM.velTauS, dt);
  const accel = (vel - p.vel) / dt;
  p.hand = x;
  p.vel = vel;
  const steps = Math.ceil(dt / PENDULUM.maxStepS);
  const h = dt / steps;
  const k = PENDULUM.g / PENDULUM.lengthM;
  const push = (PENDULUM.gain * accel) / PENDULUM.lengthM;
  for (let i = 0; i < steps; i++) {
    p.spin += (-k * Math.sin(p.angle) - push * Math.cos(p.angle) - PENDULUM.damping * p.spin) * h;
    p.angle += p.spin * h;
    if (Math.abs(p.angle) > PENDULUM.maxRad) {
      p.angle = Math.sign(p.angle) * PENDULUM.maxRad;
      p.spin = 0;
    }
  }
}

export interface PondShape { x: number; z: number; rx: number; rz: number }

export interface VisitorLantern {
  /** Flame xyz in world space, read by the light rig as lamp 0. */
  readonly flame: Float32Array;
  readonly pendulum: Pendulum;
  /** The batch and lantern sprite to draw into, once the shared atlas is in (until then only the flame moves). */
  attach(writer: InstanceWriter, rect: SpriteRect): void;
  /** The viewport (CSS px): portrait screens get the smaller lantern. */
  resize(w: number, h: number): void;
  /** Stage 'camera', before the light: follows the visitor at `pos` [x, z]. */
  frame(c: Clock, reduced: boolean): void;
}

/** Instances in the actor batch: the shaft, the hook segments, then the lantern. */
export const VISITOR_QUADS = 1 + CROOK.hookSegments + 1;

export function createVisitorLantern(pos: Float32Array, pond: PondShape | null): VisitorLantern {
  const flame = new Float32Array(3);
  const pendulum = createPendulum();
  const lanternTint = new Float32Array([1, 1, 1, 1]);
  const crookTint = new Float32Array([CROOK.tint[0], CROOK.tint[1], CROOK.tint[2], 1]);
  const patch = new Float32Array(4);
  const lamp: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0, py: 0, uv: [0, 0, 1, 1], sway: 0, lift: 0, facing: 0, tint: lanternTint,
    phase: packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.turn | QUAD_FLAG.hung) };
  const stick: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0.5, py: 0, uv: patch, sway: 0, lift: 0, facing: 0, tint: crookTint, phase: 0 };
  const shaftPhase = packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.silhouette);
  const hookPhase = packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.silhouette | QUAD_FLAG.noShadow);
  let writer: InstanceWriter | null = null;
  let plateW = 0.16;
  let plateH = 0.4;
  let scale: number = LANTERN.scaleWide;
  let lastZ = NaN;
  let speed = 0;
  let lean = 0;
  let side = 1;

  /** Writes one crook segment from local (ax, ay) to (bx, by), leaned by `lean` about the foot (fx, fz). */
  function segment(i: number, ax: number, ay: number, bx: number, by: number, width: number, fx: number, fz: number): void {
    const cl = Math.cos(lean);
    const sl = Math.sin(lean);
    stick.x = fx + ax * cl + ay * sl;
    stick.y = -ax * sl + ay * cl;
    stick.z = fz;
    stick.w = width;
    stick.h = Math.hypot(bx - ax, by - ay) + width * 0.5;
    stick.rot = Math.atan2(-(bx - ax), by - ay) - lean;
    stick.phase = i === 0 ? shaftPhase : hookPhase;
    writer!.set(i, stick);
  }

  return {
    flame,
    pendulum,
    attach(w, rect) {
      writer = w;
      plateW = rect.size[0];
      plateH = rect.size[1];
      lamp.px = rect.pivot[0];
      lamp.py = rect.pivot[1];
      lamp.uv = rect.uv;
      const [u0, v0, u1, v1] = rect.uv;
      patch[0] = u0 + (u1 - u0) * PATCH[0];
      patch[1] = v0 + (v1 - v0) * PATCH[1];
      patch[2] = u0 + (u1 - u0) * PATCH[2];
      patch[3] = v0 + (v1 - v0) * PATCH[3];
      w.count = VISITOR_QUADS;
    },
    resize(w, h) {
      scale = w >= h ? LANTERN.scaleWide : LANTERN.scaleTall;
    },
    frame(c, reduced) {
      const x = pos[0]!;
      const z = pos[1]!;
      const still = reduced || c.frozen;
      const vx = pendulum.vel;
      const k = scale / LANTERN.scaleWide;
      /** The hook hangs toward +x, or toward the bank when the visitor skirts the pond. */
      let wantSide = 1;
      if (pond !== null && Math.hypot((x - pond.x) / pond.rx, (z - pond.z) / pond.rz) < CROOK.pondNear) wantSide = x < pond.x ? -1 : 1;
      side = still ? wantSide : follow(side, wantSide, CROOK.sideTauS, c.dt);
      lean = still ? 0 : follow(lean, Math.max(-CROOK.maxLean, Math.min(CROOK.maxLean, vx * CROOK.leanPerMS)), CROOK.leanTauS, c.dt);
      const r = CROOK.hookM * k;
      const top = CROOK.heightM * k;
      /** The hook tip in the crook's own frame, leaned about the foot. */
      const tipX = 2 * side * r;
      const hx = x + tipX * Math.cos(lean) + top * Math.sin(lean);
      const twos = Math.floor(c.t * LANTERN.fps) / LANTERN.fps;
      const vz = Number.isNaN(lastZ) || c.dt <= 0 ? 0 : (z - lastZ) / c.dt;
      lastZ = z;
      speed = still ? 0 : follow(speed, Math.min(1, Math.hypot(vx, vz) / ROAM.speed), PENDULUM.velTauS, c.dt);
      const bob = LANTERN.bobM * speed * Math.abs(Math.sin(Math.PI * LANTERN.stepHz * twos));
      const hy = -tipX * Math.sin(lean) + top * Math.cos(lean) + bob;
      stepPendulum(pendulum, hx, c.dt, still);
      const height = plateH * scale;
      const s = Math.sin(pendulum.angle);
      const co = Math.cos(pendulum.angle);
      const below = 1 - LANTERN.flameOfHeight;
      flame[0] = hx + s * height * below;
      flame[1] = hy - co * height * below;
      flame[2] = z;
      if (writer === null) return;
      segment(0, 0, 0, 0, top, CROOK.shaftW * k, x, z);
      for (let i = 0; i < CROOK.hookSegments; i++) {
        const t0 = (i / CROOK.hookSegments) * CROOK.hookSweep;
        const t1 = ((i + 1) / CROOK.hookSegments) * CROOK.hookSweep;
        segment(1 + i, side * r * (1 - Math.cos(Math.PI * t0)), top + r * Math.sin(Math.PI * t0),
          side * r * (1 - Math.cos(Math.PI * t1)), top + r * Math.sin(Math.PI * t1), CROOK.hookW * k, x, z);
      }
      /** The lantern quad turns about its foot: place the foot so its ring stays on the hook. */
      lamp.w = plateW * scale;
      lamp.h = height;
      lamp.x = hx + s * height;
      lamp.y = hy - co * height;
      lamp.z = z;
      lamp.rot = pendulum.angle;
      writer.set(VISITOR_QUADS - 1, lamp);
      writer.commit(0, VISITOR_QUADS);
    },
  };
}
