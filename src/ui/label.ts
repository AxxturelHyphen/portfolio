import { UI } from '../core/motion.ts';
import type { I18n, LabelCard, ScreenPt, SlotView } from '../types.ts';
import './styles/label.css';
import { createMover } from './xform.ts';

/**
 * The plant tag of the focused flower (cook/ART.md section 4, S08): a hand-cut card tag tied with twine to a zinc
 * rod, staked beside the flower. Status with a line glyph of the bloom stage, the name in Kalnia, the Latin name in italic, the
 * one-liner, the stack as stamped words, and "View" with a drawn hand.
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
/** The fixed controls own the top band of the screen. */
const TOP_PX = 76;
const NARROW = '(max-width: 44.99rem)';
const SVG = 'http://www.w3.org/2000/svg';

/** 12 px line glyphs of the bloom stage: a closed bud, a half-open cup, an open flower. */
const GLYPHS: Record<string, string> = {
  idea: 'M6 11V7M6 7C4.2 6 4 3.6 6 1.2C8 3.6 7.8 6 6 7Z',
  wip: 'M6 11V7.5M6 7.5C3.6 7.5 2.4 5.6 2.6 3C4 3.6 5.2 4.6 6 6C6.8 4.6 8 3.6 9.4 3C9.6 5.6 8.4 7.5 6 7.5ZM6 6V2',
  shipped: 'M6 11V8M6 8A1.6 1.6 0 1 0 6 4.8A1.6 1.6 0 1 0 6 8ZM6 4.8V1.4M7.6 6.4H10.8M4.4 6.4H1.2M7.2 5.2L9.6 2.8M4.8 5.2L2.4 2.8',
};

/** Twine in a 44x44 box: two strands from the punched hole at (22, 4), three turns round the rod at x 22, two tails. */
const TIE = 'M22 4C18 8 16 13 17 17M22 4C26 8 28 13 27 17M16 17L28 21M16 22L28 26M16 27L28 31M28 31C31 34 32 38 29 42M28 26C32 28 35 32 34 37';

const HAND = 'M1 9.5H12.5M12.5 9.5C14 9.5 14 7 12.5 7H8.5L10 5.2C10.6 4.4 9.6 3.4 8.8 4L4.8 7.4C4.2 7.9 3.6 8.2 3 8.2H1M12.5 9.5C14 9.5 14 12 12.5 12H11.5C12.9 12 12.9 14.3 11.5 14.3H10.5C11.8 14.3 11.8 16.4 10.5 16.4H5C3.8 16.4 3.2 15.8 1 15.8';

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

function glyph(parent: Element, cls: string, box: string): SVGPathElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', box);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  svg.append(path);
  parent.append(svg);
  return path;
}

export function createLabel(el: HTMLElement, text: LabelText): LabelCard {
  el.setAttribute('aria-hidden', 'true');
  const card = node('div', 'lb', el);
  card.id = LABEL_ID;
  const status = node('p', 'lb-status', card);
  const stage = glyph(status, 'lb-glyph', '0 0 12 12');
  const statusText = node('span', 'lb-status-text', status);
  const title = node('p', 'lb-title', card);
  const latin = node('p', 'lb-latin', card);
  const oneLiner = node('p', 'lb-oneliner', card);
  const stack = node('p', 'lb-stack', card);
  const view = node('p', 'lb-view', card);
  const viewText = node('span', 'lb-view-text', view);
  glyph(view, 'lb-hand', '0 0 15 17').setAttribute('d', HAND);
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
      stage.setAttribute('d', p === undefined ? '' : (GLYPHS[p.status] ?? ''));
      statusText.textContent = p === undefined ? '' : text.t(`status.${p.status}`);
      viewText.textContent = v.kind === 'project' ? text.t('label.view') : '';
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
