/**
 * The visitor's figure (cook/FIGURE_BUILD.md 4): a paper-cut puppet from the roam atlas, pinned part to part like a toy
 * theatre figure, who carries the lantern by its handle. The gait (world/puppet.gait.ts) advances on the 12 fps tick by
 * distance walked (one pose per stride share, at most one per tick), so the feet change only on steps. Two views: back
 * (walking away, standing) and side (walking east or west, mirrored for west); walking south toward the lens keeps the
 * side of the last sideways movement, a figure carried downstage in profile. A view change is a turn over three ticks
 * (a quarter second): the old view narrows, the new one shows edge-on, then opens out, like a cutout being turned by
 * hand. Over the pose lie the gait's weight and life: the torso leans and breathes, the head glances, the carrying arm
 * lifts the lantern. The hierarchy is solved on the CPU into preallocated quads, re-grounded so the lowest sole always stands on the ground
 * plane. Nothing is allocated per frame.
 */
import type { InstanceWriter, QuadParams, SpriteRect } from '../types.ts';
import { DIP, GAIT, LIFE, poseOf, TURN, type Gait } from './puppet.gait.ts';
import { PINS, PIVOTS, REST, type FigureRects } from './puppet.poses.ts';
import { QUAD_FLAG, packPhase } from './quadflags.ts';

export const FIGURE = {
  ...GAIT,
  /** Head top above the ground point (m) at scale 1, drawn at portraitK on portrait screens. */
  topM: 1.3, portraitK: 1.2 / 1.3,
  /** Standing: hips sway over the planted foot; shins stretch by `stretch`. */
  hipSwayM: 0.014, stretch: 0.15,
  /**
   * Width share of the side torso; back view: each sleeve hangs armOut of its width out from its shoulder pin, beside
   * the smock and under its edge, armSlim wide (slim sleeves, not puffed panels), armDropM (m) under the smock's sloped
   * shoulder. The smock is drawn torsoW of its cut width; the carrying sleeve carryH of its length (the forearm comes
   * forward to hold the lantern at the hip).
   */
  sideTorso: 0.78, armOut: 0.24, armSlim: 0.8, armDropM: 0.035, torsoW: 0.92, carryH: 0.86,
  /** Drawn size of the bare head against its sprite, and its lift above the neck pin (m): a neck shows under the hair. */
  headK: 1.19, headLiftM: 0.03,
  /** Side view: head shifted toward the heading, hips either side of the hip centre; back: hips drawn in by hipInM (m). */
  headFwdM: 0.02, hipM: 0.012, hipInM: 0.01,
  /**
   * Contact shadow: carrier width (the shader spreads it 1.5 x 0.9) and opacity (the lantern lights the ground). The
   * carrier's paper is the lantern's halo, a soft warm disc of that size round the flame.
   */
  shadowW: 0.46, shadowA: 1,
  /** Atlas page side in px: the sole sits `pad` px above a shin quad's bottom edge. */
  pagePx: 512,
} as const;

export { FIGURE_SPRITES, PINS, PIVOTS, type FigureRects } from './puppet.poses.ts';
export { createGait, poseOf, stepGait, type Gait, type View } from './puppet.gait.ts';

const DEG = Math.PI / 180;
/**
 * Paper tones on the plates' own tint, both above the shader's shaded-layer luma (0.75), so the inner edges take no
 * cool moon rim: the figure is held down by the actor batch's share of the lantern light instead. The far leg and the
 * fists a step darker.
 */
const TONES = [[0.8, 0.79, 0.78], [0.776, 0.766, 0.757]] as const;
/** The smock and sleeves in work blue: under the amber lantern they go slate, never the tan of bare skin (luma ~0.73). */
const CLOTH = [[0.62, 0.74, 1], [0.6, 0.72, 0.97]] as const;
/** The sole's height in a shin sprite: its padding as a share of the sprite's height. */
const padOf = (r: SpriteRect): number => r.pad / ((r.uv[3] - r.uv[1]) * FIGURE.pagePx);

/** One solved part: its rect, pivot (canonical figure plane, m), drawn size share, turn, width and height shares and mirroring. */
interface Sprite { rect: SpriteRect; px: number; py: number; size: number }
interface Part { sprite: Sprite; x: number; y: number; a: number; sx: number; sy: number; flip: boolean; far: boolean; cloth: boolean }

/** Body parts (cook/FIGURE_BUILD.md 4). */
const S = { Torso: 0, Head: 1, Scarf: 2, FreeArm: 3, FreeHand: 4, CarryArm: 5, CarryHand: 6, ThighA: 7, ShinA: 8, ThighB: 9, ShinB: 10 } as const;
/**
 * Back: every inner edge lies under a neighbour, so no paper rim splits the figure: each thigh over its shin (the knee),
 * the right leg under the left (the inseam), the fists under their cuffs, the sleeves under the smock, the nape under
 * the collar, the neckerchief on top.
 */
const BACK_ORDER = [S.ShinB, S.ThighB, S.ShinA, S.ThighA, S.FreeHand, S.CarryHand, S.FreeArm, S.CarryArm, S.Head, S.Torso, S.Scarf] as const;
/** Side: the far arm behind the body, the near (carrying) arm in front of it, each fist under its cuff. */
const SIDE_ORDER = [S.FreeHand, S.FreeArm, S.ShinA, S.ThighA, S.ShinB, S.ThighB, S.Head, S.Torso, S.Scarf, S.CarryHand, S.CarryArm] as const;
/** Instance indices: the shadow and halo, the eleven body parts in paint order, then (the visitor's) handle and lantern. */
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
  /**
   * Centres the halo on the flame at world (x, y), after place(): the carrier's quad keeps its foot at the ground point,
   * so its shadow stays under the soles, and its paper is shifted by the pivot.
   */
  halo(x: number, y: number): void;
  /** Writes the shadow and the body into their slots. */
  write(w: InstanceWriter): void;
}

