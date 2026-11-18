/**
 * The visitor's figure (cook/FIGURE_BUILD.md 4): a paper-cut puppet from the roam atlas, pinned part to part like a toy
 * theatre figure, who carries the lantern by its handle. The gait advances on twos of 12 fps by distance walked (one
 * pose per stride share, at most one per tick), so the feet change only on steps. Two views: back (walking away,
 * standing) and side (walking east or west, mirrored for west); walking south toward the lens keeps the side of the
 * last sideways movement, a figure carried downstage in profile. A view change is a swap on a tick, shown one tick
 * edge-on like a cutout being turned. The hierarchy is solved on the CPU into preallocated quads, re-grounded so the
 * lowest sole always stands on the ground plane. Nothing is allocated per frame.
 */
import type { InstanceWriter, QuadParams, SpriteRect } from '../types.ts';
import { QUAD_FLAG, packPhase } from './quadflags.ts';

export const FIGURE = {
  /** Hat top above the ground point (m) at scale 1, drawn at portraitK on portrait screens; stepped at fps. */
  topM: 1.35, portraitK: 1.2 / 1.35, fps: 12,
  /** Walked distance per pose (m): two poses a step of 0.54 m. */
  strideM: 0.27,
  /** Under walkFrom (m/s) for idleAfterS the figure stands; hips sway over the planted foot; shins stretch by `stretch`. */
  walkFrom: 0.3, idleAfterS: 0.25, hipSwayM: 0.014, stretch: 0.15,
  /** Heading counts above viewFrom (m/s): profile past sideOnDeg from north, back under backOnDeg; mirrored for front. */
  viewFrom: 0.25, sideOnDeg: 62.5, backOnDeg: 47.5,
  /** The slow idle shift: every shiftMinS plus up to shiftSpanS seconds, torso turn and root sway. */
  shiftMinS: 4.5, shiftSpanS: 2, shiftDeg: 1.5, shiftM: 0.008,
  /** Width shares: the side torso, and the torso and arms on the edge-on tick of a turn. */
  sideTorso: 0.78, edgeTorso: 0.45, edgeArm: 0.6,
  /** Side view: head and hat shifted toward the heading, near and far hips either side of the hip centre (m). */
  headFwdM: 0.02, hatFwdM: 0.03, hipM: 0.012,
  /** Contact shadow: carrier width (the shader spreads it 1.5 x 0.9) and opacity (the lantern lights the ground). */
  shadowW: 0.23, shadowA: 0.8,
  /** Atlas page side in px: the sole sits `pad` px above a shin quad's bottom edge. */
  pagePx: 512,
} as const;

export const FIGURE_SPRITES = ['fg/torso', 'fg/head', 'fg/hat', 'fg/arm', 'fg/arm-bent', 'fg/hand', 'fg/thigh-l', 'fg/shin-l', 'fg/thigh-r', 'fg/shin-r',
  'fg/void'] as const;
export type FigureRects = Readonly<Record<(typeof FIGURE_SPRITES)[number], SpriteRect>>;

/** Child pins as fractions of the parent sprite, y up (cook/look/r14figure/handoff.json, measured on the sprites). */
export const PINS = {
  neck: [0.7246, 0.8901], shoulderL: [0.1944, 0.7514], shoulderR: [0.896, 0.6944], hipL: [0.2492, 0.0746], hipR: [0.7246, 0.0746],
  sideShoulder: [0.62, 0.73], hatSeat: [0.4951, 0.7659], cuff: [0.4962, 0.0715], cuffBent: [0.4923, 0.1203], grip: [0.4923, 0.4367],
  kneeL: [0.4639, 0.0953], kneeR: [0.5541, 0.1092],
} as const;

/**
 * Each part's pin to its parent, as a fraction of its sprite (y up). The manifest centres every pivot, so the rig
 * keeps the measured ones (handoff.json pivotFrac).
 */
