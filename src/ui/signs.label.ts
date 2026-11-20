import { MANICULE } from '../core/manicule.ts';
import type { BedId, Machine } from '../types.ts';
import { createMover, type Mover } from './xform.ts';

/**
 * One signpost button (ui/signposts.ts): on the rail the painted label with its cane, twine lashing, lettered name and
 * manicule; under free roam the transparent target over a plank in the world. Plus the per-sign state the placing
 * reads and writes. A board button (makeBoard) covers a plank of another place under free roam: pointer and touch
 * only, out of the Tab order, and a press on it leaves the focus where it was.
 */

const SVG = 'http://www.w3.org/2000/svg';
/** Twine lashing the label to the cane: two turns round the cane over the label's top edge, a knot and a tail. */
const LASH = 'M3 10l18-5M3 16l18-5M21 5c3-.6 4 1.6 2.4 3.4M21 11c3 .4 3.4 4 1 7.5';

export interface Sign {
  el: HTMLButtonElement;
  name: HTMLSpanElement;
  mover: Mover;
  dir: -1 | 1;
  to: BedId | 'cv' | null;
  /** Index into the sign anchors, or -1 when docked. */
  anchor: number;
  w: number;
  h: number;
  /** Cosine and sine of the label's CSS tilt (rail). */
  cos: number;
  sin: number;
  /** Free roam: the board is off screen. */
  off: boolean;
  /** Free roam: the least scale of the button, so it never shrinks under a tap target. */
  least: number;
}

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

/** Letters the button for where it leads: the name, and the bed and spoken name of a bed (the CV button says its name). */
export function letter(s: Sign, title: string, go: string): void {
  s.name.textContent = title;
  if (s.to === 'cv' || s.to === null) {
    delete s.el.dataset.bed;
    s.el.removeAttribute('aria-label');
  } else {
    s.el.dataset.bed = s.to;
    s.el.setAttribute('aria-label', `${go} ${title}`);
  }
}

/** Free roam: the button over board `anchor` of another place, leading `to`. */
export function makeBoard(anchor: number, to: BedId | 'cv', m: Machine): Sign {
  const s = makeSign(1, m);
  delete s.el.dataset.dir;
  s.el.dataset.board = '';
  s.el.tabIndex = -1;
  s.el.hidden = true;
  s.el.addEventListener('mousedown', (e) => e.preventDefault());
  s.anchor = anchor;
  s.to = to;
  s.off = true;
  return s;
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
  el.append(cane, drawing('px-sign-lash', '0 0 26 26', LASH), name, drawing('px-sign-hand', '0 0 48 24', MANICULE));
  const sign: Sign = { el, name, mover: createMover(el), dir, to: null, anchor: -1, w: 140, h: 44, cos: 1, sin: 0, off: false, least: 1 };
  el.addEventListener('click', () => {
    if (sign.to === 'cv') m.send({ type: 'SET_MODE', mode: 'herbario' });
    else if (sign.to !== null) m.send({ type: 'GOTO', place: { k: 'bed', bed: sign.to } });
  });
  return sign;
}
