import { UI } from '../core/motion.ts';
import type { I18n, LabelCard, ScreenPt, SlotView } from '../types.ts';
import './styles/label.css';
import { createMover } from './xform.ts';

/**
 * The label card beside a focused flower, like an old botanical garden label (spec sections 7 and 8): name in the
 * display serif, Latin name in italic, one-liner, up to 3 stack chips, status and "View".
 * The DOM skeleton is built once; show() only sets texts. place() and setProgress() run in stage 'dom' and write
 * transform and opacity through preallocated movers: no layout reads, no allocation.
 * The card is not interactive and is hidden from assistive tech: the proxy button carries the name and points at the
 * card with aria-describedby, and a click on the flower is the "View".
 */

export interface LabelText {
  t(key: string): string;
  tr(v: I18n): string;
}

export const LABEL_ID = 'label-card';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  parent.append(n);
  return n;
}

export function createLabel(el: HTMLElement, text: LabelText): LabelCard {
  el.setAttribute('aria-hidden', 'true');
  const card = node('div', 'lb', el);
  card.id = LABEL_ID;
  const title = node('p', 'lb-title', card);
  const latin = node('p', 'lb-latin', card);
  const oneLiner = node('p', 'lb-oneliner', card);
  const chips = node('ul', 'lb-chips', card);
  const chipItems: HTMLLIElement[] = [];
  for (let i = 0; i < UI.chipsMax; i++) chipItems.push(node('li', 'lb-chip', chips));
  const foot = node('p', 'lb-foot', card);
  const status = node('span', 'lb-status c-status', foot);
  const view = node('span', 'lb-view', foot);

  const anchor = createMover(el);
  const rise = createMover(card);
  let side: 'left' | 'right' | null = null;

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
      const stack = p?.stack ?? [];
      for (let i = 0; i < chipItems.length; i++) {
        const li = chipItems[i];
        if (li === undefined) continue;
        li.textContent = stack[i] ?? '';
        li.hidden = stack[i] === undefined;
      }
      chips.hidden = stack.length === 0;
      if (p === undefined) delete status.dataset.status;
      else status.dataset.status = p.status;
      status.textContent = p === undefined ? '' : text.t(`status.${p.status}`);
      view.textContent = v.kind === 'project' ? text.t('label.view') : '';
      foot.hidden = p === undefined;
      el.dataset.kind = v.kind;
      el.dataset.shown = '';
    },

    place(pt: ScreenPt, s: 'left' | 'right'): void {
      if (s !== side) {
        side = s;
        el.dataset.side = s;
      }
      anchor.move(pt.x, pt.y, 1);
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