export const PIVOTS: Readonly<Record<(typeof FIGURE_SPRITES)[number], readonly [number, number]>> = {
  'fg/torso': [0.4881, 0.0852], 'fg/head': [0.4951, 0.2114], 'fg/hat': [0.5034, 0.3707], 'fg/arm': [0.4962, 0.8174], 'fg/arm-bent': [0.4923, 0.7534],
  'fg/hand': [0.4923, 0.7967], 'fg/thigh-l': [0.5082, 0.9497], 'fg/shin-l': [0.4855, 0.8692], 'fg/thigh-r': [0.523, 0.9506], 'fg/shin-r': [0.497, 0.872],
  'fg/void': [0.5, 0],
};

const DEG = Math.PI / 180;
/** Rest turns (degrees, counter-clockwise; sleeves cut hanging): the bent arm holds the lantern clear of the body. */
const REST = { freeArm: -3, carryArm: 16, sideFree: 0, sideCarry: 24 } as const;
/** Paper tones on the plates' own tint: the body held down under its lantern, the far leg and the fists in shade. */
const TONES = [[0.56, 0.55, 0.55], [0.42, 0.41, 0.41]] as const;
const TONE = { body: 0, far: 1 } as const;

/**
 * A pose: legs in degrees counter-clockwise (A is the left leg in the back view, the far leg in the side view), foot
 * heights (m, the swing foot raised), knee bends (degrees, foot inward in the back view, backward in the side view),
 * torso and head turns, the free arm's swing (outward in back, toward the heading in side) and drawn height, the carrying
 * arm's turn (at most 1 degree between poses, so the pool does not jitter) and the body's drop (m).
 */
export interface Pose {
  hipA: number; hipB: number; footA: number; footB: number; kneeA: number; kneeB: number;
  torso: number; head: number; free: number; freeH: number; carry: number; drop: number;
}
const pose = (hipA: number, hipB: number, footA: number, footB: number, kneeA: number, kneeB: number, torso: number, head: number,
  free: number, freeH: number, carry: number, drop: number): Pose => ({ hipA, hipB, footA, footB, kneeA, kneeB, torso, head, free, freeH, carry, drop });

/**
 * Back view: the stride swings in depth, so the stepping foot lifts up the screen on a shortened leg while the planted
 * leg stays long; the hips sit over the planted foot, the free arm swings opposite and the body drops on contact.
 * The front view draws the same table with the foot heights turned down the screen (the stepping leg lengthens).
 */
export const BACK_POSES: readonly Pose[] = [
  pose(-2, 2, 0.045, 0, 4, 0, 1, 0, -2, 1, 0, 0.012),
  pose(-1, 1, 0, 0.085, 0, 8, 0, 0, 0, 0.94, 0.5, 0),
  pose(-2, 2, 0, 0.045, 0, 4, -1, 0, 2, 0.88, 0, 0.012),
  pose(-1, 1, 0.085, 0, 8, 0, 0, 0, 0, 0.94, 0.5, 0),
];
/** Side view: legs swing in the picture plane toward the heading; A is the far leg, B the near one. */
export const SIDE_POSES: readonly Pose[] = [
  pose(-14, 18, 0, 0, 10, 0, -4, 0, 14, 1, 0, 0.01),
  pose(5, -2, 0.05, 0, 24, 0, -3, 0, 0, 1, 1, 0),
  pose(18, -14, 0, 0, 0, 10, -4, 0, -14, 1, 0, 0.01),
  pose(-2, 5, 0, 0.05, 0, 24, -3, 0, 0, 1, 1, 0),
];
/** Standing, in every view: feet a little apart, arms hanging. */
export const IDLE = pose(-3, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0);

export type View = 'back' | 'side' | 'front';

/** Gait state: what is drawn (view, side, pose, idle, edge-on, idle shift) and the inputs that move it. */
export interface Gait {
  view: View; dir: number; pose: number; idle: boolean; edge: boolean; shift: number;
  wantView: View; wantDir: number; tick: number; travelled: number; slowS: number; idleS: number; shifts: number; shiftAt: number;
}

export function createGait(): Gait {
  return { view: 'back', dir: 1, pose: 0, idle: true, edge: false, shift: 0, wantView: 'back', wantDir: 1, tick: NaN, travelled: 0,
    slowS: 0, idleS: 0, shifts: 0, shiftAt: shiftInterval(0) };
}

