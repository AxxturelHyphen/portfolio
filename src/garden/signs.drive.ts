import { createSignboardMeshes } from '../gl/signboards.ts';
import type { Clock, Gfx, Lang, Loop, Machine, QuadParams } from '../types.ts';
import { RENDER_ORDER } from '../world/order.ts';
import { MAX_SIGNS, PARTS, PLANK_PART, PLANK_SPRITE, flameInPlank, signQuads, type SignQuads } from '../world/signboard.ts';
import { createAtlasCanvas, displayFontReady, paintAtlas } from '../world/signboard.paint.ts';
import type { SignPost } from './place.ts';

/**
 * Free roam's signposts in the world (world/signboard.ts, gl/signboards.ts): built once at load, lettered once the
 * display face is in and again on a language change. A sign wakes when the visitor comes within NEAR_M of its post,
 * or the pointer or keyboard focus is on a button over it (ui/signposts.ts, data-anchor = the sign's index; every plank
 * on screen has one): its plank brightens a little and, unless motion is reduced, sways once on its hook with its
 * wooden board. The sign under the pointer and the focused one are kept by index when they come, so a button
 * retargeted under the pointer never leaves a plank awake. Otherwise it stands still apart from the lantern's slow
 * flicker. A board that names the bed the visitor stands in folds up into its arm and fades (at once under reduced
 * motion); the post, the arm and the lantern stay, and its button is taken out of reach (ui/proxies.ts). The quads are
 * written only while a sign changes; nothing is allocated per frame.
 */

const NEAR_M = 3;
/** Each lantern flickers on its own phase. */
const FLICKER_STEP = 1.7;
/** The plank's tint at rest and the pool's strength at rest (both reach 1 awake), and the ease of the change (s). */
const REST = { tint: 0.84, glow: 0.6, tauS: 0.18 } as const;
/** One sway on the hook: its amplitude (radians, about 3.5 degrees) and length (s). */
const SWAY = { rad: 0.06, s: 0.6 } as const;
/** How long a board takes to fold away or back (s). */
const FOLD_S = 0.3;
/** Paint order: after every bed, the near dressing and the foreground frames; before the fireflies and the actors. */
const ORDER = RENDER_ORDER.front + 50;

export interface SignDriveDeps {
  gfx: Gfx;
  machine: Machine;
  loop: Loop;
  posts: readonly SignPost[];
  /** The visitor's ground point [x, z]. */
  visitor: Float32Array;
  /** Where the sign buttons live: their hover and focus wake the signs. */
  proxies: HTMLElement;
  nameOf(to: SignPost['to'], lang: Lang): string;
}

export interface SignDrive {
  /** The planks are lettered (the display face is in): resolve before Gfx.warm() so the atlas uploads there. */
  readonly ready: Promise<void>;
}

/** fold: 0 the board hangs, 1 it is folded away. */
interface Sign { quads: SignQuads; glow: QuadParams; level: number; swayT: number; awake: boolean; fold: number }

