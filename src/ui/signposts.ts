import type { BedId, CameraRig, Machine, ScreenPt, State } from '../types.ts';
import { uiText } from './copy.ts';
import { clearOfVisitor, createStake, crossesVisitor, DOCK, dockAround, figureOf, SIGN_M, type DockBox, type FigureBox, type Stake } from './signs.stake.ts';
import './styles/signs.css';
import { createMover, type Mover } from './xform.ts';

/**
 * Signposts (cook/ART.md section 4): while a bed is the current place, one sign points back to the previous place
 * and one on to the next (at La Salida the next is "To the CV"). Each is a real <button>: a slim painted garden label
 * lashed with twine to a bamboo cane that stands in the soil and runs off the bottom of the screen, lettered with the
 * place name, with an engraved pointing hand (a manicule) showing the way. A click is the travel (GOTO), or the mode
 * switch for the CV.
 * Where world supplies sign anchors (setAnchors), the label sits on its canvas board: projected each frame in stage
 * 'dom' (only when the rig moved), snapped to whole pixels, and docked to the nearest screen edge at the same height
 * when the board leaves the view, so a sign never disappears. The label's CSS tilt turns the per-frame translate too
 * (read once per retarget): where that turn would carry the label nearer a side than SIDE_PX, the offset is pulled in.
 * Without anchors both signs dock at the screen edges in the lower half; on phones the way back stands above the
 * folded plan and the way on at the foot of the screen, clear of the fixed controls and the hero. The way back always
 * stands higher than the way on, so the pair never reads as one row.
 * Free roam (setVisitor, ?roam=1, phones too): each sign is planted at its board, the label SIGN_M above the ground
 * and a cane down to the ground point with a contact shadow (ui/signs.stake.ts), lifted clear of the visitor. While
 * the ground point is off screen the label docks at the screen edge with a short cane (data-off). On portrait screens a
 * label stays planted only while it stands wholly over the visitor's hat; otherwise both docked labels share one band
 * under the visitor's shoes (ui/signs.stake.ts dockAround), so no label, cane or tip ever crosses the figure, and a long
 * name breaks onto two lines at its middle space by rule.
 */

/** One canvas board: shown while `bed` is the current place; it points `dir` toward `to`. World point of the label. */
export interface SignAnchor { bed: BedId; to: BedId | 'cv'; dir: -1 | 1; at: readonly [number, number, number] }

export interface BedSign { id: BedId; title: string }

export interface Signposts {
  mount(beds: readonly BedSign[]): void;
  setAnchors(anchors: readonly SignAnchor[]): void;
  onState(s: State): void;
  /** Stage 'dom': places anchored signs; `force` after a remount or retarget. */
  sync(rig: CameraRig, force: boolean): void;
  /** Free roam: plants the signs in the world and keeps them off the visitor standing at this [x, z]. */
  setVisitor(at: Float32Array): void;
}

const EDGE_PX = 16;
/** Least room between a label's turned box and the left or right edge of the screen. */
const SIDE_PX = 40;
/** Below the fixed labels and the exit hint that hangs under them. */
const TOP_PX = 120;
/** Room kept under a label so its cane shows before it leaves the screen; docked labels stand with their foot here. */
const STAKE_PX = 48;
const DOCK_FOOT = 0.7;
/** Half the height step between the way back (higher) and the way on (lower). */
const STEP_PX = 40;
const SVG = 'http://www.w3.org/2000/svg';
/**
 * A printer's manicule pointing right in a 48x24 box, in engraved line: the ruffled cuff with its hatching, the back
 * of the hand, the index finger out with its nail, three curled fingers below and the thumb crease.
 */
const HAND = 'M3 5h7v15H3zM4.8 7.5v10M6.6 7.5v10M8.4 7.5v10M10 6.5c4-1.5 9-1.8 13-.5h18.5c2 0 3.2 1 3.2 2.3s-1.2 2.3-3.2 2.3H27'
  + 'c2 0 3.1 1 3.1 2.2s-1.1 2.2-3.1 2.2h-.8c2 0 3 1 3 2.1s-1 2.1-3 2.1h-.8c1.6 0 2.5.9 2.5 1.9s-.9 1.9-2.5 1.9H17'
  + 'c-3 0-5-.8-7-1.4M14 9.2c3 0 6 .5 9 1.4M23 10.6c1.4.2 2.8.3 4 .3M13 12.6h3M13 15h3.6M13 17.4h3M39.6 6.6c1.3.3 2 .9 2.1 1.7';
