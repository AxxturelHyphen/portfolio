/**
 * The figure's gait (cook/FIGURE_BUILD.md 4), stepped on the 12 fps tick: the views and their turns, the walk cycle
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
  /** Heading counts above viewFrom (m/s): profile past sideOnDeg from north, back under backOnDeg. */
  viewFrom: 0.25, sideOnDeg: 62.5, backOnDeg: 47.5,
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
/**
 * The turn between views, by ticks left (index 0: no turn): torso and arm width shares. On the first tick the old view
 * narrows; the view swaps on the second, drawn edge-on, and opens out on the third.
 */
export const TURN = { ticks: 3, swapAt: 2, torso: [1, 0.8, 0.45, 0.62], arm: [1, 0.85, 0.6, 0.75] } as const;
const DEG = Math.PI / 180;

export type View = 'back' | 'side';

/**
 * Gait state. Drawn: view, side, pose, idle, ticks left of a turn, of the settling step, of the crouch and of the
 * landing dip, the idle shift, lean and bank (degrees), breath (-1..1), look (-1 free side..1 carrying side) and lift
 * (0..1). Inputs: the wanted view and side, the last tick, distance since the last pose, seconds slow and standing,
 * the idle shifts, and the last speed, sideways speed and their smoothed changes.
 */
export interface Gait {
  view: View; dir: number; pose: number; idle: boolean; turn: number; settle: number; cue: number; dip: number; shift: number;
  lean: number; bank: number; breath: number; look: number; lift: number;
  wantView: View; wantDir: number; tick: number; travelled: number; slowS: number; idleS: number; shifts: number; shiftAt: number;
  speed: number; vx: number; accel: number; accelX: number;
}

export function createGait(): Gait {
  return { view: 'back', dir: 1, pose: 0, idle: true, turn: 0, settle: 0, cue: 0, dip: 0, shift: 0, lean: 0, bank: 0, breath: 0, look: 0,
    lift: 0, wantView: 'back', wantDir: 1, tick: NaN, travelled: 0, slowS: 0, idleS: 0, shifts: 0, shiftAt: shiftInterval(0), speed: 0, vx: 0,
    accel: 0, accelX: 0 };
}

/** Seconds to the next idle shift: a fixed hash of the shift count, never Math.random, so stills repeat. */
function shiftInterval(n: number): number {
  const h = Math.sin(n * 12.9898 + 4.1414) * 43758.5453;
  return GAIT.shiftMinS + GAIT.shiftSpanS * (h - Math.floor(h));
}

/**
 * The wanted view from a heading phi (radians, 0 walking away from the lens): back, with 15 degrees of hysteresis, or
 * profile. The profile faces the sign of vx while the walk is sideways (under 180 - backOnDeg from north); walking
 * south toward the lens keeps the side of the last sideways movement, so the figure never walks backward.
 */
function desire(g: Gait, phi: number, vx: number): void {
  const a = Math.abs(phi) / DEG;
  const back = g.wantView === 'back' ? a <= GAIT.sideOnDeg : a < GAIT.backOnDeg;
  g.wantView = back ? 'back' : 'side';
  if (!back && a < 180 - GAIT.backOnDeg) g.wantDir = Math.sign(vx) || g.wantDir;
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
export function stepGait(g: Gait, t: number, dt: number, vx: number, vz: number, frozen: boolean, reduced: boolean): void {
  const speed = Math.hypot(vx, vz);
  if (speed > GAIT.viewFrom) desire(g, Math.atan2(vx, -vz), vx);
  feel(g, dt, vx, speed);
  g.slowS = speed < GAIT.walkFrom ? g.slowS + dt : 0;
  const standing = frozen ? speed < GAIT.walkFrom : g.slowS >= GAIT.idleAfterS;
  g.idleS = standing ? g.idleS + dt : 0;
  if (standing && g.wantView === 'side') g.wantView = 'back';
  if (frozen) {
    g.view = g.wantView;
    g.dir = g.wantDir;
    g.idle = standing || reduced;
    g.pose = 0;
    g.turn = 0;
    rest(g);
    if (!g.idle) g.lean = (LEAN.speedDeg * Math.min(speed, ROAM.speed)) / ROAM.speed;
    return;
  }
  if (!standing) g.travelled += speed * dt;
  const tick = Math.floor(t * GAIT.fps);
  if (tick === g.tick) return;
  g.tick = tick;
  if (reduced) {
    turnStep(g, true);
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
    if (g.settle === 0) g.settle = SETTLE_TICKS + 1;
    g.settle--;
    g.cue = 0;
    if (g.settle > 0) return;
  }
  turnStep(g, false);
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

/** A walking tick: the crouch on setting off, then one pose per stride share. */
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
  } else if (g.travelled >= GAIT.strideM) {
    g.pose = (g.pose + 1) % BACK_POSES.length;
    g.travelled = Math.min(g.travelled - GAIT.strideM, GAIT.strideM);
  }
}

/** A tick of the turn: starts one when the wanted view or side differs, swaps the view halfway; reduced swaps at once. */
function turnStep(g: Gait, reduced: boolean): void {
  const differs = g.view !== g.wantView || (g.wantView === 'side' && g.dir !== g.wantDir);
  if (g.turn > 0) g.turn--;
  if (g.turn === 0 && differs && !reduced) g.turn = TURN.ticks;
  if (differs && g.turn <= TURN.swapAt) {
    g.view = g.wantView;
    g.dir = g.wantDir;
  }
}

/** The pose the gait shows. */
export function poseOf(g: Gait): Pose {
  if (g.idle) return IDLE;
  if (g.settle > 0) return SETTLE[g.view];
  if (g.cue > 0) return ANTICIPATE[g.view];
  return (g.view === 'side' ? SIDE_POSES : BACK_POSES)[g.pose]!;
}
