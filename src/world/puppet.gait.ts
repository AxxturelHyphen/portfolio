/**
 * The figure's gait (cook/FIGURE_BUILD.md 4), stepped on the 12 fps tick: the eight directions and the turns between
 * them, the walk cycle
 * advanced by distance walked, the crouch before the first stride, the settling step and the landing dip after the
 * last, the weight of the body (a lean into speed and its changes, a bank into turns seen from behind) and the life of
 * a figure standing still: a breath, a glance either way and, after six seconds, the lantern lifted to look about.
 * Reduced motion keeps one standing pose. Nothing is allocated per frame.
 */
import { follow, ROAM } from '../core/motion.ts';
import { ANTICIPATE, BACK_POSES, IDLE, SETTLE, SIDE_POSES, type Pose } from './puppet.poses.ts';

export const GAIT = {
  /** Poses step at fps; walked distance per pose (m): two poses a calm step of 0.42 m. */
  fps: 12, strideM: 0.21,
  /** Under walkFrom (m/s) for idleAfterS the figure stands. */
  walkFrom: 0.3, idleAfterS: 0.25,
  /**
   * Heading counts above viewFrom (m/s). The direction drawn is one of eight 45-degree sectors of the heading against
   * the camera's yaw; the sector changes only past its edge by hysteresisDeg, so it never flickers at a boundary.
   */
  viewFrom: 0.25, hysteresisDeg: 10,
  /** The slow idle shift: every shiftMinS plus up to shiftSpanS seconds, torso turn and root sway. */
  shiftMinS: 4.5, shiftSpanS: 2, shiftDeg: 1.5, shiftM: 0.008,
} as const;

/**
 * Weight, sampled on the ticks. In profile the torso leans toward the heading by speedDeg at full roam speed and by
 * perAccel degrees per m/s2 of the smoothed change of speed either way (the body pushes off on a start and carries on
 * past a stop), at most maxDeg. From behind it banks toward the side the walk swings to: bankDeg at full sideways
 * speed plus bankPerAccel per m/s2 of sideways change, at most maxBankDeg. tauS smooths both changes.
 */
export const LEAN = { speedDeg: 3, perAccel: 0.45, maxDeg: 7, bankDeg: 2, bankPerAccel: 0.4, maxBankDeg: 5, tauS: 0.25 } as const;

/**
 * Standing life on the idle clock (seconds standing). A breath every breathS swells the smock by breathK of its height.
 * On a cycle of cycleS the head glances to the free side (glanceFree), the lantern is lifted by liftDeg with the head
 * turned liftLook toward it (lift: six seconds after stopping, then once a cycle) and the head glances over the
 * carrying shoulder (glanceCarry); each [from, to] in seconds, eased in and out over rampS. A full glance turns the
 * head lookDeg, moves it lookM (m) and narrows it by lookNarrow, a cutout head turned on its pin.
 */
export const LIFE = {
  breathS: 3.6, breathK: 0.014, cycleS: 15, rampS: 0.34, glanceFree: [2.2, 3.6], lift: [6, 9.4], glanceCarry: [11.4, 12.8],
  liftDeg: 40, liftLook: 0.6, lookDeg: 5, lookM: 0.012, lookNarrow: 0.1,
} as const;

/** The landing after a stop: the body's drop (m) by ticks left of it, sinking and coming up a hair past rest. */
export const DIP = [0, -0.003, 0.008, 0.016] as const;
/** Ticks of the crouch before the first stride, and of the settling step between the last stride and standing. */
const CUE_TICKS = 1;
const SETTLE_TICKS = 2;
const DEG = Math.PI / 180;
const SECTOR = Math.PI / 4;

export type View = 'back' | 'side';
/**
 * The eight directions, by the heading against the camera's yaw, clockwise from walking away from the lens: back,
 * back right, right, front right, front, front left, left, back left. Each is drawn from the art of a view (the front
 * and the back diagonals from the back view, the front diagonals from the profile) turned toward `dir` on screen.
 */
export const OCTANTS: readonly { readonly view: View; readonly dir: number }[] = [
  { view: 'back', dir: 1 }, { view: 'back', dir: 1 }, { view: 'side', dir: 1 }, { view: 'side', dir: 1 },
  { view: 'back', dir: -1 }, { view: 'side', dir: -1 }, { view: 'side', dir: -1 }, { view: 'back', dir: -1 },
];

/**
 * Gait state. Drawn: the direction (octant) with its view and screen side, pose, idle, ticks left of the settling
 * step, of the crouch and of the landing dip, the idle shift, lean and bank (degrees), breath (-1..1), look (-1 free
 * side..1 carrying side) and lift (0..1). Inputs: the heading (radians, 0 walking north, positive toward +x), the
 * wanted octant and the way to turn to it, the last tick, distance since the last pose, seconds slow and standing,
 * the idle shifts, and the last speed, sideways speed and their smoothed changes. Out: steps, the footfalls so far
 * (a contact pose, the settling step, or in reduced motion every two stride shares), read by the footstep sound.
 */