/** Seconds to the next idle shift: a fixed hash of the shift count, never Math.random, so stills repeat. */
function shiftInterval(n: number): number {
  const h = Math.sin(n * 12.9898 + 4.1414) * 43758.5453;
  return FIGURE.shiftMinS + FIGURE.shiftSpanS * (h - Math.floor(h));
}

/**
 * The wanted view from a heading phi (radians, 0 walking away from the lens): back, profile toward the sign of vx, or
 * front, with 15 degrees of hysteresis at each boundary.
 */
function desire(g: Gait, phi: number, vx: number): void {
  const a = Math.abs(phi) / DEG;
  const on = FIGURE.sideOnDeg;
  const off = FIGURE.backOnDeg;
  const from = g.wantView;
  const back = from === 'back' ? a <= on : a < off;
  const front = from === 'front' ? a >= 180 - on : a > 180 - off;
  g.wantView = back ? 'back' : front ? 'front' : 'side';
  if (g.wantView === 'side') g.wantDir = Math.sign(vx) || g.wantDir;
}

/**
 * One frame of the gait from the ground velocity (m/s). Poses, views and the idle shift change only when the 12 fps
 * tick floor(t * 12) moves. Frozen time gives the pose for the heading and speed at once (idle or the first pose of the
 * view); reduced motion keeps one standing pose with no cycle, no edge-on tick and no shift.
 */
export function stepGait(g: Gait, t: number, dt: number, vx: number, vz: number, frozen: boolean, reduced: boolean): void {
  const speed = Math.hypot(vx, vz);
  if (speed > FIGURE.viewFrom) desire(g, Math.atan2(vx, -vz), vx);
  g.slowS = speed < FIGURE.walkFrom ? g.slowS + dt : 0;
  const standing = frozen ? speed < FIGURE.walkFrom : g.slowS >= FIGURE.idleAfterS;
  g.idleS = standing ? g.idleS + dt : 0;
  if (standing && g.wantView === 'side') g.wantView = 'back';
  if (frozen) {
    g.view = g.wantView;
    g.dir = g.wantDir;
    g.idle = standing || reduced;
    g.pose = 0;
    g.edge = false;
    g.shift = 0;
    return;
  }
  if (!standing) g.travelled += speed * dt;
  const tick = Math.floor(t * FIGURE.fps);
  if (tick === g.tick) return;
  g.tick = tick;
  g.edge = false;
  if (g.view !== g.wantView || (g.wantView === 'side' && g.dir !== g.wantDir)) {
    g.view = g.wantView;
    g.dir = g.wantDir;
    g.edge = !reduced;
  }
  if (reduced) {
    g.idle = true;
    g.pose = 0;
    g.shift = 0;
    return;
  }
  if (standing) {
    if (!g.idle) {
      g.idle = true;
      g.shifts = 0;
      g.shiftAt = shiftInterval(0);
    } else if (g.idleS >= g.shiftAt) {
      g.shifts++;
      g.shift = g.shifts % 2 === 1 ? 1 : -1;
      g.shiftAt = g.idleS + shiftInterval(g.shifts);
    }
    return;
  }
  if (g.idle) {
    g.idle = false;
    g.pose = 0;
    g.travelled = 0;
    g.shift = 0;
  } else if (g.travelled >= FIGURE.strideM) {
    g.pose = (g.pose + 1) % BACK_POSES.length;
    g.travelled = Math.min(g.travelled - FIGURE.strideM, FIGURE.strideM);
  }
}

/** The pose the gait shows. */
export function poseOf(g: Gait): Pose {
  if (g.idle) return IDLE;
  return (g.view === 'side' ? SIDE_POSES : BACK_POSES)[g.pose]!;
}

/** The sole's height in a shin sprite: its padding as a share of the sprite's height. */
const padOf = (r: SpriteRect): number => r.pad / ((r.uv[3] - r.uv[1]) * FIGURE.pagePx);

/** One solved part: its rect, pivot (canonical figure plane, m), turn, width and height shares and mirroring. */
interface Sprite { rect: SpriteRect; px: number; py: number }
interface Part { sprite: Sprite; x: number; y: number; a: number; sx: number; sy: number; flip: boolean; tone: number }

