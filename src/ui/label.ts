import { UI } from '../core/motion.ts';
import type { I18n, LabelCard, ScreenPt, SlotView } from '../types.ts';
import './styles/label.css';
import { createMover } from './xform.ts';

/**
 * The plant tag of the focused flower (cook/ART.md section 4, S08): an aged card tag punched at the top centre and
 * tied there with twine to the tip of a zinc rod staked beside the flower. The status, the name, the one-liner and
 * the stack in Kalnia, the Latin name in italic, and "View" as an underlined word.
 * The DOM is built once; show() only sets texts. place() and setProgress() run in stage 'dom' and write transform and
 * opacity through preallocated movers: no layout reads, no allocation. The tag's own size comes from a
 * ResizeObserver and the viewport size from 'resize' events, both outside the frame.
 * Placement: beside the flower on the asked side, clear of its hit ellipse; it flips when that side has no room,
 * and docks inside the viewport (whole pixels) when the flower nears or leaves an edge. Phones: a full-width strip
 * above the bottom edge (CSS), so place() only fades it.
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
const SVG = 'http://www.w3.org/2000/svg';

/**
 * Twine in a 44x44 box: two strands up from the punched hole at (22, 32) over the top edge, three turns round the
 * rod tip at x 22, a knot and two short tails.
 */
const TIE = 'M22 32C18 28 16 23 17 19M22 32C26 28 28 23 27 19M16 19L28 15M16 14L28 10M16 9L28 5M28 5C31 3 33 7 31 11M16 9C13 11 12 16 14 20';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  parent.append(n);
  return n;
}

function tie(parent: Element): void {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'lb-tie');
  svg.setAttribute('viewBox', '0 0 44 44');
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
  const status = node('p', 'lb-status', card);
  const title = node('p', 'lb-title', card);
  const latin = node('p', 'lb-latin', card);
  const oneLiner = node('p', 'lb-oneliner', card);
  const stack = node('p', 'lb-stack', card);
  const view = node('p', 'lb-view', card);
  tie(card);

  const anchor = createMover(el);
  const rise = createMover(card);
  const narrow = matchMedia(NARROW);
  let vw = innerWidth;
  let vh = innerHeight;
  let cw = 300;
  let chh = 180;
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
  }).observe(card);

  return {
    show(v: SlotView): void {
      const p = v.project;
      title.textContent = p?.title ?? v.alt;
      const latinKey = p === undefined ? '' : `flower.${p.flower}.latin`;
      const latinName = latinKey === '' ? latinKey : text.t(latinKey);
      latin.textContent = latinName === latinKey ? '' : latinName;
      latin.hidden = latin.textContent === '';
      oneLiner.textContent = p === undefined ? '' : text.tr(p.oneLiner);
      oneLiner.hidden = p === undefined;
      const words = p?.stack.slice(0, UI.chipsMax) ?? [];
      stack.textContent = words.join(' · ');
      stack.hidden = words.length === 0;
      status.hidden = p === undefined;
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
      anchor.move(Math.round(x < EDGE_PX ? EDGE_PX : x > maxX ? maxX : x), Math.round(y < TOP_PX ? TOP_PX : y > maxY ? maxY : y), 1);
    },

    setProgress(p: number): void {
      const k = p < 0 ? 0 : p > 1 ? 1 : p;
      rise.move(0, (1 - k) * UI.labelRisePx, 1);
      rise.fade(k);
    },

    hide(): void {
      delete el.dataset.shown;
      rise.fade(0);
    },
  };
}
