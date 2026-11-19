import type { BedId, Machine } from '../types.ts';
import { covers, meetsCover } from './cover.ts';
import type { DockBox } from './signs.dock.ts';
import type { FigureBox, Stake } from './signs.stake.ts';
import { createMover, type Mover } from './xform.ts';

/**
 * One signpost label (ui/signposts.ts): the <button> with its cane, twine lashing, lettered name and manicule, and the
 * per-label state the placing reads and writes.
 */

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

export interface Sign {
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
  /** Free roam: the label's screen box as last placed (px), for the covers. */
  box: FigureBox;
  /** Free roam: hidden whole but still focusable (no room, or under the open tag or plan). */
  tucked: boolean;
  /** Free roam: the whole box as laid out (label turned by its tilt, twine curl included) and how far the curl reaches
   * past the label's left and top edges (px), measured per name and language (measureWhole). */
  whole: Whole;
  lash: SVGSVGElement;
}

export interface Whole { w: number; h: number; l: number; t: number }

/** Whole boxes measured so far, by language, destination and name: a name is laid out and measured once. */
const wholes = new Map<string, Whole>();

/**
 * Reads the label's whole box from layout (the turned label and its twine curl), cached under `key`; `fresh` measures
 * again (a new size from the ResizeObserver, fonts in). Never per frame: on a retarget or a size change only.
 */
export function measureWhole(s: Sign, key: string, fresh: boolean): void {
  const known = fresh ? undefined : wholes.get(key);
  if (known !== undefined) {
    s.whole = known;
    return;
  }
  const a = s.el.getBoundingClientRect();
  const b = s.lash.getBoundingClientRect();
  const l = Math.min(a.left, b.left);
  const t = Math.min(a.top, b.top);
  const w: Whole = { w: Math.ceil(Math.max(a.right, b.right) - l), h: Math.ceil(Math.max(a.bottom, b.bottom) - t), l: a.left - l, t: a.top - t };
  if (w.w > 0 && w.h > 0) wholes.set(key, w);
  s.whole = w;
}

/** Hides a label whole (it keeps its place in the Tab order and the accessibility tree) or shows it again. */
export function tuck(s: Sign, on: boolean): void {
  if (on === s.tucked) return;
  s.tucked = on;
  s.el.toggleAttribute('data-tucked', on);
}

export const coveredBy = (s: Sign): boolean => {
  const b = s.box;
  return meetsCover(covers.card, b.l, b.t, b.r, b.b) || meetsCover(covers.rod, b.l, b.t, b.r, b.b) || meetsCover(covers.plan, b.l, b.t, b.r, b.b);
};

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
export function readTilt(s: Sign): void {
  const rad = (Number.parseFloat(getComputedStyle(s.el).rotate) || 0) * (Math.PI / 180);
  s.cos = Math.cos(rad);
  s.sin = Math.sin(rad);
}

export function makeSign(dir: -1 | 1, m: Machine): Sign {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'px-bed px-sign';
  el.dataset.dir = dir < 0 ? 'prev' : 'next';
  const name = document.createElement('span');
  name.className = 'px-sign-name';
  const cane = document.createElement('span');
  cane.className = 'px-sign-cane';
  cane.setAttribute('aria-hidden', 'true');
  const lash = drawing('px-sign-lash', '0 0 26 26', LASH);
  el.append(cane, lash, name, drawing('px-sign-hand', '0 0 48 24', HAND));
  const sign: Sign = { el, name, mover: createMover(el), dir, to: null, anchor: -1, w: 140, h: 44, cos: 1, sin: 0, stake: null, off: false, dock: { w: 0, h: 0, x: 0, y: 0, on: false },
    box: { l: 0, t: 0, r: 0, b: 0 }, tucked: false, whole: { w: 0, h: 0, l: 0, t: 0 }, lash };
  el.addEventListener('click', () => {
    if (sign.to === 'cv') m.send({ type: 'SET_MODE', mode: 'herbario' });
    else if (sign.to !== null) m.send({ type: 'GOTO', place: { k: 'bed', bed: sign.to } });
  });
  return sign;
}

