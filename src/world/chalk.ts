import { projectsOf } from '../content/load.ts';
import type { BedId, Content, Lang } from '../types.ts';
import type { BedScene3, WorldLayout } from './layout.ts';
import { pathZ } from './roam.ts';
import { bindSlots } from './scene.ts';

/**
 * What the garden says in chalk, and where (gl/chalk.ts draws it, garden/chalk.drive.ts shows it): a note across the
 * path from the bench pointing at the cat; on a first visit the controls just inside the gate where the visitor starts,
 * and "Enter / Open" pointing at the first flower; each project's name in front of its flower; "CV" pointing at the
 * Salida doorway with an arrow into it; an arrow on the wall beside the grotto's mouth and one on the soil before it.
 * Chalk keeps to the bare soil and the walls: pale slabs swallow pale chalk. Ground marks
 * lie flat, read from the follow camera (their top away from the lens) and may turn to point their arrow at what they
 * name; wall marks stand on the wall's face. Pure data, metres in world coordinates.
 */

/** Marks the chalk mesh can hold (its uMarks entries, gl/chalk.ts). */
export const MAX_MARKS = 24;

export type ChalkGroup = 'cat' | 'first' | 'project' | 'cv' | 'grotto';
export type ChalkDevice = 'keys' | 'touch';

export interface ChalkMark {
  readonly id: string;
  readonly group: ChalkGroup;
  readonly text: string;
  /** The mark's centre; y is its height on a wall (ground marks follow the terrain). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Turn of the writing's baseline from +x toward -z (radians): positive turns it to point away from the lens. */
  readonly yaw: number;
  readonly surface: 'ground' | 'wall';
  /** Height of a capital (m). */
  readonly cap: number;
  /** Linear albedo of the chalk: an off-white, a dusty rose or a sage. */
  readonly tint: readonly [number, number, number];
  /** Shown while the visitor is within this distance (m); the first-visit marks ignore it. */
  readonly near: number;
}

/** Chalk colours: dusty white, a dusty rose and a sage, all well under paper white so the lamps cannot make them glow. */
export const CHALK_TINT = {
  white: [0.92, 0.9, 0.84],
  rose: [0.94, 0.72, 0.7],
  sage: [0.74, 0.86, 0.7],
} as const;

const WORDS: Readonly<Record<Lang, Readonly<Record<string, string>>>> = {
  en: {
    cat: 'cat ⟶', walk: 'walk', click: 'click to go', turn: '[Q] [E] turn', drag: 'drag\nto walk', fingers: 'two\nfingers\nturn',
    open: 'Enter / Open ⟶',
  },
  es: {
    cat: 'gato ⟶', walk: 'camina', click: 'clic para ir', turn: '[Q] [E] gira', drag: 'arrastra\npara\ncaminar', fingers: 'dos\ndedos\ngiran',
    open: 'Intro / Abrir ⟶',
  },
};
/** Key caps are written as they are in every language. */
const SAME: Readonly<Record<string, string>> = { wasd: '[W]\n[A][S][D]', arrows: '[↑]\n[←][↓][→]' };

/** Cap heights (m) of the marks: a note, the controls, the key caps, a name, an arrow. */
const NOTE = 0.34;
const CONTROLS = 0.26;
const KEYS = 0.2;
const NAME = 0.28;
const ARROW = 0.32;
type Tint = readonly [number, number, number];

/**
 * The controls round the gate's stand point: word, offset (m: x right, z toward the lens), cap height and chalk.
 * Keys and mouse: the two key clusters side by side, "walk" under them, then "click to go" and the turn keys.
 */
const GATE: Readonly<Record<ChalkDevice, readonly (readonly [string, number, number, number, Tint])[]>> = {
  keys: [
    ['wasd', -1.85, 1.45, KEYS, CHALK_TINT.white], ['arrows', -0.75, 1.45, KEYS, CHALK_TINT.white], ['walk', -1.3, 2.05, CONTROLS, CHALK_TINT.rose],
    ['click', -1.2, 2.6, CONTROLS, CHALK_TINT.white], ['turn', -1.0, 3.1, KEYS, CHALK_TINT.sage],
  ],
  touch: [['drag', -0.95, 1.6, CONTROLS, CHALK_TINT.white], ['fingers', -0.8, 2.75, KEYS, CHALK_TINT.sage]],
};
/**
 * The cat note: on the bare soil across the path from the bench (pale slabs swallow pale chalk), left of the cat, its
 * arrow aimed at the cat; it shows from 8 m.
 */
const CAT_NOTE = [-2.2, 2.45, 8] as const;
/** A project's name lies this far in front of its flower (and this far past the pond's shore) and shows from this near (m). */
const NAME_AT = [0.75, 0.55, 4.2] as const;
/** "Enter / Open" lies on the soil across the path from the first flower, to its left. */
const OPEN_NOTE = [-1.4, 2.4] as const;
/**
 * The CV note on the soil left of the path's last slabs and the arrow into the doorway beside them (x from the jamb,
 * z from the wall); their cap height and reach.
 */