/** Body parts (cook/FIGURE_BUILD.md 4). */
const S = { Torso: 0, Head: 1, Hat: 2, FreeArm: 3, FreeHand: 4, CarryArm: 5, CarryHand: 6, ThighA: 7, ShinA: 8, ThighB: 9, ShinB: 10 } as const;
/** Back and front: legs (shin over thigh), sleeve tops tucked under the smock's shoulders (no boxy rim), fists, hat. */
const BACK_ORDER = [S.ThighA, S.ShinA, S.ThighB, S.ShinB, S.FreeArm, S.CarryArm, S.Torso, S.FreeHand, S.CarryHand, S.Head, S.Hat] as const;
/** Side: the far arm behind the body, the near (carrying) arm in front of it. */
const SIDE_ORDER = [S.FreeArm, S.FreeHand, S.ThighA, S.ShinA, S.ThighB, S.ShinB, S.Torso, S.Head, S.Hat, S.CarryArm, S.CarryHand] as const;
/** Instance indices: the shadow, the eleven body parts in paint order, then (the visitor's) handle and lantern. */
export const SLOT = { shadow: 0, handle: 12, lantern: 13, count: 14 } as const;

export interface Puppet {
  /** The carrying hand's grip in world x, y (m), after place(). */
  readonly grip: Float32Array;
  /** The written quads by slot (tests read them back). */
  readonly quads: readonly QuadParams[];
  /** Solves the figure for the gait at ground point (x, z), scale k, mirrored when `mirror` is -1. */
  place(g: Gait, x: number, z: number, k: number, mirror: number): void;
  /** Writes the shadow and the body into their slots. */
  write(w: InstanceWriter): void;
}

