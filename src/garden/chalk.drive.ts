import { createChalkMesh } from '../gl/chalk.ts';
import { uploadTexture } from '../gl/ktx2.ts';
import type { BedId, Clock, Content, Gfx, Loop, Machine, Quality } from '../types.ts';
import { chalkMarks, MAX_MARKS, type ChalkDevice, type ChalkMark } from '../world/chalk.ts';
import type { BedScene3, WorldLayout } from '../world/layout.ts';

/**
 * Shows the chalk (world/chalk.ts, gl/chalk.ts) as the visitor walks: the cat's note, the CV and the grotto arrow
 * within their reach, a project's name as the visitor comes near its flower, and on a first visit the controls at the
 * gate until the visitor has walked a few metres and opened something (then they wear away and stay away on later
 * visits). A mark seen for the first time chalks itself on stroke by stroke (at once under reduced motion or frozen
 * time); the language switch redraws the atlas once. On the low tier, whose draws are all spoken for, the chalk shows
 * only while the visitor stands still. No allocation per frame.
 */

export interface ChalkDeps {
  machine: Machine;
  loop: Loop;
  quality: Quality;
  content: Pick<Content, 'projects' | 'profile'>;
  /** The visitor's ground point x, z. */
  visitor: Float32Array;
  /** Installs window.__chalk (the test API is on). */
  test: boolean;
}

export interface ChalkTestApi {
  marks(): { id: string; text: string; opacity: number; x: number; z: number }[];
  readonly builds: number;
  readonly shown: boolean;
}

declare global {
  interface Window { __chalk?: ChalkTestApi }
}

/** localStorage key: the visitor has learnt the controls, the gate stays clean. */
export const CHALK_LEARNT_KEY = 'jardin.chalk';
/** The first-visit marks wear away once the visitor has walked this far (m) and opened something. */
const LEARN_WALK_M = 3;
/** Seconds: chalking a mark on, a mark fading in or out, standing still before the low tier shows the chalk. */
const DRAW_S = 0.6;
const FADE_S = 0.45;
const WEAR_S = 1.4;
const STILL_S = 0.6;
/** A jump longer than this (m, one frame) is a placement, not a walk. */
const STEP_MAX_M = 0.5;

function readLearnt(): boolean {
  try {
    return localStorage.getItem(CHALK_LEARNT_KEY) === '1';
  } catch {
    return false;
  }
}

function storeLearnt(): void {
  try {
    localStorage.setItem(CHALK_LEARNT_KEY, '1');
  } catch {
    /* storage blocked: the controls come back on the next visit */
  }
}

export function createChalkDrive(gfx: Gfx, world: WorldLayout, scenes: Readonly<Record<BedId, BedScene3>>, order: number, d: ChalkDeps): void {
  const { machine, visitor } = d;
  const device: ChalkDevice = matchMedia('(pointer: coarse)').matches ? 'touch' : 'keys';
  const first = !readLearnt();
  const chalk = createChalkMesh(order, Math.min(8, gfx.renderer.capabilities.getMaxAnisotropy()));
  let marks: ChalkMark[] = [];
  let builds = 0;
  const build = (): void => {
    marks = chalkMarks({ world, scenes, content: d.content, device, lang: machine.state.lang, first }).slice(0, MAX_MARKS);
    chalk.build(marks);
    builds += 1;
  };
  build();
  gfx.scene.add(chalk.mesh);
  uploadTexture(gfx, chalk.texture);

  let learnt = !first;
  let opened = false;
  let walked = 0;
  let stillS = 0;
  let lastX = visitor[0]!;
  let lastZ = visitor[1]!;
  const state = chalk.state;

  machine.subscribe((s, prev) => {
    if (s.lang !== prev.lang) build();
    if (s.phase === 'opening' || s.phase === 'inspect') opened = true;
  });

  d.loop.on('world', (c: Clock) => {
    const x = visitor[0]!;
    const z = visitor[1]!;
    const step = Math.hypot(x - lastX, z - lastZ);
    lastX = x;
    lastZ = z;
    if (step < STEP_MAX_M) walked += step;
    stillS = step > 1e-4 ? 0 : stillS + c.dt;
    if (!learnt && opened && walked >= LEARN_WALK_M) {
      learnt = true;
      storeLearnt();
    }
    const instant = c.frozen || machine.state.reduced;
    let any = false;
    let moving = false;
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i]!;
      const v = state[i]!;
      const want = m.group === 'first' ? (learnt ? 0 : 1) : Math.hypot(m.x - x, m.z - z) < m.near ? 1 : 0;
      const rate = m.group === 'first' && learnt ? WEAR_S : FADE_S;
      if (instant) {
        v.y = want;
        if (want > 0) v.x = 1;
      } else {
        const k = c.dt / rate;
        v.y = want > v.y ? Math.min(want, v.y + k) : Math.max(want, v.y - k);
        if (v.y > 0 && v.x < 1) v.x = Math.min(1, v.x + c.dt / DRAW_S);
        moving ||= v.y !== want || (v.y > 0 && v.x < 1);
      }
      any ||= v.y > 0;
    }
    const low = d.quality.tier === 'low';
    chalk.mesh.visible = any && (!low || stillS >= STILL_S);
    if (moving || (low && any && stillS < STILL_S)) d.loop.wake();
  });

  if (d.test) {
    window.__chalk = {
      marks: () => marks.map((m, i) => ({ id: m.id, text: m.text, opacity: state[i]!.y, x: m.x, z: m.z })),
      get builds() {
        return builds;
      },
      get shown() {
        return chalk.mesh.visible;
      },
    };
  }
}