const CV_NOTE = [-1.65, 3.0] as const;
const CV_ARROW = [-0.8, 1.8] as const;
const CV_CAP = 0.36;
const CV_NEAR = 7;
/**
 * The grotto's arrows: one on the wall left of the mouth pointing into it (x from the mouth's edge, height, off the
 * face), one on the soil right of the spur's last slabs (x from the mouth's middle, z from the wall); their reach.
 */
const GROTTO_WALL = [-0.9, 1.3, 0.05] as const;
const GROTTO_ARROW = [1.1, 2.1] as const;
const GROTTO_NEAR = 6;

/** Writing turned further than this (radians) runs away from the lens and foreshortens past reading. */
const MAX_TURN = 0.35;

/** Turn (yaw) that points a mark's writing from (x, z) toward (tx, tz), held within MAX_TURN. */
export function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.max(-MAX_TURN, Math.min(MAX_TURN, Math.atan2(-(tz - z), tx - x)));
}

export interface ChalkInput {
  world: WorldLayout;
  scenes: Readonly<Record<BedId, BedScene3>>;
  content: Pick<Content, 'projects' | 'profile'>;
  device: ChalkDevice;
  lang: Lang;
  /** The first-visit marks (controls and "Enter / Open") are wanted. */
  first: boolean;
}

function ground(id: string, group: ChalkGroup, text: string, x: number, z: number, cap: number, tint: Tint, near: number, yaw = 0): ChalkMark {
  return { id, group, text, x, y: 0, z, yaw, surface: 'ground', cap, tint, near };
}

/** Every chalk mark for this language and device. */
export function chalkMarks(d: ChalkInput): ChalkMark[] {
  const { world, scenes } = d;
  const w = WORDS[d.lang];
  const gateX = world.anchors[world.order[0]!] ?? 0;
  const gateZ = pathZ(world.ground.path.points, gateX);
  const marks: ChalkMark[] = d.first
    ? GATE[d.device].map(([key, dx, dz, cap, tint]) => ground(`first/${key}`, 'first', SAME[key] ?? w[key]!, gateX + dx, gateZ + dz, cap, tint, 0))
    : [];

  const cat = scenes.rosaleda.slots.find((s) => s.kind === 'pet');
  if (cat !== undefined) {
    const [x, z] = [cat.x + CAT_NOTE[0], cat.z + CAT_NOTE[1]];
    marks.push(ground('cat', 'cat', w['cat']!, x, z, NOTE, CHALK_TINT.white, CAT_NOTE[2], yawToward(x, z, cat.x, cat.z)));
  }

  const beds = [...new Set(d.content.projects.map((p) => p.bed))];
  const flowers = beds.flatMap((bed) => bindSlots({ scene: scenes[bed], projects: projectsOf(bed, d.content.projects), profile: d.content.profile, lang: d.lang, mode: 'roam' }))
    .sort((a, b) => a.world[0] - b.world[0]);
  const pond = world.ground.pond;
  for (const v of flowers) {
    if (v.project === undefined) continue;
    const [x, , z] = v.world;
    const across = 1 - ((x - pond.x) / pond.rx) ** 2;
    const shore = across > 0 ? pond.z + pond.rz * Math.sqrt(across) + NAME_AT[1] : -Infinity;
    marks.push(ground(`project/${v.project.id}`, 'project', `↑\n${v.project.title}`, x, Math.max(z + NAME_AT[0], shore), NAME, CHALK_TINT.rose, NAME_AT[2]));
  }
  const firstFlower = flowers.find((v) => v.project !== undefined);
  if (d.first && firstFlower !== undefined) {
    const [fx, , fz] = firstFlower.world;
    const [x, z] = [fx + OPEN_NOTE[0], fz + OPEN_NOTE[1]];
    marks.push(ground('first/open', 'first', w['open']!, x, z, KEYS, CHALK_TINT.sage, 0, yawToward(x, z, fx, fz)));
  }

  const e = world.ground.enclosure;
  const wallZ = world.ground.wall.z;
  const [cx, cz] = [e.door[0] + CV_NOTE[0], wallZ + CV_NOTE[1]];
  marks.push(ground('cv/note', 'cv', 'CV ⟶', cx, cz, CV_CAP, CHALK_TINT.white, CV_NEAR, yawToward(cx, cz, (e.door[0] + e.door[1]) / 2, wallZ)));
  marks.push(ground('cv/door', 'cv', '↑', e.door[0] + CV_ARROW[0], wallZ + CV_ARROW[1], ARROW, CHALK_TINT.white, CV_NEAR));
  const mouth = e.low.find((l) => l[2] === 0);
  if (mouth !== undefined) {
    marks.push({ id: 'grotto/wall', group: 'grotto', text: '⟶', x: mouth[0] + GROTTO_WALL[0], y: GROTTO_WALL[1], z: wallZ + GROTTO_WALL[2], yaw: 0, surface: 'wall',
      cap: ARROW, tint: CHALK_TINT.sage, near: GROTTO_NEAR });
    marks.push(ground('grotto', 'grotto', '↑', (mouth[0] + mouth[1]) / 2 + GROTTO_ARROW[0], wallZ + GROTTO_ARROW[1], ARROW, CHALK_TINT.sage, GROTTO_NEAR));
  }
  return marks;
}