export function createPuppet(rects: FigureRects): Puppet {
  const sprite = (id: keyof FigureRects): Sprite => ({ rect: rects[id], px: PIVOTS[id][0], py: PIVOTS[id][1] });
  const sprites = { thighL: sprite('fg/thigh-l'), shinL: sprite('fg/shin-l'), thighR: sprite('fg/thigh-r'), shinR: sprite('fg/shin-r') };
  const part = (id: keyof FigureRects): Part => ({ sprite: sprite(id), x: 0, y: 0, a: 0, sx: 1, sy: 1, flip: false, tone: TONE.body });
  const parts: Part[] = [part('fg/torso'), part('fg/head'), part('fg/hat'), part('fg/arm'), part('fg/hand'), part('fg/arm-bent'), part('fg/hand'),
    part('fg/thigh-l'), part('fg/shin-l'), part('fg/thigh-r'), part('fg/shin-r')];
  const flags = packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.noShadow);
  const quads: QuadParams[] = [];
  for (let i = 0; i < SLOT.count; i++) {
    quads.push({ x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0.5, py: 0, uv: new Float32Array(4), sway: 0, lift: 0, facing: 0,
      tint: new Float32Array([1, 1, 1, 1]), phase: flags });
  }
  const shadow = quads[SLOT.shadow]!;
  shadow.uv = rects['fg/void'].uv;
  shadow.phase = packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.hung);
  (shadow.tint as Float32Array)[3] = FIGURE.shadowA;
  const grip = new Float32Array(2);
  const pin = new Float32Array(2);
  const corner = [0, 0];
  let k = 1;

  /** World point (canonical) of a sprite fraction (fx, fy) on a placed part, into `pin`. */
  function pinOf(p: Part, f: readonly number[]): Float32Array {
    const r = p.sprite;
    let lx = (f[0]! - r.px) * r.rect.size[0] * k * p.sx;
    if (p.flip) lx = -lx;
    const ly = (f[1]! - r.py) * r.rect.size[1] * k * p.sy;
    const c = Math.cos(p.a);
    const s = Math.sin(p.a);
    pin[0] = p.x + c * lx - s * ly;
    pin[1] = p.y + s * lx + c * ly;
    return pin;
  }
  function set(p: Part, x: number, y: number, deg: number, sx: number, sy: number, flip: boolean): void {
    p.x = x; p.y = y; p.a = deg * DEG; p.sx = sx; p.sy = sy; p.flip = flip; p.tone = TONE.body;
  }
  /** The lower sole corner of a placed shin (y, m). */
  function soleY(p: Part): number {
    const pad = padOf(p.sprite.rect);
    corner[0] = pad;
    corner[1] = pad;
    const a = pinOf(p, corner)[1]!;
    corner[0] = 1 - pad;
    return Math.min(a, pinOf(p, corner)[1]!);
  }
  /**
   * Places a leg from its hip: turns, then puts the sole on `foot`: shortening the shin first and the thigh after, or
   * stretching the shin by at most FIGURE.stretch, so a planted foot always stands on the ground line.
   */
  function leg(thigh: Part, shin: Part, knee: readonly number[], hx: number, hy: number, hipDeg: number, kneeDeg: number, foot: number, base: number): void {
    set(thigh, hx, hy, hipDeg, 1, base, false);
    pinOf(thigh, knee);
    set(shin, pin[0]!, pin[1]!, hipDeg + kneeDeg, 1, 1, false);
    const over = foot - soleY(shin);
    const shinLen = shin.sprite.rect.size[1] * k * (shin.sprite.py - padOf(shin.sprite.rect));
    if (over <= 0) {
      shin.sy = 1 + Math.min(-over, shinLen * FIGURE.stretch) / shinLen;
      return;
    }
    const thighLen = thigh.sprite.rect.size[1] * k * (thigh.sprite.py - knee[1]!);
    const fromShin = Math.min(over, shinLen * 0.25);
    shin.sy = 1 - fromShin / shinLen;
    thigh.sy = base - (over - fromShin) / thighLen;
    pinOf(thigh, knee);
    shin.x = pin[0]!;
    shin.y = pin[1]!;
  }
  /** Hip to sole of a straight leg (m, scale 1). */
  const legRest = (thigh: Sprite, knee: readonly number[], shin: Sprite): number =>
    (thigh.py - knee[1]!) * thigh.rect.size[1] + (shin.py - padOf(shin.rect)) * shin.rect.size[1];
  const restL = legRest(sprites.thighL, PINS.kneeL, sprites.shinL);
  /** The right thigh is drawn longer by this share so both legs reach the ground from level hips. */
  const rightBase = 1 + (restL - legRest(sprites.thighR, PINS.kneeR, sprites.shinR)) / ((sprites.thighR.py - PINS.kneeR[1]) * sprites.thighR.rect.size[1]);
  /** A fist at its sleeve's cuff, turned and mirrored with it, in the smock's shade. */
  function hand(arm: Part, h: Part, cuff: readonly number[]): void {
    pinOf(arm, cuff);
    set(h, pin[0]!, pin[1]!, arm.a / DEG, 1, 1, arm.flip);
    h.tone = TONE.far;
  }
  function place(g: Gait, x: number, z: number, scale: number, mirror: number): void {
    k = scale;
    const p = poseOf(g);
    const side = g.view === 'side';
    const torsoW = g.edge ? FIGURE.edgeTorso : side ? FIGURE.sideTorso : 1;
    const armW = g.edge ? FIGURE.edgeArm : 1;
    const torso = parts[S.Torso]!;
    /** Back and front: hips over the planted foot. The front turns the foot heights down the screen. */
    const sway = side ? 0 : Math.sign(p.footA - p.footB) * FIGURE.hipSwayM;
    const feet = g.view === 'front' ? -1 : 1;
    set(torso, (g.shift * FIGURE.shiftM + sway) * k, restL * k - p.drop * k, p.torso + g.shift * FIGURE.shiftDeg, torsoW, 1, false);
    pinOf(torso, PINS.neck);
    const fwd = side ? 1 : 0;
    /** The nape shows only in profile: from behind and in front the hat's own dark crown covers the head. */
    set(parts[S.Head]!, pin[0]! + fwd * FIGURE.headFwdM * k, pin[1]!, p.torso + p.head, side ? 1 : 0, 1, false);
    pinOf(parts[S.Head]!, PINS.hatSeat);
    set(parts[S.Hat]!, pin[0]! + fwd * (FIGURE.hatFwdM - FIGURE.headFwdM) * k, pin[1]!, p.torso + p.head, 1, 1, false);
    const freeArm = parts[S.FreeArm]!;
    const carryArm = parts[S.CarryArm]!;
    if (side) {
      pinOf(torso, PINS.sideShoulder);
      const sx = pin[0]!;
      const sy = pin[1]!;
      set(freeArm, sx, sy, REST.sideFree + p.free, armW, p.freeH, false);
      set(carryArm, sx, sy, REST.sideCarry + p.carry, armW, 1, false);
    } else {
      pinOf(torso, PINS.shoulderL);
      set(freeArm, pin[0]!, pin[1]!, REST.freeArm - p.free, armW, p.freeH, true);
      pinOf(torso, PINS.shoulderR);
      set(carryArm, pin[0]!, pin[1]!, REST.carryArm + p.carry, armW, 1, false);
    }
    hand(freeArm, parts[S.FreeHand]!, PINS.cuff);
    hand(carryArm, parts[S.CarryHand]!, PINS.cuffBent);
    pinOf(parts[S.CarryHand]!, PINS.grip);
    grip[0] = pin[0]!;
    grip[1] = pin[1]!;
    const thighA = parts[S.ThighA]!;
    const shinA = parts[S.ShinA]!;
    const thighB = parts[S.ThighB]!;
    const shinB = parts[S.ShinB]!;
    if (side) {
      thighA.sprite = sprites.thighR;
      shinA.sprite = sprites.shinR;
      const hy = torso.y;
      leg(thighA, shinA, PINS.kneeR, torso.x - FIGURE.hipM * k, hy, p.hipA, -p.kneeA, p.footA * k, rightBase);
      leg(thighB, shinB, PINS.kneeR, torso.x + FIGURE.hipM * k, hy, p.hipB, -p.kneeB, p.footB * k, rightBase);
      thighA.tone = TONE.far;
      shinA.tone = TONE.far;
    } else {
      thighA.sprite = sprites.thighL;
      shinA.sprite = sprites.shinL;
      pinOf(torso, PINS.hipL);
      leg(thighA, shinA, PINS.kneeL, pin[0]!, pin[1]!, p.hipA, p.kneeA, feet * p.footA * k, 1);
      pinOf(torso, PINS.hipR);
      leg(thighB, shinB, PINS.kneeR, pin[0]!, pin[1]!, p.hipB, -p.kneeB, feet * p.footB * k, rightBase);
    }
    const ground = Math.min(soleY(shinA), soleY(shinB));
    for (const q of parts) q.y -= ground;
    grip[1] -= ground;
    grip[0] = x + mirror * grip[0]!;
    const order = side ? SIDE_ORDER : BACK_ORDER;
    for (let i = 0; i < order.length; i++) quadOf(parts[order[i]!]!, quads[1 + i]!, x, z, mirror);
    shadow.x = x + mirror * torso.x;
    shadow.y = 0;
    shadow.z = z;
    shadow.w = FIGURE.shadowW * k;
    shadow.h = shadow.w;
  }

  function quadOf(p: Part, q: QuadParams, x: number, z: number, mirror: number): void {
    const { rect: r, px, py } = p.sprite;
    const flip = p.flip !== mirror < 0;
    q.x = x + mirror * p.x;
    q.y = p.y;
    q.z = z;
    q.rot = mirror * p.a;
    q.w = r.size[0] * k * p.sx;
    q.h = r.size[1] * k * p.sy;
    q.px = flip ? 1 - px : px;
    q.py = py;
    const uv = q.uv as Float32Array;
    uv[0] = flip ? r.uv[2] : r.uv[0];
    uv[1] = r.uv[1];
    uv[2] = flip ? r.uv[0] : r.uv[2];
    uv[3] = r.uv[3];
    (q.tint as Float32Array).set(TONES[p.tone]!);
  }

  return {
    grip,
    quads,
    place,
    write(w) {
      w.set(SLOT.shadow, shadow);
      for (let i = 1; i < SLOT.handle; i++) w.set(i, quads[i]!);
    },
  };
}
