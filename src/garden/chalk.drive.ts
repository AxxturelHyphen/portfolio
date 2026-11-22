import { createChalkMesh } from '../gl/chalk.ts';
import { uploadTexture } from '../gl/ktx2.ts';
import type { BedId, Clock, Gfx, Loop, Machine } from '../types.ts';
import { chalkMarks, MAX_MARKS, type ChalkDevice, type ChalkMark } from '../world/chalk.ts';
import type { BedScene3 } from '../world/layout.ts';
import { catLeash } from '../world/pet.leash.ts';

/**
 * Shows the chalk (world/chalk.ts, gl/chalk.ts) as the visitor walks: the cat's note and the grotto's notes within
 * their reach. A mark seen for the first time chalks itself on stroke by stroke (at once under reduced motion or frozen
 * time); after that it only fades with the distance. The cat's note floats in the air: while it shows it boils and
 * bobs slowly (still under reduced motion or frozen time); once the cat is tied (world/pet.leash.ts) it rubs out with
 * a smear and stays gone, and start over brings it back to be chalked again. The loop is also kept awake while the
 * tied cat trots after the visitor, wherever they are. Nothing turns or redraws as the visitor walks: the language
 * switch alone rebuilds the atlas. One draw on every tier. No allocation per frame.
 */

export interface ChalkDeps {
  machine: Machine;
  loop: Loop;
  /** The visitor's ground point x, z. */
  visitor: Float32Array;
  /** Installs window.__chalk and window.__cat (the test API is on). */
  test: boolean;
}

export interface ChalkTestApi {
  marks(): { id: string; text: string; opacity: number; x: number; y: number; z: number }[];
  readonly builds: number;
  readonly shown: boolean;
}

/** The cat on its leash (world/pet.leash.ts): tied or not, where it stands while it follows. */
export interface CatTestApi { readonly on: boolean; at(): { x: number; z: number } | null }

declare global {
  interface Window { __chalk?: ChalkTestApi; __cat?: CatTestApi }
}

/** Seconds: chalking a mark on (one with the long arrow), a mark fading in or out, the cat's note rubbing out. */
const DRAW_S = 0.6;
const ARROW_DRAW_S = 2.2;
const FADE_S = 0.45;
const RUB_S = 0.5;
/** The float clock runs from FLOAT_FROM_S (0 holds a mark still) and wraps every FLOAT_WRAP_S, a whole number of bobs. */
const FLOAT_FROM_S = 1;
const FLOAT_WRAP_S = 500;

export function createChalkDrive(gfx: Gfx, scenes: Readonly<Record<BedId, BedScene3>>, order: number, d: ChalkDeps): void {
  const { machine, visitor } = d;
  const device: ChalkDevice = matchMedia('(pointer: coarse)').matches ? 'touch' : 'keys';
  const chalk = createChalkMesh(order, Math.min(8, gfx.renderer.capabilities.getMaxAnisotropy()));
  let marks: ChalkMark[] = [];
  let builds = 0;
  const build = (): void => {
    marks = chalkMarks({ scenes, device, lang: machine.state.lang }).slice(0, MAX_MARKS);
    chalk.build(marks);
    builds += 1;
  };
  build();
  gfx.scene.add(chalk.mesh);
  uploadTexture(gfx, chalk.texture);
  const state = chalk.state;

  machine.subscribe((s, prev) => {
    if (s.lang !== prev.lang) build();
  });

  d.loop.on('world', (c: Clock) => {
    const x = visitor[0]!;
    const z = visitor[1]!;
    const instant = c.frozen || machine.state.reduced;
    let any = false;
    let moving = false;
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i]!;
      const v = state[i]!;
      const rubbed = m.group === 'cat' && catLeash.on;
      if (m.group === 'cat' && !rubbed && v.z > 0) v.set(0, 0, 0, 0);
      const want = !rubbed && Math.hypot(m.x - x, m.z - z) < m.near ? 1 : 0;
      if (instant) {
        v.y = want;
        v.z = rubbed ? 1 : 0;
        if (want > 0) v.x = 1;
      } else if (rubbed && v.y > 0) {
        v.z = Math.min(1, v.z + c.dt / RUB_S);
        v.y = Math.max(0, v.y - c.dt / RUB_S);
        moving = true;
      } else {
        const k = c.dt / FADE_S;
        v.y = want > v.y ? Math.min(want, v.y + k) : Math.max(want, v.y - k);
        if (v.y > 0 && v.x < 1) v.x = Math.min(1, v.x + c.dt / (m.arrow === undefined ? DRAW_S : ARROW_DRAW_S));
        moving ||= v.y !== want || (v.y > 0 && v.x < 1);
      }
      if (m.surface === 'air' && v.y > 0 && !instant) {
        v.w = c.t % FLOAT_WRAP_S + FLOAT_FROM_S;
        moving = true;
      }
      any ||= v.y > 0;
    }
    chalk.mesh.visible = any;
    if (moving || catLeash.moving) d.loop.wake();
  });

  if (d.test) {
    window.__chalk = {
      marks: () => marks.map((m, i) => ({ id: m.id, text: m.text, opacity: state[i]!.y, x: m.x, y: m.y, z: m.z })),
      get builds() {
        return builds;
      },
      get shown() {
        return chalk.mesh.visible;
      },
    };
    window.__cat = {
      get on() {
        return catLeash.on;
      },
      at: () => (Number.isNaN(catLeash.at[0]!) ? null : { x: catLeash.at[0]!, z: catLeash.at[1]! }),
    };
  }
}
