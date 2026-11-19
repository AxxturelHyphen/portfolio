import { blank, onlyFill } from '../content/herbario/html.ts';
import { UI } from '../core/motion.ts';
import type { I18n, LabelCard, ScreenPt, SlotView } from '../types.ts';
import { clearCover, covers, setCover } from './cover.ts';
import './styles/label.css';
import { createMover } from './xform.ts';

/**
 * The plant tag of the focused flower (cook/ART.md section 4, S08): an aged card tag with a reinforced eyelet at the
 * top centre, tied there with twine to a zinc rod that runs down behind it into the soil. The name, the one-liner and
 * the stack (a plain comma list) in Kalnia, the Latin name in italic, "View" as an inked line in the tag's ink over a
 * hand-ruled stroke, and the status as a small rubber stamp set askew in the bottom corner.
 * Owner gaps read as in the panel (content/herbario/case.ts BLANK_GAPS): a quiet blank without its note, a field that
 * is nothing but a gap left out. The DOM is built once; show() only sets texts. place() and setProgress() run in stage 'dom' and write transform and
 * opacity through preallocated movers: no layout reads, no allocation. The tag's own size comes from a
 * ResizeObserver and the viewport size from 'resize' events, both outside the frame.
 * Placement: beside the flower on the asked side, clear of its hit ellipse; it flips when that side has no room,
 * and docks inside the viewport (whole pixels) when the flower nears or leaves an edge. Phones: a full-width strip
 * above the bottom edge (CSS), so place() only fades it.
 * The box it takes over the garden is written to ui/cover.ts on every place(), so the cane labels keep clear of it.
 * The tag is not interactive and is hidden from assistive tech: the proxy button carries the name and points at it
 * with aria-describedby, and a click on the flower is the "View".
 */

export interface LabelText {
  t(key: string): string;
  tr(v: I18n): string;
}

export const LABEL_ID = 'label-card';

/** Space between the flower's hit ellipse and the tag, and the margin the tag keeps from the viewport edges. */
const GAP_PX = 18;
const EDGE_PX = 16;
/** The fixed controls own the top band of the screen; the rod tip and the tie stand above the tag. */
const TOP_PX = 96;
const NARROW = '(max-width: 44.99rem)';
/** What the tag takes over the garden (ui/cover.ts): the rod's tip and tie above it, a little room round it, the rod. */
const ROD_TIP_PX = 34;
const COVER_PAD_PX = 4;
const ROD_HALF_PX = 4;
const SVG = 'http://www.w3.org/2000/svg';

/**
 * Twine in a 44x60 box: the loop rising from the eyelet at (22, 48) on either side of the rod (x 19 to 25), two turns
 * round the rod below its tip, a knot on the right and two tails falling from it.
 */
const TIE = 'M21 47C19 38 18.5 28 19 19M23 47C25 38 25.5 28 25 19M17.5 18.5L26.5 15M17.5 13L26.5 9.5'
  + 'M26.5 9.5C29.5 9 30.5 11.5 29 13.5C31 17 32.5 22 31.5 28M29 13.5C30 17 29 21 27.5 25';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  parent.append(n);
  return n;
}

function tie(parent: Element): void {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'lb-tie');
  svg.setAttribute('viewBox', '0 0 44 60');
  svg.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 2; i += 1) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', TIE);
    svg.append(path);
  }
  parent.append(svg);
}

