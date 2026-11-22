import type { Tier } from '../types.ts';
import { THICK } from './enclosure.ts';
import { clearOf, pathDistance } from './groundplan.ts';
import type { GroundData } from './layout.ts';
import { hash01 } from './wall.ts';

/**
 * Where the free-roam lawn's low nap of grass stands (gl/grass.ts builds the blades): a tuft per cell of a jittered
 * grid over the closed garden, kept by a fixed hash against the ground's weight there. The weight is nil off the
 * lawn: on the path, its stones and the bank kerb (PATH.clear from the centre line, the grotto's spur too), in the pond
 * and on its rim, in puddles, inside the walls' feet and piers, in solid props' boxes; it is thin in the soil beds north
 * of the path and toward the front kerb, full on the foreground lawn south of the path. The same hash decides every
 * tier, so a lower tier keeps a subset. Pure, load time only.
 */

/** Floats per tuft: x, z, and the cell's index (the seed of its blades). */
export const TUFT = 3;
/** Grid cell (m), the margin kept inside the walls' faces (piers and base courses stand proud of them, m). */
const CELL = 0.27;
const WALL_MARGIN = 0.28;
/** How far a tuft's blades may stand from its centre (m); gl/grass.ts keeps to it. */
export const TUFT_SPREAD = 0.06;
/** Path distance (m) inside which no tuft stands and from which the lawn is full. */
export const PATH_CLEAR = { clear: 0.8, full: 1.2 } as const;
/** The beds' soil north of the path (z where it starts and is full, as the ground shader paints it) keeps this share. */
const SOIL = { z: [-0.9, -1.7], keep: 0.12 } as const;
/** Toward the front kerb, out of the walking camera's foreground (z where it thins and how much is left). */
const FRONT = { z: [5.8, 7.4], keep: 0.25 } as const;
/**
 * The nap grows in drifts: a smooth noise on a lattice of `m` metres keeps the tufts where it passes `from` and gathers
 * them where it reaches `full`, leaving `bare` of them between, so the grass reads as patches of a lawn, not a sprinkle.
 */
const DRIFT = { m: 1.7, from: 0.34, full: 0.6, bare: 0.05 } as const;
/** A prop's box grows by this much (m) on every side. */
const PROP_MARGIN = 0.06;
/** The share of the tufts each tier keeps: the low tier about a third, in the same draw. */
const SHARE: Readonly<Record<Tier, number>> = { high: 1, mid: 0.6, low: 0.34 };
const SALT = { x: 0x6a1, z: 0x6a2, keep: 0x6a3, drift: 0x6a4 } as const;

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function inBox(boxes: Float32Array, x: number, z: number): boolean {
  for (let i = 0; i + 4 <= boxes.length; i += 4) {
    if (x > boxes[i]! - PROP_MARGIN && x < boxes[i + 2]! + PROP_MARGIN && z > boxes[i + 1]! - PROP_MARGIN && z < boxes[i + 3]! + PROP_MARGIN) return true;
  }
  return false;
}

const lattice = (i: number, j: number): number => hash01(Math.imul(i, 0x9e37) ^ j, SALT.drift);

/** Value noise 0..1 over the lattice of DRIFT.m metres. */
function drift(x: number, z: number): number {
  const u = x / DRIFT.m;
  const v = z / DRIFT.m;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const a = smooth(0, 1, u - i);
  const b = smooth(0, 1, v - j);
  const top = lattice(i, j) + (lattice(i + 1, j) - lattice(i, j)) * a;
  const bottom = lattice(i, j + 1) + (lattice(i + 1, j + 1) - lattice(i, j + 1)) * a;
  return top + (bottom - top) * b;
}

/** The lawn's weight for grass at (x, z): 0 off the lawn, up to 1 in a drift on the foreground lawn. */
function grassWeight(g: GroundData, props: Float32Array, x: number, z: number): number {
  if (!clearOf(g, x, z) || inBox(props, x, z)) return 0;
  const pd = Math.min(pathDistance(g.path.points, x, z), pathDistance(g.path.spur, x, z));
  if (pd <= PATH_CLEAR.clear) return 0;
  const soil = 1 - (1 - SOIL.keep) * smooth(SOIL.z[0], SOIL.z[1], z);
  const front = 1 - (1 - FRONT.keep) * smooth(FRONT.z[0], FRONT.z[1], z);
  const patch = DRIFT.bare + (1 - DRIFT.bare) * smooth(DRIFT.from, DRIFT.full, drift(x, z));
  return smooth(PATH_CLEAR.clear, PATH_CLEAR.full, pd) * soil * front * patch;
}

/** The tufts of the closed garden for a tier, TUFT floats each; `props` are the solid props' boxes (x0, z0, x1, z1). */
export function grassTufts(g: GroundData, props: Float32Array, tier: Tier): Float32Array {
  const e = g.enclosure;
  const x0 = e.x[0] + WALL_MARGIN;
  const z0 = g.wall.z + WALL_MARGIN;
  const cols = Math.floor((e.x[1] - WALL_MARGIN - x0) / CELL);
  const rows = Math.floor((e.front - THICK - WALL_MARGIN - z0) / CELL);
  const out: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const x = x0 + (i + hash01(k, SALT.x)) * CELL;
      const z = z0 + (j + hash01(k, SALT.z)) * CELL;
      if (hash01(k, SALT.keep) < grassWeight(g, props, x, z) * SHARE[tier]) out.push(x, z, k);
    }
  }
  return new Float32Array(out);
}
