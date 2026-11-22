import { createChalkMesh } from '../gl/chalk.ts';
import { uploadTexture } from '../gl/ktx2.ts';
import type { BedId, Clock, Gfx, Loop, Machine } from '../types.ts';
import { chalkMarks, MAX_MARKS, type ChalkDevice, type ChalkMark } from '../world/chalk.ts';
import type { BedScene3 } from '../world/layout.ts';

/**
 * Shows the chalk (world/chalk.ts, gl/chalk.ts) as the visitor walks: the cat's note and the grotto's notes within
 * their reach. A mark seen for the first time chalks itself on stroke by stroke (at once under reduced motion or frozen
 * time); after that it only fades with the distance. Nothing moves, turns or redraws as the visitor walks: the language
 * switch alone rebuilds the atlas. One draw on every tier. No allocation per frame.
 */

export interface ChalkDeps {
  machine: Machine;
  loop: Loop;
  /** The visitor's ground point x, z. */
  visitor: Float32Array;
  /** Installs window.__chalk (the test API is on). */
  test: boolean;
}

export interface ChalkTestApi {
  marks(): { id: string; text: string; opacity: number; x: number; y: number; z: number }[];
  readonly builds: number;
  readonly shown: boolean;
}

declare global {
  interface Window { __chalk?: ChalkTestApi }
}

/** Seconds: chalking a mark on, a mark fading in or out. */
const DRAW_S = 0.6;
const FADE_S = 0.45;

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
      const want = Math.hypot(m.x - x, m.z - z) < m.near ? 1 : 0;
      if (instant) {
        v.y = want;
        if (want > 0) v.x = 1;
      } else {
        const k = c.dt / FADE_S;
        v.y = want > v.y ? Math.min(want, v.y + k) : Math.max(want, v.y - k);
        if (v.y > 0 && v.x < 1) v.x = Math.min(1, v.x + c.dt / DRAW_S);
        moving ||= v.y !== want || (v.y > 0 && v.x < 1);
      }
      any ||= v.y > 0;
    }
    chalk.mesh.visible = any;
    if (moving) d.loop.wake();
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
  }
}
