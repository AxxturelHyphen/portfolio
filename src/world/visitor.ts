/**
 * The visitor (cook/ROAM_PLAN.md 3, P5; cook/FIGURE_BUILD.md 4). Until the roam atlas is in, the lantern they carry:
 * an archival lantern cutout hanging from the hook of a thin dark carrying crook planted at the visitor's ground point.
 * Once it is in, on a step, the paper figure of world/puppet.ts takes its place and carries the lantern by a short
 * handle in its fist. Either way the lantern swings like a pendulum, bobs on twos while walking and casts a soft shadow
 * straight below; its flame is lamp 0 (world/lamps.ts). One actor batch drawn after every cutout with a depth test,
 * so the visitor passes behind what stands nearer the lens. The crook and handle are a solid patch tinted near black:
 * no new program. Nothing is allocated per frame.
 */
import type { Clock, InstanceWriter, QuadParams, SpriteRect } from '../types.ts';
import { ROAM, follow } from '../core/motion.ts';
import { createGait, createPuppet, FIGURE, SLOT, stepGait, type FigureRects, type Puppet } from './puppet.ts';
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
/**
 * The lantern in the figure's hand: its handle from fist to ring (m at figure scale 1), its plate scale on landscape
 * and portrait screens, the ground velocity follower and the flame's ease from the planted crook to the hand when the
 * figure first appears.
 */
export const HELD = { handleM: 0.05, scaleWide: 1.05, scaleTall: 0.75, velTauS: 0.08, flameTauS: 0.3 } as const;
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
  /** True once the figure is drawn (it appears on the first step after attachFigure). */
  readonly figure: boolean;
  /** The batch and lantern sprite to draw into, once the shared atlas is in (until then only the flame moves). */
  attach(writer: InstanceWriter, rect: SpriteRect): void;
  /**
   * The roam atlas is in: on the next step the figure replaces the planted crook. `show` runs on that frame, before
   * the batch is written, to point the batch at the roam page. Ignored before attach().
   */
  attachFigure(rects: FigureRects, lantern: SpriteRect, handle: SpriteRect, show: () => void): void;
  /** The viewport (CSS px): portrait screens get the smaller lantern and figure. */
  resize(w: number, h: number): void;
  /** Stage 'camera', before the light: follows the visitor at `pos` [x, z]. */
  frame(c: Clock, reduced: boolean): void;
}

