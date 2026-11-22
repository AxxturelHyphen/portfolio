import type { BedId, Lang } from '../types.ts';
import { DOME } from './grotto.ts';
import type { BedScene3 } from './layout.ts';

/**
 * What the garden says in chalk, and where (gl/chalk.ts draws it, garden/chalk.drive.ts shows it). Chalk is kept for
 * the cat and for the grotto's own room: everything else is named by the plain tag and the panels. The cat's note lies
 * on the bare soil in front of the bench, its arrow aimed at the cat; in the grotto two notes on the back rock say what
 * to do there (the ring that kicks the ball, and the goal's reward). Every mark is fixed: its place and its arrow are pure data, and every
 * mark is written square to the garden (+x along its lines), never turned toward the visitor or the lens. Ground marks
 * lie flat with their top away from the lens (-z); rock marks are bent over the grotto's
 * back rock, facing south. Metres in world coordinates.
 */

/** Marks the chalk mesh can hold (its uMarks entries, gl/chalk.ts). */
export const MAX_MARKS = 4;

export type ChalkGroup = 'cat' | 'grotto';
export type ChalkDevice = 'keys' | 'touch';

export interface ChalkMark {
  readonly id: string;
  readonly group: ChalkGroup;
  readonly text: string;
  /** The mark's centre; y is its height on the rock (ground marks follow the terrain). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly surface: 'ground' | 'rock';
  /** Height of an ascender over the baseline (m). */
  readonly cap: number;
  /** Linear albedo of the chalk: an off-white, a dusty rose or a sage. */
  readonly tint: readonly [number, number, number];
  /** Shown while the visitor is within this distance (m). */
  readonly near: number;
}

/** Chalk colours: dusty white, a dusty rose and a sage, all well under paper white so the lamps cannot make them glow. */
export const CHALK_TINT = {
  white: [0.92, 0.9, 0.84],
  rose: [0.94, 0.72, 0.7],
  sage: [0.74, 0.86, 0.7],
} as const;

type Words = Readonly<Record<'cat' | 'push' | 'goal', string>>;
const WORDS: Readonly<Record<Lang, Readonly<Record<ChalkDevice, Words>>>> = {
  en: {
    keys: { cat: '↑\ncat', push: 'click the ring\n↓', goal: 'a goal makes\nthe moth dance' },
    touch: { cat: '↑\ncat', push: 'tap the ring\n↓', goal: 'a goal makes\nthe moth dance' },
  },
  es: {
    keys: { cat: '↑\ngato', push: 'clic en el aro\n↓', goal: 'un gol hace\nbailar a la polilla' },
    touch: { cat: '↑\ngato', push: 'toca el aro\n↓', goal: 'un gol hace\nbailar a la polilla' },
  },
};

/**
 * The cat note: offset from the cat (m: x right, z toward the lens) onto the bare soil just past the path, straight in
 * front of the bench so its arrow points up across the path at the cat; its cap height and reach (m).
 */
const CAT_NOTE = { dx: 0.35, dz: 2.3, cap: 0.3, near: 8 } as const;
/**
 * The grotto notes on the back rock: x and height (m) of their middles; gl/chalk.ts bends each over the dome (rockZ),
 * ROCK_INSET_M inside its ellipsoid so the rock's flat facets never cover it. "click the ring" stands over the game's
 * ring (gruta.ts, before the coupé), the goal's reward to its left, clear of the coupé; their cap height and reach.
 */
const GROTTO_NOTES = [['push', 33.65, 1.8], ['goal', 31.7, 1.75]] as const;
const ROCK_INSET_M = 0.42;
const GROTTO_CAP = 0.17;
const GROTTO_NEAR = 6;

/** The dome's back face at (x, y): the z where a rock mark's point there lies, ROCK_INSET_M in front of the rock. */
export function rockZ(x: number, y: number): number {
  const k = 1 - ((x - DOME.x) / DOME.rx) ** 2 - ((y - DOME.y) / DOME.ry) ** 2;
  return DOME.z - DOME.rz * Math.sqrt(Math.max(0, k)) + ROCK_INSET_M;
}

export interface ChalkInput {
  scenes: Readonly<Record<BedId, BedScene3>>;
  device: ChalkDevice;
  lang: Lang;
}

/** Every chalk mark for this language and device. */
export function chalkMarks(d: ChalkInput): ChalkMark[] {
  const w = WORDS[d.lang][d.device];
  const marks: ChalkMark[] = [];
  const cat = d.scenes.rosaleda.slots.find((s) => s.kind === 'pet');
  if (cat !== undefined) {
    marks.push({ id: 'cat', group: 'cat', text: w.cat, x: cat.x + CAT_NOTE.dx, y: 0, z: cat.z + CAT_NOTE.dz, surface: 'ground',
      cap: CAT_NOTE.cap, tint: CHALK_TINT.white, near: CAT_NOTE.near });
  }
  for (const [key, x, y] of GROTTO_NOTES) {
    marks.push({ id: `grotto/${key}`, group: 'grotto', text: w[key], x, y, z: rockZ(x, y), surface: 'rock', cap: GROTTO_CAP,
      tint: key === 'push' ? CHALK_TINT.white : CHALK_TINT.sage, near: GROTTO_NEAR });
  }
  return marks;
}
