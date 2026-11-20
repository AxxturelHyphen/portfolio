import type { InstanceWriter, QuadParams, Tier } from '../types.ts';
import type { WorldMode } from './mode.ts';
import { PHASE_SPAN, QUAD_FLAG } from './quadflags.ts';

/**
 * Plants with body (cook/PLAN_3D.md F2): under the orbiting camera a single card shows its edge, so a filler plant
 * stands as more than one. Small plants fold along the plate's vertical midline into a shallow V that opens toward the
 * lens: both halves hang on the crease, sway together and never overlap on screen within the orbit, and neither turns
 * as a standee, so the crease holds. Tall flowers and
 * shrubs take a mirrored copy of the card crossed behind the first, turned toward the plate's rest yaw so its printed
 * face, never its blank back, shows from anywhere in the ±35° orbit (55° + 35° stays within the face's 90°). The copy
 * casts no second ground decal. Everything is decided per piece from its position, so a rebuild lays the same garden.
 * Only the lawn, the edging, the ground cover, the grass and the bed plants named here take a body; project flowers,
 * signs, pets, props and architecture stay single cards, and so does everything on the low tier.
 */

export type Body = 'fold' | 'cross';

/** Half the V's opening (radians), from the first to the last of a piece; the crossed card's turn off the plate. */
export const BODY = { fold: [0.38, 0.5], cross: [0.91, 1.01] } as const;
/** Below this yaw (radians) a plate counts as facing the lens and its crossed card turns either way by the seed. */
const FACING_LENS = 0.05;

const BODIES: Readonly<Record<string, Body>> = {
  'sh/clump-1': 'fold', 'sh/clump-2': 'fold', 'sh/clump-3': 'fold', 'sh/ivy': 'fold', 'sh/ivy-2': 'fold',
  'w/fiddle': 'fold', 'w/fungi': 'fold', 'w/fungi-2': 'fold', 'gr/fern-a': 'fold', 'gr/fern-b': 'fold',
  'w/buttercup': 'cross', 'w/poppy': 'cross', 'w/gallica': 'cross', 'w/cane': 'cross',
  'ro/comp-dark': 'cross', 'ro/comp-pompon': 'cross', 'ro/comp-white': 'cross', 'ro/hero-a': 'cross', 'ro/rose-b': 'cross',
  'sa/daisy': 'cross', 'se/physalis': 'cross', 'se/pod-b': 'cross', 'se/bud-b': 'cross',
  'se/hydroid-1': 'cross', 'se/hydroid-2': 'cross', 'se/hydroid-3': 'cross',
  'es/typha': 'cross', 'es/typha-blade-1': 'cross', 'es/typha-blade-2': 'cross', 'es/typha-blade-3': 'cross', 'es/papyrus': 'cross',
};

/** Bodies are built only where the camera orbits (free roam) and never on the low tier. */
export function takesBody(mode: WorldMode, tier: Tier): boolean {
  return mode === 'roam' && tier !== 'low';
}

/** The body a plate takes, or null: it stays one card. */
export function bodyOf(sprite: string): Body | null {
  return BODIES[sprite] ?? null;
}

/** Quads a piece of this body writes. */
export function bodyQuads(body: Body | null): number {
  return body === null ? 1 : 2;
}

/** A stable 0..1 per ground position: the piece's own fold depth, crossing turn and mirror. */
export function bodySeed(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

const half: number[] = [0, 0, 0, 0];
const lerp = (range: readonly [number, number], t: number): number => range[0] + (range[1] - range[0]) * t;

/** Writes `q` at `at` as its body and returns the quads written; `q` is left as it came. */
export function writeBody(w: InstanceWriter, at: number, q: QuadParams, body: Body | null, seed: number): number {
  if (body === 'cross') return cross(w, at, q, seed);
  if (body === 'fold') return fold(w, at, q, seed);
  w.set(at, q);
  return 1;
}

/** `phase` with `add` flags set and `clear` flags cleared. */
function reflag(phase: number, add: number, clear: number): number {
  const flags = Math.floor(phase / PHASE_SPAN);
  return phase + (((flags | add) & ~clear) - flags) * PHASE_SPAN;
}

/** The crossed copy first, so the plate itself is painted over it at rest. */
function cross(w: InstanceWriter, at: number, q: QuadParams, seed: number): number {
  const { facing, phase } = q;
  const width = q.w;
  const side = facing > FACING_LENS ? -1 : facing < -FACING_LENS ? 1 : seed < 0.5 ? -1 : 1;
  q.facing = facing + side * lerp(BODY.cross, seed);
  q.w = -width;
  q.phase = reflag(phase, QUAD_FLAG.noShadow, 0);
  w.set(at, q);
  q.facing = facing;
  q.w = width;
  q.phase = phase;
  w.set(at + 1, q);
  return 2;
}

/**
 * The two halves either side of the midline, each hinged on the crease's foot: the plate's foot moved along its width
 * and its in-plane rotation (the 8° lean back would move it by millimetres and is left out). The half on the -x side
 * turns its edge forward.
 */
function fold(w: InstanceWriter, at: number, q: QuadParams, seed: number): number {
  const { x, y, z, facing, px, rot, uv, phase } = q;
  const width = q.w;
  const u0 = uv[0] ?? 0;
  const u1 = uv[2] ?? 1;
  const crease = (0.5 - px) * width;
  const along = crease * Math.cos(rot);
  const turn = Math.sign(width) * lerp(BODY.fold, seed);
  q.x = x + along * Math.cos(facing);
  q.y = y + crease * Math.sin(rot);
  q.z = z - along * Math.sin(facing);
  q.w = width / 2;
  q.phase = reflag(phase, 0, QUAD_FLAG.turn);
  q.uv = half;
  half[1] = uv[1] ?? 0;
  half[3] = uv[3] ?? 1;
  half[0] = u0; half[2] = (u0 + u1) / 2;
  q.px = 1;
  q.facing = facing + turn;
  w.set(at, q);
  half[0] = (u0 + u1) / 2; half[2] = u1;
  q.px = 0;
  q.facing = facing - turn;
  w.set(at + 1, q);
  q.x = x; q.y = y; q.z = z;
  q.w = width;
  q.px = px;
  q.uv = uv;
  q.phase = phase;
  q.facing = facing;
  return 2;
}
