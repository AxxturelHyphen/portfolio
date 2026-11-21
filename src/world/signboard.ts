/**
 * Free roam's signposts as objects in the world (cook/ART.md section 4): at each sign spot a wooden post with an arm
 * (real timber, gl/signwood.ts), a painted plank hung from the arm on a bridle and a small lantern hung at the arm's
 * tip, past the plank's outer end. The arm, plank and lantern reach the way the sign points (dir). The plank's painted
 * face and the lantern are cards facing the follow camera's fixed yaw (+z); the plank's wooden body stands just behind
 * its face. Pure layout: the parts' sizes and places in metres, the cards' rects in the painted atlas
 * (world/signboard.paint.ts) and the quads the cutout batch draws. No allocation per frame.
 */
import type { QuadParams } from '../types.ts';
import { QUAD_FLAG, packPhase } from './quadflags.ts';

/** Atlas texels per metre of each part, and the atlas side (px). */
export const ATLAS = { side: 1024, plankPxM: 300, lanternPxM: 333 } as const;

/**
 * Metres, for a sign pointing +x from its post foot. Post: width and height. Arm: its reach either side of the
 * post, the height of the beam's underside, the rise from the brace's foot on the post to the beam's top and the
 * beam's depth.
 * Plank sprite: board size, bridle height and the transparent margin round the cut edge; its hook sits on the arm at
 * `hookAt`. Lantern sprite size, its hook at `at` along the arm and the flame's share of its height. The plank and
 * lantern stand a little nearer the lens than the post (`front`). The post stands tall enough that the board
 * hangs over the visitor's head (1.4 m).
 */
export const BOARD = {
  post: { w: 0.15, h: 2.3 },
  arm: { from: -0.045, to: 1.57, under: 2.04, h: 0.27, beam: 0.07 },
  plank: { w: 1.26, h: 0.42, bridle: 0.15, margin: 0.03, hookAt: 0.76 },
  lantern: { w: 0.18, h: 0.315, at: 1.47, flame: 0.45 },
  front: { plank: 0.03, lantern: 0.045 },
} as const;

/** One sign standing at a spot: the post foot (x, z) and the way it points. */
export interface SignSpot { x: number; z: number; dir: -1 | 1 }

/** Quads per sign, in paint order: plank, lantern. */
export const PARTS = 2;
export const PLANK_PART = 0;

/** The plank sprite's whole size (m): the board, its bridle and the margins. */
export const PLANK_SPRITE = {
  w: BOARD.plank.w + 2 * BOARD.plank.margin,
  h: BOARD.plank.h + BOARD.plank.bridle + 2 * BOARD.plank.margin,
} as const;

/** The board's centre (the DOM button's place) of a sign at a spot, written to out [x, y, z]. */
export function plankCentre(s: Readonly<SignSpot>, out: [number, number, number]): [number, number, number] {
  out[0] = s.x + s.dir * BOARD.plank.hookAt;
  out[1] = BOARD.arm.under - BOARD.plank.bridle - BOARD.plank.h / 2;
  out[2] = s.z + BOARD.front.plank;
  return out;
}

/** The lantern's flame in the plank sprite's own frame (0..1 across from its left edge, 0..1 up from its foot). */
export function flameInPlank(dir: -1 | 1, out: Float32Array): Float32Array {
  const left = BOARD.plank.hookAt - PLANK_SPRITE.w / 2;
  const across = (BOARD.lantern.at - left) / PLANK_SPRITE.w;
  const foot = BOARD.arm.under + BOARD.plank.margin - PLANK_SPRITE.h;
  const flameY = BOARD.arm.under - BOARD.lantern.h + BOARD.lantern.h * BOARD.lantern.flame;
  out[0] = dir > 0 ? across : 1 - across;
  out[1] = (flameY - foot) / PLANK_SPRITE.h;
  return out;
}

/** Atlas rects (px from the top left: x, y, w, h). Planks fill two columns of five rows; the lantern the last slot. */
export interface AtlasRect { x: number; y: number; w: number; h: number }

const SLOT = { w: 400, h: 200, cols: 2, rows: 5 } as const;
export const MAX_SIGNS = SLOT.cols * SLOT.rows - 1;

export const plankRect = (i: number): AtlasRect => ({
  x: (i % SLOT.cols) * SLOT.w,
  y: Math.floor(i / SLOT.cols) * SLOT.h,
  w: Math.round(PLANK_SPRITE.w * ATLAS.plankPxM),
  h: Math.round(PLANK_SPRITE.h * ATLAS.plankPxM),
});

const LAST = { x: (SLOT.cols - 1) * SLOT.w, y: (SLOT.rows - 1) * SLOT.h } as const;
export const LANTERN_RECT: AtlasRect = {
  x: LAST.x, y: LAST.y, w: Math.round(BOARD.lantern.w * ATLAS.lanternPxM), h: Math.round(BOARD.lantern.h * ATLAS.lanternPxM),
};

/** A rect's uv (u0, v0, u1, v1; v up from the page bottom, cook/DOCS.md), mirrored across when `flip`. */
export function uvOf(r: Readonly<AtlasRect>, flip: boolean, out: Float32Array): Float32Array {
  const s = ATLAS.side;
  const u0 = r.x / s;
  const u1 = (r.x + r.w) / s;
  out[0] = flip ? u1 : u0;
  out[1] = 1 - (r.y + r.h) / s;
  out[2] = flip ? u0 : u1;
  out[3] = 1 - r.y / s;
  return out;
}

const HUNG = packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.noShadow);
const LAMP = packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.hung);

const quad = (): QuadParams => ({
  x: 0, y: 0, z: 0, rot: 0, w: 1, h: 1, px: 0.5, py: 0, uv: new Float32Array(4), sway: 0, phase: 0, lift: 0, facing: 0, tint: new Float32Array([1, 1, 1, 1]),
});

/** The two cards of one sign, built once; the plank's rot and tint are what the frame code changes. */
export interface SignQuads { plank: QuadParams; lantern: QuadParams }

export function signQuads(s: Readonly<SignSpot>, plankAt: number): SignQuads {
  const flip = s.dir < 0;
  const plank = quad();
  plank.x = s.x + s.dir * BOARD.plank.hookAt;
  plank.y = BOARD.arm.under;
  plank.z = s.z + BOARD.front.plank;
  plank.w = PLANK_SPRITE.w;
  plank.h = PLANK_SPRITE.h;
  plank.py = 1 - BOARD.plank.margin / PLANK_SPRITE.h;
  plank.phase = HUNG;
  uvOf(plankRect(plankAt), false, plank.uv as Float32Array);

  const lantern = quad();
  lantern.x = s.x + s.dir * BOARD.lantern.at;
  lantern.y = BOARD.arm.under - BOARD.lantern.h;
  lantern.z = s.z + BOARD.front.lantern;
  lantern.w = BOARD.lantern.w;
  lantern.h = BOARD.lantern.h;
  lantern.phase = LAMP;
  uvOf(LANTERN_RECT, flip, lantern.uv as Float32Array);
  return { plank, lantern };
}