export function createSignDrive(d: SignDriveDeps): SignDrive {
  const { machine, visitor } = d;
  const posts = d.posts.slice(0, MAX_SIGNS);
  const canvas = createAtlasCanvas();
  const meshes = createSignboardMeshes(d.gfx, canvas, posts, ORDER);
  const flame = new Float32Array(2);
  const signs: Sign[] = posts.map((p, i) => {
    const quads = signQuads(p, i);
    flameInPlank(p.dir, flame);
    const glow: QuadParams = {
      ...quads.plank, sway: flame[0]!, lift: flame[1]!, phase: i * FLICKER_STEP, tint: new Float32Array([1, 1, 1, REST.glow]),
    };
    const fold = p.to === machine.state.bed ? 1 : 0;
    return { quads, glow, level: 0, swayT: -1, awake: false, fold };
  });
  const batch = meshes.batch.writer;
  signs.forEach((s, i) => {
    (s.quads.plank.tint as Float32Array).fill(REST.tint, 0, 3);
    folded(s, i);
    batch.set(i * PARTS + PLANK_PART, s.quads.plank);
    batch.set(i * PARTS + PLANK_PART + 1, s.quads.lantern);
    meshes.glow.set(i, s.glow);
  });
  batch.count = signs.length * PARTS;
  batch.commit(0, batch.count);
  meshes.glow.count = signs.length;
  meshes.glow.commit(0, signs.length);

  let lang = machine.state.lang;
  const dirs = posts.map((p) => p.dir);
  const paint = (): void => {
    paintAtlas(canvas, posts.map((p) => d.nameOf(p.to, lang)), dirs);
    meshes.texture.needsUpdate = true;
  };
  const ready = displayFontReady().then(paint);
  meshes.setFlicker(!machine.state.reduced);
  machine.subscribe((s) => {
    meshes.setFlicker(!s.reduced);
    if (s.lang === lang) return;
    lang = s.lang;
    void ready.then(paint);
  });

  /** The sign under the pointer and the one whose button has the focus, or -1. */
  let pointed = -1;
  let focused = -1;
  const signOf = (e: Event): number => {
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('.px-sign') : null;
    const i = Number(el?.dataset['anchor'] ?? -1);
    return i >= 0 && i < signs.length ? i : -1;
  };
  const wake = (): void => d.loop.wake();
  d.proxies.addEventListener('pointerover', (e) => {
    pointed = signOf(e);
    wake();
  });
  d.proxies.addEventListener('pointerout', () => {
    pointed = -1;
    wake();
  });
  d.proxies.addEventListener('focusin', (e) => {
    focused = signOf(e);
    wake();
  });
  d.proxies.addEventListener('focusout', () => {
    focused = -1;
    wake();
  });

  /** Writes the board's fold into its face card, its pool and its wooden body. */
  function folded(s: Sign, i: number): void {
    const open = 1 - s.fold;
    s.quads.plank.h = PLANK_SPRITE.h * open;
    s.glow.h = PLANK_SPRITE.h * open;
    (s.quads.plank.tint as Float32Array)[3] = open;
    (s.glow.tint as Float32Array)[3] = (REST.glow + (1 - REST.glow) * s.level) * open;
    meshes.swing(i, s.quads.plank.rot, open);
  }

  /** One sign's frame: wake on the visitor, the pointer or the focus, ease the light, run the sway, fold a board that names
   * the visitor's bed; whether its quads changed. */
  function step(s: Sign, i: number, p: SignPost, c: Clock): boolean {
    const dx = visitor[0]! - p.x;
    const dz = visitor[1]! - p.z;
    const awake = i === pointed || i === focused || dx * dx + dz * dz < NEAR_M * NEAR_M;
    if (awake && !s.awake && !machine.state.reduced) s.swayT = 0;
    s.awake = awake;
    const goal = awake ? 1 : 0;
    const before = s.level;
    s.level = c.frozen ? goal : s.level + (goal - s.level) * (1 - Math.exp(-c.dt / REST.tauS));
    if (Math.abs(goal - s.level) < 1e-3) s.level = goal;
    let rot = 0;
    if (s.swayT >= 0) {
      s.swayT = c.frozen || machine.state.reduced ? SWAY.s : s.swayT + c.dt;
      const k = s.swayT / SWAY.s;
      if (k >= 1) s.swayT = -1;
      else rot = SWAY.rad * Math.sin(2 * Math.PI * k) * (1 - k) * (1 - k);
    }
    const fold = s.fold;
    const away = p.to === machine.state.bed ? 1 : 0;
    s.fold = c.frozen || machine.state.reduced ? away : away > fold ? Math.min(1, fold + c.dt / FOLD_S) : Math.max(0, fold - c.dt / FOLD_S);
    if (s.level === before && rot === s.quads.plank.rot && s.fold === fold) return false;
    const tint = s.quads.plank.tint as Float32Array;
    tint[0] = tint[1] = tint[2] = REST.tint + (1 - REST.tint) * s.level;
    s.quads.plank.rot = rot;
    s.glow.rot = rot;
    folded(s, i);
    return true;
  }

  d.loop.on('world', (c) => {
    for (let i = 0; i < signs.length; i++) {
      const s = signs[i]!;
      if (!step(s, i, posts[i]!, c)) continue;
      const at = i * PARTS + PLANK_PART;
      batch.set(at, s.quads.plank);
      batch.commit(at, at + 1);
      meshes.glow.set(i, s.glow);
      meshes.glow.commit(i, i + 1);
    }
  });
  return { ready };
}