export function createLabel(el: HTMLElement, text: LabelText): LabelCard {
  el.setAttribute('aria-hidden', 'true');
  const card = node('div', 'lb', el);
  card.id = LABEL_ID;
  const title = node('p', 'lb-title', card);
  const latin = node('p', 'lb-latin', card);
  const oneLiner = node('p', 'lb-oneliner', card);
  const stack = node('p', 'lb-stack', card);
  const view = node('p', 'lb-view', card);
  const status = node('p', 'lb-status', card);
  tie(card);

  const anchor = createMover(el);
  const rise = createMover(card);
  const narrow = matchMedia(NARROW);
  let vw = innerWidth;
  let vh = innerHeight;
  let cw = 300;
  let chh = 180;
  /** Phones: the sheet's distance from the bottom edge (its CSS bottom, safe area included). */
  let sheetBottom = 10;
  let reach = 0;
  let side: 'left' | 'right' | null = null;

  addEventListener('resize', () => {
    vw = innerWidth;
    vh = innerHeight;
  }, { passive: true });
  new ResizeObserver((entries) => {
    const box = entries[0]?.borderBoxSize[0];
    if (box === undefined) return;
    cw = box.inlineSize;
    chh = box.blockSize;
    sheetBottom = Number.parseFloat(getComputedStyle(card).bottom) || sheetBottom;
  }).observe(card);

  return {
    show(v: SlotView): void {
      const p = v.project;
      title.textContent = p?.title ?? v.alt;
      const latinKey = p === undefined ? '' : `flower.${p.flower}.latin`;
      const latinName = latinKey === '' ? latinKey : text.t(latinKey);
      latin.textContent = latinName === latinKey ? '' : latinName;
      latin.hidden = latin.textContent === '';
      const line = p === undefined ? '' : text.tr(p.oneLiner);
      oneLiner.innerHTML = blank(line);
      oneLiner.hidden = line === '' || onlyFill(line);
      const words = p?.stack.filter((w) => !onlyFill(w)).slice(0, UI.chipsMax) ?? [];
      stack.innerHTML = words.map(blank).join(', ');
      stack.hidden = words.length === 0;
      status.hidden = p === undefined;
      if (p !== undefined) status.dataset.status = p.status;
      status.textContent = p === undefined ? '' : text.t(`status.${p.status}`);
      view.textContent = v.kind === 'project' ? text.t('label.view') : '';
      view.hidden = v.kind !== 'project';
      reach = Math.max(v.hit[0], v.hit[1]) / 2;
      el.dataset.kind = v.kind;
      el.dataset.shown = '';
    },

    place(pt: ScreenPt, asked: 'left' | 'right'): void {
      if (narrow.matches) {
        anchor.move(0, 0, 1);
        setCover(covers.card, 0, vh - sheetBottom - chh, vw, vh);
        return;
      }
      const clear = reach * pt.scale + GAP_PX;
      const roomRight = vw - EDGE_PX - (pt.x + clear);
      const roomLeft = pt.x - clear - EDGE_PX;
      let s = asked;
      if (s === 'right' && roomRight < cw && roomLeft > roomRight) s = 'left';
      else if (s === 'left' && roomLeft < cw && roomRight > roomLeft) s = 'right';
      if (s !== side) {
        side = s;
        el.dataset.side = s;
      }
      const x = s === 'right' ? pt.x + clear : pt.x - clear - cw;
      const y = pt.y - chh / 2;
      const maxX = vw - EDGE_PX - cw;
      const maxY = vh - EDGE_PX - chh;
      const left = Math.round(x < EDGE_PX ? EDGE_PX : x > maxX ? maxX : x);
      const top = Math.round(y < TOP_PX ? TOP_PX : y > maxY ? maxY : y);
      anchor.move(left, top, 1);
      setCover(covers.card, left - COVER_PAD_PX, top - ROD_TIP_PX, left + cw + COVER_PAD_PX, top + chh + COVER_PAD_PX);
      setCover(covers.rod, left + cw / 2 - ROD_HALF_PX, top + chh, left + cw / 2 + ROD_HALF_PX, vh);
    },

    setProgress(p: number): void {
      const k = p < 0 ? 0 : p > 1 ? 1 : p;
      rise.move(0, (1 - k) * UI.labelRisePx, 1);
      rise.fade(k);
    },

    hide(): void {
      delete el.dataset.shown;
      rise.fade(0);
      clearCover(covers.card);
      clearCover(covers.rod);
    },
  };
}