/** Instances in the actor batch with the figure (shadow, body, handle, lantern), and before it: shaft, hook, lantern. */
export const VISITOR_QUADS = SLOT.count;
export const CROOK_QUADS = 1 + CROOK.hookSegments + 1;

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
  const gait = createGait();
  const flameEase = new Float32Array(3);
  let writer: InstanceWriter | null = null;
  let puppet: Puppet | null = null;
  let show: (() => void) | null = null;
  let shown = false;
  let plateW = 0.16;
  let plateH = 0.4;
  let wide = true;
  let scale: number = LANTERN.scaleWide;
  let lastX = NaN;
  let lastZ = NaN;
  let groundVx = 0;
  let groundVz = 0;
  let gaitVz = 0;
  let lastTick = NaN;
  let speed = 0;
  let lean = 0;
  let side = 1;
  let figureSide = 1;

  /** Writes one crook segment from world (ax, ay) to (bx, by) in the plane z. */
  function piece(i: number, ax: number, ay: number, bx: number, by: number, width: number, z: number, phase: number): void {
    stick.x = ax;
    stick.y = ay;
    stick.z = z;
    stick.w = width;
    stick.h = Math.hypot(bx - ax, by - ay) + width * 0.5;
    stick.rot = Math.atan2(-(bx - ax), by - ay);
    stick.phase = phase;
    writer!.set(i, stick);
  }

  /** Writes one crook segment from local (ax, ay) to (bx, by), leaned by `lean` about the foot (fx, fz). */
  function segment(i: number, ax: number, ay: number, bx: number, by: number, width: number, fx: number, fz: number): void {
    const cl = Math.cos(lean);
    const sl = Math.sin(lean);
    piece(i, fx + ax * cl + ay * sl, -ax * sl + ay * cl, fx + bx * cl + by * sl, -bx * sl + by * cl, width, fz, i === 0 ? shaftPhase : hookPhase);
  }

  /** The lantern hung by its ring from the hook tip (hx, hy): the quad turns about its foot, so place the foot. */
  function hang(i: number, hx: number, hy: number, z: number): void {
    const height = plateH * scale;
    const s = Math.sin(pendulum.angle);
    const co = Math.cos(pendulum.angle);
    const below = 1 - LANTERN.flameOfHeight;
    flame[0] = hx + s * height * below;
    flame[1] = hy - co * height * below;
    flame[2] = z;
    if (writer === null) return;
    lamp.w = plateW * scale;
    lamp.h = height;
    lamp.x = hx + s * height;
    lamp.y = hy - co * height;
    lamp.z = z;
    lamp.rot = pendulum.angle;
    writer.set(i, lamp);
  }

  /** The lantern on its planted crook, as before the figure. */
  function crookFrame(c: Clock, still: boolean, x: number, z: number): void {
    const vx = pendulum.vel;
    const k = scale / LANTERN.scaleWide;
    /** The hook hangs toward +x, or toward the bank when the visitor skirts the pond. */
    side = still ? bankSide(x, z) : follow(side, bankSide(x, z), CROOK.sideTauS, c.dt);
    lean = still ? 0 : follow(lean, Math.max(-CROOK.maxLean, Math.min(CROOK.maxLean, vx * CROOK.leanPerMS)), CROOK.leanTauS, c.dt);
    const r = CROOK.hookM * k;
    const top = CROOK.heightM * k;
    /** The hook tip in the crook's own frame, leaned about the foot. */
    const tipX = 2 * side * r;
    const hx = x + tipX * Math.cos(lean) + top * Math.sin(lean);
    const twos = Math.floor(c.t * LANTERN.fps) / LANTERN.fps;
    speed = still ? 0 : follow(speed, Math.min(1, Math.hypot(vx, groundVz) / ROAM.speed), PENDULUM.velTauS, c.dt);
    const bob = LANTERN.bobM * speed * Math.abs(Math.sin(Math.PI * LANTERN.stepHz * twos));
    const hy = -tipX * Math.sin(lean) + top * Math.cos(lean) + bob;
    stepPendulum(pendulum, hx, c.dt, still);
    if (writer === null) {
      hang(CROOK_QUADS - 1, hx, hy, z);
      return;
    }
    segment(0, 0, 0, 0, top, CROOK.shaftW * k, x, z);
    for (let i = 0; i < CROOK.hookSegments; i++) {
      const t0 = (i / CROOK.hookSegments) * CROOK.hookSweep;
      const t1 = ((i + 1) / CROOK.hookSegments) * CROOK.hookSweep;
      segment(1 + i, side * r * (1 - Math.cos(Math.PI * t0)), top + r * Math.sin(Math.PI * t0),
        side * r * (1 - Math.cos(Math.PI * t1)), top + r * Math.sin(Math.PI * t1), CROOK.hookW * k, x, z);
    }
    hang(CROOK_QUADS - 1, hx, hy, z);
    writer.commit(0, CROOK_QUADS);
  }

  /** The figure carrying the lantern by a short handle from its fist: the handle and lantern swing about the hand. */
  function figureFrame(c: Clock, reduced: boolean, still: boolean, x: number, z: number, tick: number): void {
    const p = puppet!;
    stepGait(gait, c.t, c.dt, groundVx, gaitVz, c.frozen, reduced);
    if (still || tick !== lastTick) figureSide = carrySide(x, z);
    const mirror = gait.view === 'side' ? gait.dir : gait.view === 'front' ? -figureSide : figureSide;
    const k = wide ? 1 : FIGURE.portraitK;
    p.place(gait, x, z, k, mirror);
    const gx = p.grip[0]!;
    const gy = p.grip[1]!;
    stepPendulum(pendulum, gx, c.dt, still);
    const handle = HELD.handleM * k;
    const hx = gx + Math.sin(pendulum.angle) * handle;
    const hy = gy - Math.cos(pendulum.angle) * handle;
    const w = writer!;
    p.write(w);
    piece(SLOT.handle, gx, gy, hx, hy, CROOK.hookW * (scale / LANTERN.scaleWide), z, hookPhase);
    hang(SLOT.lantern, hx, hy, z);
    for (let i = 0; i < 3; i++) {
      flameEase[i] = still ? 0 : follow(flameEase[i]!, 0, HELD.flameTauS, c.dt);
      flame[i]! += flameEase[i]!;
    }
    w.commit(0, VISITOR_QUADS);
  }

  /**
   * The figure's carrying side seen from behind: its left (-1), clear of the props the stand points put on the right
   * (the watering can by the Rosaleda rose), or toward the bank when it skirts the pond.
   */
  function carrySide(x: number, z: number): number {
    return pond !== null && Math.hypot((x - pond.x) / pond.rx, (z - pond.z) / pond.rz) < CROOK.pondNear ? bankSide(x, z) : -1;
  }

  /** +1, or toward the bank (-1 west of the pond's centre) when the visitor skirts the pond. */
  function bankSide(x: number, z: number): number {
    if (pond !== null && Math.hypot((x - pond.x) / pond.rx, (z - pond.z) / pond.rz) < CROOK.pondNear) return x < pond.x ? -1 : 1;
    return 1;
  }

  return {
    flame,
    pendulum,
    get figure() { return shown; },
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
      w.count = CROOK_QUADS;
    },
    attachFigure(rects, lantern, handle, onShow) {
      if (writer === null || puppet !== null) return;
      puppet = createPuppet(rects);
      show = () => {
        onShow();
        plateW = lantern.size[0];
        plateH = lantern.size[1];
        lamp.px = lantern.pivot[0];
        lamp.py = lantern.pivot[1];
        lamp.uv = lantern.uv;
        patch.set(handle.uv);
        scale = wide ? HELD.scaleWide : HELD.scaleTall;
        writer!.count = VISITOR_QUADS;
      };
    },
    resize(w, h) {
      wide = w >= h;
      const held = shown ? HELD : LANTERN;
      scale = wide ? held.scaleWide : held.scaleTall;
    },
    frame(c, reduced) {
      const x = pos[0]!;
      const z = pos[1]!;
      const still = reduced || c.frozen;
      const tick = Math.floor(c.t * FIGURE.fps);
      const fresh = Number.isNaN(lastX) || c.dt <= 0;
      groundVx = fresh ? 0 : follow(groundVx, (x - lastX) / c.dt, HELD.velTauS, c.dt);
      groundVz = fresh ? 0 : (z - lastZ) / c.dt;
      gaitVz = fresh ? 0 : follow(gaitVz, groundVz, HELD.velTauS, c.dt);
      lastX = x;
      lastZ = z;
      if (show !== null && (c.frozen || tick !== lastTick)) {
        const fx = flame[0]!;
        const fy = flame[1]!;
        const fz = flame[2]!;
        show();
        show = null;
        shown = true;
        figureFrame(c, reduced, still, x, z, tick);
        flameEase[0] = still ? 0 : fx - flame[0]!;
        flameEase[1] = still ? 0 : fy - flame[1]!;
        flameEase[2] = still ? 0 : fz - flame[2]!;
        flame[0]! += flameEase[0]!;
        flame[1]! += flameEase[1]!;
        flame[2]! += flameEase[2]!;
      } else if (shown) {
        figureFrame(c, reduced, still, x, z, tick);
      } else {
        crookFrame(c, still, x, z);
      }
      lastTick = tick;
    },
  };
}