/** Twine lashing the label to the cane: two turns round the cane over the label's top edge, a knot and a tail. */
const LASH = 'M3 10l18-5M3 16l18-5M21 5c3-.6 4 1.6 2.4 3.4M21 11c3 .4 3.4 4 1 7.5';
const NARROW = '(max-width: 44.99rem)';
/** Where the cane is lashed, in from the label's pointing-away end (the CSS --cane-at). */
const CANE_AT_PX = 14;
const SHOWN: readonly State['phase'][] = ['bed', 'focus'];
/** Below this width / height the follow camera frames for portrait (world/follow.ts PORTRAIT_ASPECT). */
const PORTRAIT = 0.8;
/** Least room between a planted label and a side of a portrait screen. */
const PORTRAIT_SIDE_PX = 20;
/** How far the twine lashing reaches past the label's cane end (the CSS .px-sign-lash box). */
const LASH_OUT_PX = 4;
/** Names longer than this break onto two lines at the space nearest their middle (free roam). */
const LONG_CHARS = 12;

interface Sign {
  el: HTMLButtonElement;
  name: HTMLSpanElement;
  mover: Mover;
  dir: -1 | 1;
  to: BedId | 'cv' | null;
  /** Index into the anchors of the current bed, or -1 when docked. */
  anchor: number;
  w: number;
  h: number;
  /** Cosine and sine of the label's CSS tilt. */
  cos: number;
  sin: number;
  /** Free roam: the planted cane and shadow; null on the rail. */
  stake: Stake | null;
  off: boolean;
  /** Portrait free roam: the docked place, set by dockAround. */
  dock: DockBox;
}

const pt: ScreenPt = { x: 0, y: 0, scale: 1, visible: true };
const foot: ScreenPt = { x: 0, y: 0, scale: 1, visible: true };