export function createPuppet(rects: FigureRects): Puppet {
  const sprite = (id: keyof FigureRects, size = 1): Sprite => ({ rect: rects[id], px: PIVOTS[id][0], py: PIVOTS[id][1], size });
  const sprites = { thighL: sprite('fg/thigh-l'), shinL: sprite('fg/shin-l'), thighR: sprite('fg/thigh-r'), shinR: sprite('fg/shin-r') };
  const part = (id: keyof FigureRects, size = 1): Part => ({ sprite: sprite(id, size), x: 0, y: 0, a: 0, sx: 1, sy: 1, flip: false, far: false,
    cloth: id === 'fg/torso' || id === 'fg/arm' || id === 'fg/arm-bent' });
  const parts: Part[] = [part('fg/torso'), part('fg/head', FIGURE.headK), part('fg/scarf'), part('fg/arm'), part('fg/hand'), part('fg/arm-bent'),
    part('fg/hand'), part('fg/thigh-l'), part('fg/shin-l'), part('fg/thigh-r'), part('fg/shin-r')];
  const flags = packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.noShadow);
  const quads: QuadParams[] = [];
  for (let i = 0; i < SLOT.count; i++) {
    quads.push({ x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0.5, py: 0, uv: new Float32Array(4), sway: 0, lift: 0, facing: 0,
      tint: new Float32Array([1, 1, 1, 1]), phase: flags });
  }
  const shadow = quads[SLOT.shadow]!;
  shadow.uv = rects['fg/glow'].uv;
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
    p.x = x; p.y = y; p.a = deg * DEG; p.sx = sx; p.sy = sy; p.flip = flip; p.far = false;
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
    h.far = true;
  }
  function place(g: Gait, x: number, z: number, scale: number, mirror: number, carryDeg = 0): void {
    k = scale;
    const p = poseOf(g);
    const side = g.view === 'side';
    const torsoW = TURN.torso[g.turn]! * (side ? FIGURE.sideTorso : 1) * FIGURE.torsoW;
    const armW = TURN.arm[g.turn]! * FIGURE.armSlim;
    const armDrop = FIGURE.armDropM * k;
    const lift = g.lift * LIFE.liftDeg;
    const torso = parts[S.Torso]!;
    /** Back: hips over the planted foot. Leaning toward the heading in profile; from behind, banked toward world +x. */
    const sway = side ? 0 : Math.sign(p.footA - p.footB) * FIGURE.hipSwayM;
    const lean = side ? -g.lean : -g.bank * mirror;
    const drop = (p.drop + DIP[g.dip]!) * k;
    set(torso, (g.shift * FIGURE.shiftM + sway) * k, restL * k - drop, p.torso + g.shift * FIGURE.shiftDeg + lean, torsoW,
      1 + g.breath * LIFE.breathK, false);
    pinOf(torso, PINS.neck);
    const fwd = side ? 1 : 0;
    /**
     * The neckerchief on the smock's collar, the bare head above it on its neck, from behind and in profile; the head
     * takes half the lean and, glancing, turns on its pin toward the look.
     */
    const look = side ? 0 : g.look;
    set(parts[S.Scarf]!, pin[0]!, pin[1]!, torso.a / DEG, torsoW, 1, false);
    set(parts[S.Head]!, pin[0]! + (fwd * FIGURE.headFwdM + look * LIFE.lookM) * k, pin[1]! + FIGURE.headLiftM * k,
      p.torso + p.head + lean * 0.5 - look * LIFE.lookDeg, 1 - Math.abs(look) * LIFE.lookNarrow, 1, false);
    const freeArm = parts[S.FreeArm]!;
    const carryArm = parts[S.CarryArm]!;
    if (side) {
      pinOf(torso, PINS.sideShoulder);
      const sx = pin[0]!;
      const sy = pin[1]!;
      set(freeArm, sx, sy - armDrop, REST.sideFree + p.free, armW, p.freeH, false);
      set(carryArm, sx, sy - armDrop, REST.sideCarry + p.carry + lift + mirror * carryDeg, armW, FIGURE.carryH, false);
    } else {
      const outL = FIGURE.armOut * freeArm.sprite.rect.size[0] * k * armW;
      const outR = FIGURE.armOut * carryArm.sprite.rect.size[0] * k * armW;
      pinOf(torso, PINS.shoulderL);
      set(freeArm, pin[0]! - outL, pin[1]! - armDrop, REST.freeArm - p.free, armW, p.freeH, true);
      pinOf(torso, PINS.shoulderR);
      set(carryArm, pin[0]! + outR, pin[1]! - armDrop, REST.carryArm + p.carry + lift + mirror * carryDeg, armW, FIGURE.carryH, false);
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
      thighA.far = true;
      shinA.far = true;
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
    (q.tint as Float32Array).set((p.cloth ? CLOTH : TONES)[p.far ? 1 : 0]);
  }

  return {
    grip,
    quads,
    place,
    halo(fx, fy) {
      shadow.px = 0.5 - (fx - shadow.x) / shadow.w;
      shadow.y = fy - shadow.h * 0.5;
    },
    write(w) {
      w.set(SLOT.shadow, shadow);
      for (let i = 1; i < SLOT.handle; i++) w.set(i, quads[i]!);
    },
  };
}