export interface Gait {
  oct: number; view: View; dir: number; pose: number; idle: boolean; settle: number; cue: number; dip: number; shift: number;
  lean: number; bank: number; breath: number; look: number; lift: number;
  heading: number; wantOct: number; spin: number; tick: number; travelled: number; slowS: number; idleS: number; shifts: number; shiftAt: number;
  speed: number; vx: number; accel: number; accelX: number; steps: number;
}

export function createGait(): Gait {
  return { oct: 0, view: 'back', dir: 1, pose: 0, idle: true, settle: 0, cue: 0, dip: 0, shift: 0, lean: 0, bank: 0, breath: 0, look: 0,
    lift: 0, heading: 0, wantOct: 0, spin: 1, tick: NaN, travelled: 0, slowS: GAIT.idleAfterS, idleS: 0, shifts: 0, shiftAt: shiftInterval(0),
    speed: 0, vx: 0, accel: 0, accelX: 0, steps: 0 };
}

/** Shows octant `oct` (0..7): its view and screen side. */
export function face(g: Gait, oct: number): void {
  g.oct = oct;
  g.view = OCTANTS[oct]!.view;
  g.dir = OCTANTS[oct]!.dir;
}

/**
 * The puppet's mirroring for the octant drawn, given the carrying hand's screen side seen from behind (`hand`): the
 * back views keep it, the front is the back art turned round (the carrying hand on the other side) and the profiles
 * face their way.
 */
export function mirrorOf(g: Gait, hand: number): number {
  if (g.view === 'side') return g.dir;
  return g.oct === 4 ? -hand : hand;
}

/** Seconds to the next idle shift: a fixed hash of the shift count, never Math.random, so stills repeat. */
function shiftInterval(n: number): number {
  const h = Math.sin(n * 12.9898 + 4.1414) * 43758.5453;
  return GAIT.shiftMinS + GAIT.shiftSpanS * (h - Math.floor(h));
}

/** `a` wrapped into (-half, half]. */
const wrap = (a: number, half: number): number => a - 2 * half * Math.ceil((a - half) / (2 * half));

/**
 * The wanted octant for the heading seen from a camera at `yaw` (radians, positive toward +x): the nearest sector, kept
 * until the angle leaves the wanted one by its half width plus GAIT.hysteresisDeg. `spin` is the way round to it.
 */
function desire(g: Gait, yaw: number): void {
  const a = wrap(g.heading - yaw, Math.PI) / SECTOR;
  const off = wrap(a - g.wantOct, 4);
  if (Math.abs(off) > 0.5 + (GAIT.hysteresisDeg * DEG) / SECTOR) g.wantOct = (Math.round(a) + 8) % 8;
  const toShown = wrap(a - g.oct, 4);
  if (toShown !== 0) g.spin = Math.sign(toShown);
}

const clamp = (v: number, m: number): number => (v > m ? m : v < -m ? -m : v);
const smooth = (a: number, b: number, x: number): number => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};
/** 0..1 inside the window [from, to] of the idle cycle, eased over LIFE.rampS at each end. */
const within = (c: number, w: readonly [number, number]): number => smooth(w[0], w[0] + LIFE.rampS, c) * (1 - smooth(w[1] - LIFE.rampS, w[1], c));

/** Every frame: the smoothed changes of speed and of sideways speed (m/s2). */
function feel(g: Gait, dt: number, vx: number, speed: number): void {
  if (dt > 0) {
    g.accel = follow(g.accel, (speed - g.speed) / dt, LEAN.tauS, dt);
    g.accelX = follow(g.accelX, (vx - g.vx) / dt, LEAN.tauS, dt);
  }
  g.speed = speed;
  g.vx = vx;
}

/** On a tick: the lean and bank for this speed and its changes; the bank only while walking. */
function weigh(g: Gait, speed: number, vx: number): void {
  g.lean = Math.min(LEAN.maxDeg, (LEAN.speedDeg * Math.min(speed, ROAM.speed)) / ROAM.speed + LEAN.perAccel * Math.abs(g.accel));
  g.bank = speed < GAIT.walkFrom ? 0 : clamp((LEAN.bankDeg * vx) / ROAM.speed + LEAN.bankPerAccel * g.accelX, LEAN.maxBankDeg);
}

/** On a tick while standing: breath, glances and the lifted lantern from the idle clock. */
function live(g: Gait): void {
  const c = g.idleS % LIFE.cycleS;
  g.breath = Math.sin((2 * Math.PI * g.idleS) / LIFE.breathS);
  g.lift = within(c, LIFE.lift);
  g.look = LIFE.liftLook * g.lift - within(c, LIFE.glanceFree) + within(c, LIFE.glanceCarry);
}

