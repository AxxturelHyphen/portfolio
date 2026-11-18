/**
 * The visitor's figure (cook/FIGURE_BUILD.md 4): a paper-cut puppet from the roam atlas, pinned part to part like a toy
 * theatre figure, who carries the lantern by its handle. The gait advances on twos of 12 fps by distance walked (one
 * pose per stride share, at most one per tick), so the feet change only on steps. Two views: back (walking away,
 * standing) and side (walking east or west, mirrored for west); walking south toward the lens keeps the side of the
 * last sideways movement, a figure carried downstage in profile. A view change is a turn over three ticks (a quarter
 * second): the old view narrows, the new one shows edge-on, then opens out, like a cutout being turned by hand. The
 * hierarchy is solved on the CPU into preallocated quads, re-grounded so the lowest sole always stands on the ground
 * plane. Nothing is allocated per frame.
 */
import type { InstanceWriter, QuadParams, SpriteRect } from '../types.ts';
import { BACK_POSES, IDLE, REST, SIDE_POSES, type Pose } from './puppet.poses.ts';
import { QUAD_FLAG, packPhase } from './quadflags.ts';

export const FIGURE = {
  /** Hat top above the ground point (m) at scale 1, drawn at portraitK on portrait screens; stepped at fps. */
  topM: 1.35, portraitK: 1.2 / 1.35, fps: 12,
  /** Walked distance per pose (m): two poses a step of 0.54 m. */
  strideM: 0.27,
  /** Under walkFrom (m/s) for idleAfterS the figure stands; hips sway over the planted foot; shins stretch by `stretch`. */
  walkFrom: 0.3, idleAfterS: 0.25, hipSwayM: 0.014, stretch: 0.15,
  /** Heading counts above viewFrom (m/s): profile past sideOnDeg from north, back under backOnDeg. */
  viewFrom: 0.25, sideOnDeg: 62.5, backOnDeg: 47.5,
  /** The slow idle shift: every shiftMinS plus up to shiftSpanS seconds, torso turn and root sway. */
  shiftMinS: 4.5, shiftSpanS: 2, shiftDeg: 1.5, shiftM: 0.008,
  /** Width share of the side torso. */
  sideTorso: 0.78,
  /** Back view: each sleeve hangs this share of its width out from its shoulder pin, beside the smock and under its edge. */
  armOut: 0.3,
  /** Sleeve width share (slim sleeves, not puffed panels) and how far the shoulder pins sit under the smock's top (m). */
  armSlim: 0.8, armDropM: 0.02,
  /**
   * Drawn size of the head (a real head under the hat: hair, nape and ears) and of the hat, against their sprites, and
   * how far the hat sits above its seat (m), so the hair shows under the brim.
   */
  headK: 1.4, hatK: 0.78, hatLiftM: 0.012,
  /** Side view: head and hat shifted toward the heading, near and far hips either side of the hip centre (m). */
  headFwdM: 0.02, hatFwdM: 0.03, hipM: 0.012,
  /** Back view: each hip drawn this far in from its pin, so the trouser legs meet at the seat with no gap of ground. */
  hipInM: 0.01,
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
/**
 * Paper tones on the plates' own tint, both above the shader's shaded-layer luma (0.75), so the inner edges take no
 * cool moon rim: the figure is held down by the actor batch's share of the lantern light instead. The far leg and the
 * fists a step darker.
 */
const TONES = [[0.8, 0.79, 0.78], [0.77, 0.76, 0.75]] as const;
const TONE = { body: 0, far: 1 } as const;
/**
 * The turn between views, by ticks left (index 0: no turn): torso and arm width shares. On the first tick the old view
 * narrows; the view swaps on the second, drawn edge-on, and opens out on the third.
 */
const TURN = { ticks: 3, swapAt: 2, torso: [1, 0.8, 0.45, 0.62], arm: [1, 0.85, 0.6, 0.75] } as const;

export type View = 'back' | 'side';

/** Gait state: what is drawn (view, side, pose, idle, ticks left of a turn, idle shift) and the inputs that move it. */
export interface Gait {
  view: View; dir: number; pose: number; idle: boolean; turn: number; shift: number;
  wantView: View; wantDir: number; tick: number; travelled: number; slowS: number; idleS: number; shifts: number; shiftAt: number;
}

export function createGait(): Gait {
  return { view: 'back', dir: 1, pose: 0, idle: true, turn: 0, shift: 0, wantView: 'back', wantDir: 1, tick: NaN, travelled: 0,
    slowS: 0, idleS: 0, shifts: 0, shiftAt: shiftInterval(0) };
}

/** Seconds to the next idle shift: a fixed hash of the shift count, never Math.random, so stills repeat. */
function shiftInterval(n: number): number {
  const h = Math.sin(n * 12.9898 + 4.1414) * 43758.5453;
  return FIGURE.shiftMinS + FIGURE.shiftSpanS * (h - Math.floor(h));
}

/**
 * The wanted view from a heading phi (radians, 0 walking away from the lens): back, with 15 degrees of hysteresis, or
 * profile. The profile faces the sign of vx while the walk is sideways (under 180 - backOnDeg from north); walking
 * south toward the lens keeps the side of the last sideways movement, so the figure never walks backward.
 */
function desire(g: Gait, phi: number, vx: number): void {
  const a = Math.abs(phi) / DEG;
  const back = g.wantView === 'back' ? a <= FIGURE.sideOnDeg : a < FIGURE.backOnDeg;
  g.wantView = back ? 'back' : 'side';
  if (!back && a < 180 - FIGURE.backOnDeg) g.wantDir = Math.sign(vx) || g.wantDir;
}

/**
 * One frame of the gait from the ground velocity (m/s). Poses, views and the idle shift change only when the 12 fps
 * tick floor(t * 12) moves. Frozen time gives the pose for the heading and speed at once (idle or the first pose of the
 * view); reduced motion keeps one standing pose with no cycle, no turn and no shift.
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
    g.turn = 0;
    g.shift = 0;
    return;
  }
  if (!standing) g.travelled += speed * dt;
  const tick = Math.floor(t * FIGURE.fps);
  if (tick === g.tick) return;
  g.tick = tick;
  turnStep(g, reduced);
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
  return (g.view === 'side' ? SIDE_POSES : BACK_POSES)[g.pose]!;
}

/** The sole's height in a shin sprite: its padding as a share of the sprite's height. */
const padOf = (r: SpriteRect): number => r.pad / ((r.uv[3] - r.uv[1]) * FIGURE.pagePx);

/** One solved part: its rect, pivot (canonical figure plane, m), drawn size share, turn, width and height shares and mirroring. */
interface Sprite { rect: SpriteRect; px: number; py: number; size: number }
interface Part { sprite: Sprite; x: number; y: number; a: number; sx: number; sy: number; flip: boolean; tone: number }

/** Body parts (cook/FIGURE_BUILD.md 4). */
const S = { Torso: 0, Head: 1, Hat: 2, FreeArm: 3, FreeHand: 4, CarryArm: 5, CarryHand: 6, ThighA: 7, ShinA: 8, ThighB: 9, ShinB: 10 } as const;
/**
 * Back: every inner edge lies under a neighbour, so no paper rim splits the figure: each thigh over its shin (the knee),
 * the right leg under the left (the inseam), the fists under their cuffs, the sleeves under the smock, the nape under
 * the collar, the hat on top.
 */
const BACK_ORDER = [S.ShinB, S.ThighB, S.ShinA, S.ThighA, S.FreeHand, S.CarryHand, S.FreeArm, S.CarryArm, S.Head, S.Torso, S.Hat] as const;
/** Side: the far arm behind the body, the near (carrying) arm in front of it, each fist under its cuff. */
const SIDE_ORDER = [S.FreeHand, S.FreeArm, S.ShinA, S.ThighA, S.ShinB, S.ThighB, S.Head, S.Torso, S.Hat, S.CarryHand, S.CarryArm] as const;
/** Instance indices: the shadow, the eleven body parts in paint order, then (the visitor's) handle and lantern. */
export const SLOT = { shadow: 0, handle: 12, lantern: 13, count: 14 } as const;

export interface Puppet {
  /** The carrying hand's grip in world x, y (m), after place(). */
  readonly grip: Float32Array;
  /** The written quads by slot (tests read them back). */
  readonly quads: readonly QuadParams[];
  /**
   * Solves the figure for the gait at ground point (x, z), scale k, mirrored when `mirror` is -1; `carryDeg` turns the
   * carrying arm with the lantern's swing (world degrees, counter-clockwise).
   */
  place(g: Gait, x: number, z: number, k: number, mirror: number, carryDeg?: number): void;
  /** Writes the shadow and the body into their slots. */
  write(w: InstanceWriter): void;
}

export function createPuppet(rects: FigureRects): Puppet {
  const sprite = (id: keyof FigureRects, size = 1): Sprite => ({ rect: rects[id], px: PIVOTS[id][0], py: PIVOTS[id][1], size });
  const sprites = { thighL: sprite('fg/thigh-l'), shinL: sprite('fg/shin-l'), thighR: sprite('fg/thigh-r'), shinR: sprite('fg/shin-r') };
  const part = (id: keyof FigureRects, size = 1): Part => ({ sprite: sprite(id, size), x: 0, y: 0, a: 0, sx: 1, sy: 1, flip: false, tone: TONE.body });
  const parts: Part[] = [part('fg/torso'), part('fg/head', FIGURE.headK), part('fg/hat', FIGURE.hatK), part('fg/arm'), part('fg/hand'), part('fg/arm-bent'), part('fg/hand'),
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
    let lx = (f[0]! - r.px) * r.rect.size[0] * k * r.size * p.sx;
    if (p.flip) lx = -lx;
    const ly = (f[1]! - r.py) * r.rect.size[1] * k * r.size * p.sy;
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
  function place(g: Gait, x: number, z: number, scale: number, mirror: number, carryDeg = 0): void {
    k = scale;
    const p = poseOf(g);
    const side = g.view === 'side';
    const torsoW = TURN.torso[g.turn]! * (side ? FIGURE.sideTorso : 1);
    const armW = TURN.arm[g.turn]! * FIGURE.armSlim;
    const drop = FIGURE.armDropM * k;
    const torso = parts[S.Torso]!;
    /** Back: hips over the planted foot. */
    const sway = side ? 0 : Math.sign(p.footA - p.footB) * FIGURE.hipSwayM;
    set(torso, (g.shift * FIGURE.shiftM + sway) * k, restL * k - p.drop * k, p.torso + g.shift * FIGURE.shiftDeg, torsoW, 1, false);
    pinOf(torso, PINS.neck);
    const fwd = side ? 1 : 0;
    /** Hair and nape under the hat, from behind and in profile. */
    set(parts[S.Head]!, pin[0]! + fwd * FIGURE.headFwdM * k, pin[1]!, p.torso + p.head, 1, 1, false);
    pinOf(parts[S.Head]!, PINS.hatSeat);
    set(parts[S.Hat]!, pin[0]! + fwd * (FIGURE.hatFwdM - FIGURE.headFwdM) * k, pin[1]! + FIGURE.hatLiftM * k, p.torso + p.head, 1, 1, false);
    const freeArm = parts[S.FreeArm]!;
    const carryArm = parts[S.CarryArm]!;
    if (side) {
      pinOf(torso, PINS.sideShoulder);
      const sx = pin[0]!;
      const sy = pin[1]!;
      set(freeArm, sx, sy - drop, REST.sideFree + p.free, armW, p.freeH, false);
      set(carryArm, sx, sy - drop, REST.sideCarry + p.carry + mirror * carryDeg, armW, 1, false);
    } else {
      const outL = FIGURE.armOut * freeArm.sprite.rect.size[0] * k * armW;
      const outR = FIGURE.armOut * carryArm.sprite.rect.size[0] * k * armW;
      pinOf(torso, PINS.shoulderL);
      set(freeArm, pin[0]! - outL, pin[1]! - drop, REST.freeArm - p.free, armW, p.freeH, true);
      pinOf(torso, PINS.shoulderR);
      set(carryArm, pin[0]! + outR, pin[1]! - drop, REST.carryArm + p.carry + mirror * carryDeg, armW, 1, false);
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
      const hipIn = FIGURE.hipInM * k;
      pinOf(torso, PINS.hipL);
      leg(thighA, shinA, PINS.kneeL, pin[0]! + hipIn, pin[1]!, p.hipA, p.kneeA, p.footA * k, 1);
      pinOf(torso, PINS.hipR);
      leg(thighB, shinB, PINS.kneeR, pin[0]! - hipIn, pin[1]!, p.hipB, -p.kneeB, p.footB * k, rightBase);
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
    const { rect: r, px, py, size } = p.sprite;
    const flip = p.flip !== mirror < 0;
    q.x = x + mirror * p.x;
    q.y = p.y;
    q.z = z;
    q.rot = mirror * p.a;
    q.w = r.size[0] * k * size * p.sx;
    q.h = r.size[1] * k * size * p.sy;
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