function drawing(cls: string, box: string, d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', box);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

/** `rotate` applies before `transform`, so the translate is turned by the tilt: keep its angle to undo that. */
function readTilt(s: Sign): void {
  const rad = (Number.parseFloat(getComputedStyle(s.el).rotate) || 0) * (Math.PI / 180);
  s.cos = Math.cos(rad);
  s.sin = Math.sin(rad);
}

function makeSign(dir: -1 | 1, m: Machine): Sign {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'px-bed px-sign';
  el.dataset.dir = dir < 0 ? 'prev' : 'next';
  const name = document.createElement('span');
  name.className = 'px-sign-name';
  const cane = document.createElement('span');
  cane.className = 'px-sign-cane';
  cane.setAttribute('aria-hidden', 'true');
  el.append(cane, drawing('px-sign-lash', '0 0 26 26', LASH), name, drawing('px-sign-hand', '0 0 48 24', HAND));
  const sign: Sign = { el, name, mover: createMover(el), dir, to: null, anchor: -1, w: 140, h: 44, cos: 1, sin: 0, stake: null, off: false, dock: { w: 0, h: 0, x: 0, y: 0, on: false } };
  el.addEventListener('click', () => {
    if (sign.to === 'cv') m.send({ type: 'SET_MODE', mode: 'herbario' });
    else if (sign.to !== null) m.send({ type: 'GOTO', place: { k: 'bed', bed: sign.to } });
  });
  return sign;
}

/** The sign's name; under free roam a long name gets a line break at its middle space, which only portrait CSS shows. */
function letter(s: Sign, title: string): void {
  const mid = title.length / 2;
  let at = -1;
  for (let i = title.indexOf(' '); i >= 0; i = title.indexOf(' ', i + 1)) if (at < 0 || Math.abs(i - mid) < Math.abs(at - mid)) at = i;
  if (s.stake === null || title.length <= LONG_CHARS || at < 0) {
    s.name.textContent = title;
    return;
  }
  s.name.replaceChildren(title.slice(0, at + 1), document.createElement('br'), title.slice(at + 1));
}

export function createSignposts(parent: HTMLElement, m: Machine): Signposts {
  const group = document.createElement('div');
  group.className = 'px-signs';
  const signs = [makeSign(-1, m), makeSign(1, m)] as const;
  group.append(signs[0].el, signs[1].el);
  parent.append(group);
  const narrow = matchMedia(NARROW);
  let beds: readonly BedSign[] = [];
  let anchors: readonly SignAnchor[] = [];
  let current: BedId | null = null;
  let vw = innerWidth;
  let vh = innerHeight;
  /** A new viewport or sign size re-places the signs on the next frame even when the rig stands still. */
  let resized = false;
  let visitor: Float32Array | null = null;
  /** Portrait free roam this frame: docked labels share the band under the figure and stand nearer the sides. */
  let portrait = false;
  const figure: FigureBox = { l: 0, r: 0, t: 0, b: 0 };
  /** The screen's safe-area insets at the sides (px), read from the group's padding on resize. */
  let safeLeft = 0;
  let safeRight = 0;
  /** The plant tag is a sheet over the bottom of a phone screen (a slot focused): docked labels hang high meanwhile. */
  let sheet = false;

  function readSafe(): void {
    const css = getComputedStyle(group);
    safeLeft = Number.parseFloat(css.paddingLeft) || 0;
    safeRight = Number.parseFloat(css.paddingRight) || 0;
  }
  addEventListener('resize', () => {
    vw = innerWidth;
    vh = innerHeight;
    resized = true;
    if (visitor !== null) readSafe();
  }, { passive: true });
  const sizes = new ResizeObserver((entries) => {
    for (const e of entries) {
      const s = e.target === signs[0].el ? signs[0] : signs[1];
      const box = e.borderBoxSize[0];
      if (box === undefined) continue;
      s.w = box.inlineSize;
      s.h = box.blockSize;
      resized = true;
    }
  });
  sizes.observe(signs[0].el);
  sizes.observe(signs[1].el);

  function retarget(): void {
    const i = beds.findIndex((b) => b.id === current);
    const lang = m.state.lang;
    for (const s of signs) {
      const next = i < 0 ? undefined : beds[i + s.dir];
      s.to = i < 0 ? null : next !== undefined ? next.id : s.dir > 0 && i === beds.length - 1 ? 'cv' : null;
      s.el.hidden = s.to === null;
      if (s.to === null) continue;
      const title = s.to === 'cv' ? uiText(null, lang, 'sign.cv') : (next?.title ?? '');
      letter(s, title);
      if (s.to === 'cv') {
        delete s.el.dataset.bed;
        s.el.removeAttribute('aria-label');
      } else {
        s.el.dataset.bed = s.to;
        s.el.setAttribute('aria-label', `${uiText(null, lang, 'sign.go')} ${title}`);
      }
      s.anchor = anchors.findIndex((a) => a.bed === current && a.dir === s.dir);
      s.el.toggleAttribute('data-docked', s.anchor < 0);
      s.mover.reset();
      if (s.stake !== null) {
        s.off = true;
        s.el.toggleAttribute('data-off', true);
        s.stake.show(false);
      }
      if (s.anchor < 0) s.el.style.removeProperty('transform');
      else readTilt(s);
    }
  }

  /** Turns the label's wanted top-left (x, y) into its transform, pulling it in where the tilt would carry it too near a
   * side; returns the screen x the label's left edge lands on. */
  function settle(s: Sign, x: number, y: number): number {
    // Where the tilt turns (x, y) to on screen; only a label nearer a side than SIDE_PX is pulled in.
    const vy = x * s.sin + y * s.cos;
    let vx = x * s.cos - y * s.sin;
    const inset = (portrait ? PORTRAIT_SIDE_PX : SIDE_PX) + Math.ceil(s.h * Math.abs(s.sin));
    const maxVx = vw - inset - s.w;
    vx = vx < inset ? inset : vx > maxVx ? maxVx : vx;
    s.mover.move(Math.round(vx * s.cos + vy * s.sin), Math.round(vy * s.cos - vx * s.sin), 1);
    return vx;
  }

  /** Free roam: the label on its cane at the board, or docked at the edge while the board's foot is off screen, the
   * label would hang more than half its width past a side, or the label or its cane would cross the visitor's figure. */
  function plant(s: Sign, a: SignAnchor, rig: CameraRig, stake: Stake, at: Float32Array): void {
    rig.project(a.at[0], 0, a.at[2], foot);
    const caneAt = s.dir < 0 ? s.w - CANE_AT_PX : CANE_AT_PX;
    rig.project(a.at[0], SIGN_M, a.at[2], pt);
    const x = pt.x - caneAt;
    const maxY = vh - EDGE_PX - s.h;
    let y = clearOfVisitor(rig, at, x, pt.y, s.w, s.h);
    y = y < TOP_PX ? TOP_PX : y > maxY ? maxY : y;
    const off = !foot.visible || x < EDGE_PX - s.w / 2 || x > vw - EDGE_PX - s.w / 2 || crossesVisitor(rig, at, x, y, s.w, s.h, pt.x, foot)
      || (portrait && (sheet || y + s.h > figure.t - DOCK.gapPx));
    if (off !== s.off) {
      s.off = off;
      s.el.toggleAttribute('data-off', off);
      stake.show(!off);
    }
    s.dock.on = off && portrait;
    if (s.dock.on) return;
    if (off) {
      const dock = vh * DOCK_FOOT - s.h + s.dir * STEP_PX;
      settle(s, s.dir < 0 ? EDGE_PX : vw - EDGE_PX - s.w, dock < TOP_PX ? TOP_PX : dock);
      return;
    }
    const left = settle(s, x, y);
    stake.stand(left + caneAt, y, foot);
  }

  /** Portrait free roam: both docked labels in their band beside the figure (left where they were when none fits). */
  function dockPair(): void {
    const [prev, next] = signs;
    if (!prev.dock.on && !next.dock.on) return;
    for (const s of signs) {
      s.dock.w = s.w + LASH_OUT_PX + Math.ceil(s.h * Math.abs(s.sin));
      s.dock.h = s.h + Math.ceil(s.w * Math.abs(s.sin));
    }
    if (!dockAround(figure, vw, vh, prev.dock, next.dock, sheet, safeLeft, safeRight)) return;
    for (const s of signs) if (s.dock.on) standBox(s, s.dock.x + (s.dir > 0 ? LASH_OUT_PX : 0), s.dock.y);
  }

  /**
   * Puts the label's turned box (its CSS tilt about the cane end) with its top-left at screen (x, y): the translate
   * is undone through the tilt, so the box lands where dockAround measured it.
   */
  function standBox(s: Sign, x: number, y: number): void {
    const ox = s.dir < 0 ? s.w - CANE_AT_PX : CANE_AT_PX;
    let minX = Infinity;
    let minY = Infinity;
    for (let i = 0; i < 4; i++) {
      const cx = (i & 1 ? s.w : 0) - ox;
      const cy = i & 2 ? s.h : 0;
      minX = Math.min(minX, cx * s.cos - cy * s.sin);
      minY = Math.min(minY, cx * s.sin + cy * s.cos);
    }
    // Screen point of a corner c: O + R (T + c - O); solve R T = target - O - min over c of R (c - O).
    const rx = x - ox - minX;
    const ry = y - minY;
    s.mover.move(Math.round(rx * s.cos + ry * s.sin), Math.round(ry * s.cos - rx * s.sin), 1);
  }

  function place(s: Sign, rig: CameraRig): void {
    const a = anchors[s.anchor];
    if (a === undefined) return;
    if (s.stake !== null && visitor !== null) {
      plant(s, a, rig, s.stake, visitor);
      return;
    }
    rig.project(a.at[0], a.at[1], a.at[2], pt);
    const maxX = vw - EDGE_PX - s.w;
    const maxY = vh - EDGE_PX - s.h - STAKE_PX;
    let x = pt.x - s.w / 2;
    let y = pt.y - s.h;
    if (!pt.visible) {
      x = s.dir < 0 ? EDGE_PX : maxX;
      y = vh * DOCK_FOOT - s.h;
    }
    y += s.dir * STEP_PX;
    x = x < EDGE_PX ? EDGE_PX : x > maxX ? maxX : x;
    y = y < TOP_PX ? TOP_PX : y > maxY ? maxY : y;
    settle(s, x, y);
  }

  return {
    mount(next) {
      beds = next;
      retarget();
    },
    setAnchors(next) {
      anchors = next;
      retarget();
    },
    onState(s) {
      const at = SHOWN.includes(s.phase) ? s.bed : null;
      const tag = narrow.matches && s.phase === 'focus' && s.slot !== null;
      if (tag !== sheet) {
        sheet = tag;
        resized = true;
      }
      group.toggleAttribute('data-shown', at !== null);
      if (at === current) return;
      current = at;
      if (at !== null) retarget();
    },
    sync(rig, force) {
      if (current === null || (narrow.matches && visitor === null) || (!rig.changed && !force && !resized)) return;
      resized = false;
      portrait = visitor !== null && vw / vh < PORTRAIT;
      if (portrait && visitor !== null) figureOf(rig, visitor, figure);
      for (let i = 0; i < signs.length; i++) {
        const s = signs[i];
        if (s === undefined) continue;
        s.dock.on = false;
        if (s.anchor >= 0 && !s.el.hidden) place(s, rig);
      }
      if (portrait) dockPair();
    },
    setVisitor(at) {
      visitor = at;
      group.toggleAttribute('data-roam', true);
      readSafe();
      for (const s of signs) s.stake = createStake(group);
      retarget();
    },
  };
}
