/**
 * The archive bosses' motions (cook/PLAN_3D.md F5), keyed by a boss file's "motion". `play` writes the display at t
 * seconds (0 to `seconds`; t = seconds is the end pose), `idle` the resting loop after it, t seconds into the rest.
 * Both write into a caller-owned pose: part angles add to each part's rest hinge (degrees), sx and sy are the seen width
 * and length of a part (a turn in depth, never a squeeze of the drawing), dx and dy move the whole puppet (metres).
 * The peacock has no parts: grow, display and turn (0 to 1) steer the Estanque fan (behaviours/estanque.ts).
 */
import type { SpriteId } from '../types.ts';

export interface PartPose { angle: number; sx: number; sy: number }
export interface BossPose { dx: number; dy: number; grow: number; display: number; turn: number; readonly roles: readonly string[]; readonly parts: Record<string, PartPose> }

export interface Motion {
  readonly seconds: number;
  readonly roles: readonly string[];
  /** Bed items the boss redraws itself: the bed hides its own copies while the boss is grown. */
  readonly owns: readonly SpriteId[];
  play(p: BossPose, t: number): void;
  idle(p: BossPose, t: number): void;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x: number): number => x * x * (3 - 2 * x);
/** Eased share of the way from a to b seconds. */
const seg = (t: number, a: number, b: number): number => ease(clamp01((t - a) / (b - a)));
const TAU = Math.PI * 2;
/** A short sharp flick inside [a, b]: 0 outside, one bump of +1 inside. */
const flick = (t: number, a: number, b: number): number => (t < a || t > b ? 0 : Math.sin(Math.PI * (t - a) / (b - a)));

export function createPose(roles: readonly string[]): BossPose {
  const parts: Record<string, PartPose> = {};
  for (const r of roles) parts[r] = { angle: 0, sx: 1, sy: 1 };
  return { dx: 0, dy: 0, grow: 1, display: 1, turn: 0, roles, parts };
}

function reset(p: BossPose): void {
  p.dx = 0;
  p.dy = 0;
  p.grow = 1;
  p.display = 1;
  p.turn = 0;
  for (let i = 0; i < p.roles.length; i++) {
    const part = p.parts[p.roles[i] ?? ''];
    if (part === undefined) continue;
    part.angle = 0;
    part.sx = 1;
    part.sy = 1;
  }
}

function part(p: BossPose, role: string): PartPose {
  return p.parts[role] ?? SPARE;
}
/** Written when a role is missing from a pose (never read back). */
const SPARE: PartPose = { angle: 0, sx: 1, sy: 1 };

const MOTH = { seconds: 5.5, dropM: 7, landS: 1.6, beatS: 1.1, spreadAt: 3, flatAt: 4.4, halfOpen: 0.6 } as const;

const WINGS = ['wingFL', 'wingFR', 'wingHL', 'wingHR'] as const;
const LEAVES = [['leaf1', 1], ['leaf2', 1.25], ['leaf3', 1.5]] as const;

function mothWings(p: BossPose, sx: number, lift: number): void {
  for (const r of WINGS) {
    const w = part(p, r);
    const side = r.endsWith('L') ? 1 : -1;
    w.sx = sx;
    w.angle = side * lift * (r.startsWith('wingF') ? 1 : 0.6);
  }
}

function mothPlay(p: BossPose, t: number): void {
  reset(p);
  p.dy = MOTH.dropM * (1 - seg(t, 0, MOTH.landS));
  const beat = 0.5 + 0.5 * Math.cos(TAU * t / MOTH.beatS);
  const beating = 0.25 + 0.75 * beat;
  const spread = seg(t, MOTH.spreadAt, MOTH.spreadAt + 0.6);
  const settle = seg(t, MOTH.flatAt, MOTH.seconds);
  const sx = (beating * (1 - spread) + spread) * (1 - settle) + MOTH.halfOpen * settle;
  mothWings(p, sx, 12 * beat * (1 - spread) + 6 * settle);
  const twitch = flick(t, 2.2, 2.5) + flick(t, 3.6, 3.8) - flick(t, 4.6, 4.8);
  part(p, 'antennaL').angle = 10 * twitch;
  part(p, 'antennaR').angle = -10 * twitch;
}

function mothIdle(p: BossPose, t: number): void {
  mothPlay(p, MOTH.seconds);
  const breathe = 0.06 * Math.sin(TAU * t / 3.2);
  mothWings(p, MOTH.halfOpen + breathe, 6 + 3 * breathe);
  const twitch = flick(t % 4.5, 0, 0.25);
  part(p, 'antennaL').angle = 6 * twitch;
  part(p, 'antennaR').angle = -6 * twitch;
}