/** No weight, life or cues: the static standing layer of frozen time and reduced motion. */
function rest(g: Gait): void {
  g.cue = 0; g.dip = 0; g.shift = 0; g.lean = 0; g.bank = 0; g.breath = 0; g.look = 0; g.lift = 0;
}

/**
 * One frame of the gait from the ground velocity (m/s). Poses, views, weight and the idle life change only when the
 * 12 fps tick floor(t * 12) moves. Frozen time gives the pose for the heading and speed at once (idle or the first
 * pose of the view, leaning with the speed); reduced motion keeps one standing pose with no cycle, turn or life.
 */
export function stepGait(g: Gait, t: number, dt: number, vx: number, vz: number, frozen: boolean, reduced: boolean, yaw = 0): void {
  const speed = Math.hypot(vx, vz);
  if (speed > GAIT.viewFrom) g.heading = Math.atan2(vx, -vz);
  feel(g, dt, vx, speed);
  g.slowS = speed < GAIT.walkFrom ? g.slowS + dt : 0;
  const standing = frozen ? speed < GAIT.walkFrom : g.slowS >= GAIT.idleAfterS;
  g.idleS = standing ? g.idleS + dt : 0;
  /** Standing, the figure faces the garden, away from the lens's rest bearing. */
  if (standing) g.heading = 0;
  desire(g, yaw);
  if (frozen) {
    face(g, g.wantOct);
    g.idle = standing || reduced;
    g.pose = 0;
    rest(g);
    if (!g.idle) g.lean = (LEAN.speedDeg * Math.min(speed, ROAM.speed)) / ROAM.speed;
    return;
  }
  if (!standing) g.travelled += speed * dt;
  const tick = Math.floor(t * GAIT.fps);
  if (tick === g.tick) return;
  g.tick = tick;
  if (reduced) {
    if (g.travelled >= 2 * GAIT.strideM) {
      g.steps++;
      g.travelled = Math.min(g.travelled - 2 * GAIT.strideM, GAIT.strideM);
    }
    face(g, g.wantOct);
    g.idle = true;
    g.pose = 0;
    g.settle = 0;
    rest(g);
    return;
  }
  weigh(g, speed, vx);
  /** Coming to a stop: the settling step first, the view held; the turn and the standing pose follow. */
  if (!standing || g.idle) g.settle = 0;
  else {
    if (g.settle === 0) {
      g.settle = SETTLE_TICKS + 1;
      g.steps++;
    }
    g.settle--;
    g.cue = 0;
    if (g.settle > 0) return;
  }
  turnStep(g);
  if (standing) stand(g);
  else stride(g);
}

/** A standing tick: the landing dip on the first ticks, the idle shift now and then, and the idle life. */
function stand(g: Gait): void {
  if (g.dip > 0) g.dip--;
  if (!g.idle) {
    g.idle = true;
    g.dip = DIP.length - 1;
    g.shifts = 0;
    g.shiftAt = shiftInterval(0);
  } else if (g.idleS >= g.shiftAt) {
    g.shifts++;
    g.shift = g.shifts % 2 === 1 ? 1 : -1;
    g.shiftAt = g.idleS + shiftInterval(g.shifts);
  }
  live(g);
}

/** A walking tick: the crouch on setting off, then one pose per stride share; the even poses put a foot down. */
function stride(g: Gait): void {
  g.dip = 0;
  g.breath = 0;
  g.look = 0;
  g.lift = 0;
  if (g.idle) {
    g.idle = false;
    g.pose = 0;
    g.travelled = 0;
    g.shift = 0;
    g.cue = CUE_TICKS;
  } else if (g.cue > 0) {
    g.cue--;
    g.travelled = 0;
    if (g.cue === 0) g.steps++;
  } else if (g.travelled >= GAIT.strideM) {
    g.pose = (g.pose + 1) % BACK_POSES.length;
    g.travelled = Math.min(g.travelled - GAIT.strideM, GAIT.strideM);
    if (g.pose % 2 === 0) g.steps++;
  }
}

/**
 * A tick of the turn: one octant toward the wanted one the short way round (`spin` when it lies opposite), so a turn
 * shows the directions between as stepped poses; a half turn takes its first two octants at once, so a turn never
 * holds more than two poses between.
 */
function turnStep(g: Gait): void {
  const ahead = (g.wantOct - g.oct + 8) % 8;
  if (ahead === 0) return;
  const way = ahead === 4 ? g.spin : ahead < 4 ? 1 : -1;
  face(g, (g.oct + way * (ahead === 4 ? 2 : 1) + 8) % 8);
}

/** The pose the gait shows. */
export function poseOf(g: Gait): Pose {
  if (g.idle) return IDLE;
  if (g.settle > 0) return SETTLE[g.view];
  if (g.cue > 0) return ANTICIPATE[g.view];
  return (g.view === 'side' ? SIDE_POSES : BACK_POSES)[g.pose]!;
}
