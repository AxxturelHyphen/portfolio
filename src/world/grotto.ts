import type { Annex } from './annex.ts';
import { rng } from './groundplan.ts';

/**
 * The grotto of free roam as a real rock chamber behind the back wall (gl/grotto.ts builds it). The back wall has a gap
 * at the grotto's mouth (garden.json enclosure.low), framed by rock jambs under a rock lintel; behind it a faceted rock
 * dome stands on a rock floor that runs on from the lawn, low at the back with a few stalactites, and the visitor walks
 * in through the mouth (annex.ts) with the lantern. Pure data: units are metres in world coordinates.
 */

/** The dome's ellipsoid: centre and semi-axes; its faces south of `front` are dropped (they are buried in the wall). */
export const DOME = { x: 33.5, y: -0.3, z: -7.1, rx: 2.5, ry: 2.6, rz: 3.9, front: -6.3 } as const;

export const GROTTO = {
  /** The gap in the back wall (garden.json enclosure.low). */
  mouth: [32.5, 34.5],
  /** The wall line and its thickness (world/enclosure.ts THICK): the jambs and the lintel straddle it. */
  wallZ: -6,
  thick: 0.45,
  /** The rock floor's rectangle: from the wall's face north past the dome. */
  floor: { x0: 30.8, x1: 36.2, z0: -11.2, z1: -6 },
  /** Where an assisted walk or a deep link sets the visitor down in the grotto. */
  stand: [33.5, -8.5],
  /** The puddle in its hollow of the floor (the bed's flat pool card lies in it): centre and radius. */
  puddle: { x: 34.45, z: -9.05, r: 0.34 },
  /** The visitor is in the grotto north of `enter` and stays in it until south of `leave` (z). */
  enter: -6.8,
  leave: -6.2,
} as const;

/** The doorway through the mouth and the chamber the body may stand in (annex.ts): corridor, then chamber. */
export const GROTTO_ANNEX: Annex = {
  rooms: new Float32Array([32.95, -7.7, 34.05, -4.5, 31.8, -9.6, 35.2, -6.75]),
  door: { x: 33.5, z: -6.2, band: 0.2 },
  porchZ: -5,
  innerZ: -7.4,
};

/**
 * Solid things on the grotto floor the visitor walks round, as prop boxes x0, z0, x1, z1 (occluders.ts propBlocks
 * layout): the flytrap's root.
 */
export const GROTTO_BLOCKS = new Float32Array([33.8, -8.15, 34.12, -7.75]);

/** True while the visitor at (x, z) is in the grotto; `was` keeps it in until it walks back out past the mouth. */
export function inGrotto(x: number, z: number, was: boolean): boolean {
  const [x0, x1] = GROTTO.mouth;
  if (x < x0 - 1.5 || x > x1 + 1.5) return false;
  return z < (was ? GROTTO.leave : GROTTO.enter);
}

/** The dome's inner surface height over (x, z), or 0 outside its footprint. */
export function ceilingY(x: number, z: number): number {
  const u = (x - DOME.x) / DOME.rx;
  const w = (z - DOME.z) / DOME.rz;
  const q = 1 - u * u - w * w;
  return q <= 0 ? 0 : DOME.y + DOME.ry * Math.sqrt(q);
}

/** A rock: an ellipsoid boulder or a downward cone (stalactite), centre (or root), semi-axes (or radius and length), yaw. */
export interface Rock { kind: 'boulder' | 'stalactite'; x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number }

/** The jamb stacks either side of the mouth and the lintel over it, straddling the wall (y is each boulder's centre). */
function mouthRocks(out: Rock[]): void {
  const z = GROTTO.wallZ - GROTTO.thick / 2;
  const [x0, x1] = GROTTO.mouth;
  const stack: readonly (readonly [number, number, number])[] = [[0.45, 0.42, 0.5], [1.25, 0.4, 0.45], [1.95, 0.38, 0.4]];
  for (const [side, x] of [[-1, x0 + 0.05], [1, x1 - 0.05]] as const) {
    for (const [y, sx, sy] of stack) out.push({ kind: 'boulder', x: x - side * 0.02, y, z, sx, sy, sz: 0.42, yaw: side * 0.4 + y });
  }
  out.push({ kind: 'boulder', x: x0 + 0.35, y: 2.72, z, sx: 0.55, sy: 0.42, sz: 0.44, yaw: 0.3 });
  out.push({ kind: 'boulder', x: (x0 + x1) / 2, y: 2.82, z, sx: 0.5, sy: 0.45, sz: 0.46, yaw: 1.2 });
  out.push({ kind: 'boulder', x: x1 - 0.35, y: 2.7, z, sx: 0.55, sy: 0.43, sz: 0.44, yaw: 2.1 });
  // The wall's cut ends under the coping, buried in a rock either side that rises a little over the wall top.
  out.push({ kind: 'boulder', x: x0 - 0.05, y: 3.08, z, sx: 0.36, sy: 0.34, sz: 0.4, yaw: 0.8 });
  out.push({ kind: 'boulder', x: x1 + 0.05, y: 3.05, z, sx: 0.36, sy: 0.32, sz: 0.4, yaw: 2.6 });
}

/** Boulders at the dome's foot round the chamber, kept off the walk rectangle, and pebbles round the puddle. */
function floorRocks(out: Rock[], count: number, seed: number): void {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const a = Math.PI * (0.1 + (0.8 * (i + rand() * 0.6)) / count) + Math.PI;
    const s = 0.18 + rand() * 0.26;
    const k = 0.97 - s / DOME.rx / 2;
    out.push({ kind: 'boulder', x: DOME.x + Math.cos(a) * DOME.rx * k, y: s * 0.35, z: DOME.z + Math.sin(a) * DOME.rz * k, sx: s, sy: s * 0.8, sz: s * 0.9, yaw: rand() * 6 });
  }
  const p = GROTTO.puddle;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rand() * 0.4;
    const s = 0.05 + rand() * 0.05;
    out.push({ kind: 'boulder', x: p.x + Math.cos(a) * (p.r + s * 0.4), y: s * 0.3, z: p.z + Math.sin(a) * (p.r * 0.8 + s * 0.4), sx: s, sy: s * 0.7, sz: s, yaw: rand() * 6 });
  }
}

/** Stalactite roots (x, z) and lengths: under the low back of the dome and its sides, clear of the visitor's head. */
const STALACTITES: readonly (readonly [number, number, number])[] = [
  [33.6, -9.3, 0.42], [32.5, -9.7, 0.36], [34.6, -9.8, 0.4], [33.1, -10.3, 0.3], [34.1, -10.4, 0.26],
  [31.9, -7.6, 0.3], [35.15, -7.9, 0.28], [32.3, -8.6, 0.24], [34.9, -8.6, 0.28],
];

/** Every rock of the grotto; the low tier keeps fewer boulders at the foot and fewer stalactites. */
export function grottoRocks(low: boolean): Rock[] {
  const out: Rock[] = [];
  mouthRocks(out);
  floorRocks(out, low ? 6 : 11, 7);
  const rand = rng(11);
  for (const [x, z, len] of STALACTITES.slice(0, low ? 5 : STALACTITES.length)) {
    out.push({ kind: 'stalactite', x, y: ceilingY(x, z) + 0.06, z, sx: 0.07 + rand() * 0.05, sy: len, sz: 0, yaw: rand() * 6 });
  }
  return out;
}