const BEETLE = { seconds: 5, hideM: 2.2, peekM: 0.6, riseS: 1.2, sinkAt: 4 } as const;

function beetlePlay(p: BossPose, t: number): void {
  reset(p);
  const rise = seg(t, 0, BEETLE.riseS);
  const sink = seg(t, BEETLE.sinkAt, BEETLE.seconds);
  p.dy = -BEETLE.hideM * (1 - rise) - BEETLE.peekM * sink;
  part(p, 'head').angle = -12 * seg(t, 1.2, 1.8) * (1 - 0.5 * sink);
  const grip = seg(t, 0.9, 1.6) * (1 - sink);
  part(p, 'legFL').angle = -40 * (1 - grip);
  part(p, 'legFR').angle = 40 * (1 - grip);
  const open = 35 * seg(t, 1.8, 2.6);
  const snap = open * (1 - seg(t, 2.6, 2.75)) + 30 * seg(t, 2.8, 3.0) * (1 - seg(t, 3.1, 3.22)) - 5 * flick(t, 3.22, 3.4);
  const jaw = t < 2.6 ? open : snap + 12 * sink;
  part(p, 'mandibleL').angle = jaw;
  part(p, 'mandibleR').angle = -jaw;
  const feel = 8 * Math.sin(TAU * t / 1.4) * (1 - sink);
  part(p, 'antennaL').angle = feel;
  part(p, 'antennaR').angle = -feel;
}

function beetleIdle(p: BossPose, t: number): void {
  beetlePlay(p, BEETLE.seconds);
  const feel = 6 * Math.sin(TAU * t / 2.6);
  part(p, 'antennaL').angle = feel;
  part(p, 'antennaR').angle = -feel * 0.8;
  const jaw = 12 + 4 * Math.sin(TAU * t / 5);
  part(p, 'mandibleL').angle = jaw;
  part(p, 'mandibleR').angle = -jaw;
}

const TRAP = { seconds: 5.5, open: 38 } as const;

function trapPlay(p: BossPose, t: number): void {
  reset(p);
  part(p, 'stem').sy = 0.05 + 0.95 * seg(t, 0, 1.4);
  for (const [r, delay] of LEAVES) {
    const unfurl = seg(t, delay, delay + 1);
    const leaf = part(p, r);
    leaf.angle = 70 * (1 - unfurl) * (r === 'leaf2' ? -1 : 1);
    leaf.sy = 0.3 + 0.7 * unfurl;
  }
  const open = seg(t, 2, 3.4) * (1 - seg(t, 3.6, 3.72)) + seg(t, 4.3, TRAP.seconds);
  const overshoot = -6 * flick(t, 3.72, 3.95);
  part(p, 'lobeTop').angle = TRAP.open * open + overshoot;
  part(p, 'lobeBottom').angle = -TRAP.open * open - overshoot;
}

function trapIdle(p: BossPose, t: number): void {
  trapPlay(p, TRAP.seconds);
  const breathe = 3 * Math.sin(TAU * t / 3.6);
  part(p, 'lobeTop').angle += breathe;
  part(p, 'lobeBottom').angle -= breathe;
  for (let i = 0; i < LEAVES.length; i++) part(p, LEAVES[i]?.[0] ?? '').angle += 2 * Math.sin(TAU * t / (4.2 + i));
}

const PEACOCK = { seconds: 5 } as const;

function peacockPlay(p: BossPose, t: number): void {
  reset(p);
  p.grow = seg(t, 0, 2.2);
  p.display = clamp01((t - 0.8) / 2.8);
  p.turn = seg(t, 1.5, PEACOCK.seconds);
}

function peacockIdle(p: BossPose, t: number): void {
  peacockPlay(p, PEACOCK.seconds);
  p.turn = 1 + 0.08 * Math.sin(TAU * t / 9);
}

export const MOTIONS: Readonly<Record<string, Motion>> = {
  'moth-queen': { seconds: MOTH.seconds, roles: ['body', 'wingFL', 'wingFR', 'wingHL', 'wingHR', 'antennaL', 'antennaR'], owns: [], play: mothPlay, idle: mothIdle },
  'stag-beetle': { seconds: BEETLE.seconds, roles: ['body', 'head', 'mandibleL', 'mandibleR', 'antennaL', 'antennaR', 'legFL', 'legFR'], owns: [], play: beetlePlay, idle: beetleIdle },
  flytrap: { seconds: TRAP.seconds, roles: ['stem', 'lobeTop', 'lobeBottom', 'leaf1', 'leaf2', 'leaf3'], owns: [], play: trapPlay, idle: trapIdle },
  peacock: { seconds: PEACOCK.seconds, roles: [], owns: ['es/peacock', 'es/peacock-crest'], play: peacockPlay, idle: peacockIdle },
};
