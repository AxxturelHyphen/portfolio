import type { Content, Lang, Machine, Panel, Project, ProjectId } from '../types.ts';

/**
 * The project panel: one native <dialog id="panel"> present from load (cook/ARCH.md 2.10).
 * Desktop: right side, about 40% wide. Mobile: bottom sheet. Layout comes from container queries in panel.css.
 * Two drivers share the same element:
 *  - the garden's `open` channel calls setProgress every frame (inline transform and opacity, CSS transition off);
 *  - the Herbario calls show and hide, and CSS transitions animate transform and opacity. Removing or adding
 *    data-closing mid-way reverses the running transition from where it is.
 * Esc, the close button and a click on the backdrop never close directly: they send BACK, and the state decides.
 */

/** Renders the case of one project (head and body); injected by the composition root so ui stays free of content. */
export type CaseRenderer = (p: Project, lang: Lang, titleId: string) => string;

export interface HerbarioPanel extends Panel {
  show(): void;
  hide(): Promise<void>;
}

const TITLE_ID = 'pn-title';
const STEPS = 100;
const EXIT_TIMEOUT_MS = 1000;

/** Precomputed style strings so setProgress allocates nothing per frame. */
const OPACITY: string[] = [];
const SIDE: string[] = [];
const SHEET: string[] = [];
for (let i = 0; i <= STEPS; i++) {
  const rest = 1 - i / STEPS;
  OPACITY.push(String(i / STEPS));
  SIDE.push(`translate3d(${(rest * 48).toFixed(2)}px, 0, 0)`);
  SHEET.push(`translate3d(0, ${(rest * 100).toFixed(2)}%, 0)`);
}

function settle(el: HTMLElement): Promise<unknown> {
  const running = el.getAnimations().map((a) => a.finished);
  if (running.length === 0) return Promise.resolve();
  return Promise.race([Promise.allSettled(running), new Promise((r) => setTimeout(r, EXIT_TIMEOUT_MS))]);
}

function reveal(img: HTMLImageElement): Promise<void> {
  return img
    .decode()
    .catch(() => undefined)
    .then(() => img.classList.add('is-ready'));
}

export function createPanel(el: HTMLDialogElement, c: Pick<Content, 'projects' | 'strings'>, m: Pick<Machine, 'send' | 'state'>, render: CaseRenderer): HerbarioPanel {
  const sheet = matchMedia('(max-width: 44.99rem)');
  let current: ProjectId | null = null;
  let key = '';
  let ready: Promise<void> = Promise.resolve();

  el.setAttribute('aria-labelledby', TITLE_ID);
  el.addEventListener('cancel', (e) => {
    e.preventDefault();
    m.send({ type: 'BACK' });
  });
  /** The browser may still force a close (repeated Esc): keep the state in step. */
  el.addEventListener('close', () => {
    if (!el.open && m.state.project !== null) m.send({ type: 'BACK' });
  });
  el.addEventListener('click', (e) => {
    const closer = e.target instanceof Element ? e.target.closest('[data-close]') : null;
    if (closer !== null) {
      m.send({ type: 'BACK' });
      return;
    }
    /** The second click of a double click on a sheet lands on the backdrop: it must not undo the open. */
    if (e.target !== el || e.detail > 1) return;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) m.send({ type: 'BACK' });
  });

  function returnFocus(id: ProjectId): void {
    if (document.activeElement !== null && document.activeElement !== document.body) return;
    document.querySelector<HTMLElement>(`#p-${CSS.escape(id)} .h-open`)?.focus({ preventScroll: true });
  }

  const panel: HerbarioPanel = {
    el,
    get current() {
      return current;
    },

    prepare(id: ProjectId, gen: number): Promise<void> {
      const lang = m.state.lang;
      const next = `${id}:${lang}`;
      if (next === key) return ready;
      const p = c.projects.find((x) => x.id === id);
      if (p === undefined) return Promise.resolve();
      key = next;
      current = id;
      const close = c.strings[lang]['panel.close'] ?? 'Close';
      el.innerHTML = `<button type="button" class="pn-close" data-close aria-label="${close}"><span aria-hidden="true">×</span></button><div class="pn-body">${render(p, lang, TITLE_ID)}</div>`;
      el.scrollTop = 0;
      const media = el.querySelectorAll<HTMLImageElement>('img[data-media]');
      media.forEach((img, i) => {
        if (i > 0) img.addEventListener('load', () => void reveal(img), { once: true });
      });
      const first = media[0];
      ready = (first === undefined ? Promise.resolve() : reveal(first)).then(() => {
        if (key === next) m.send({ type: 'PANEL_READY', id, gen });
      });
      return ready;
    },

    setProgress(p: number): void {
      const i = Math.round(Math.min(1, Math.max(0, p)) * STEPS);
      el.dataset.driven = '';
      el.style.opacity = OPACITY[i] ?? '1';
      el.style.transform = (sheet.matches ? SHEET : SIDE)[i] ?? 'none';
    },

    commitOpen(): void {
      if (!el.open) el.showModal();
    },

    commitClosed(): void {
      delete el.dataset.closing;
      if (el.open) el.close();
      const id = current;
      current = null;
      key = '';
      if (id !== null) returnFocus(id);
    },

    show(): void {
      delete el.dataset.closing;
      panel.commitOpen();
    },

    async hide(): Promise<void> {
      if (!el.open) return;
      el.dataset.closing = '';
      await settle(el);
      if (el.dataset.closing !== undefined) panel.commitClosed();
    },
  };
  return panel;
}
