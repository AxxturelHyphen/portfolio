import { panelOf } from '../core/motion.ts';
import type { Content, Lang, Machine, Panel, Project, ProjectId, State } from '../types.ts';
import { bindToggles, isPending, paintMode, renderToggles } from './toggles.ts';

/**
 * The project panel: one native <dialog id="panel"> present from load (cook/ARCH.md 2.10). Desktop: right side,
 * about 40 % wide. Mobile: bottom sheet. Layout comes from container queries in panel.css.
 * The panel subscribes to the machine and only follows it:
 *  - garden: shown while the phase is opening or inspect. The `open` channel drives it every frame through
 *    setProgress (panelOf: transform and opacity inline, CSS transitions off); close() when 'closing' has settled.
 *  - herbario: shown while the intent is a project. CSS transitions animate transform and opacity; leaving the
 *    project runs the exit while the dialog is still in the top layer, and close() follows it.
 * Its header bar repeats the mode toggle, Download CV and language, which the modal would otherwise make inert.
 * Esc, the close button and a click on the backdrop never close directly: they send CLOSE (BACK when no project is
 * the intent), and the state decides.
 */

/** Renders the case of one project (head and body); injected by the composition root so ui stays free of content. */
export type CaseRenderer = (p: Project, lang: Lang, titleId: string) => string;

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

/** The project the panel should show for this state, or null. */
function wanted(s: State): ProjectId | null {
  if (s.mode === 'herbario') return s.intent.k === 'project' ? s.intent.id : null;
  return s.phase === 'opening' || s.phase === 'inspect' ? s.project : null;
}

/** Focus goes back to what opened the project when the browser could not restore it (the opener was re-rendered). */
function returnFocus(id: ProjectId): void {
  if (document.activeElement !== null && document.activeElement !== document.body) return;
  const sel = `#p-${CSS.escape(id)} .h-open, #proxies [data-project="${CSS.escape(id)}"]`;
  document.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
}

export function createPanel(el: HTMLDialogElement, c: Pick<Content, 'projects' | 'strings' | 'profile'>, m: Machine, render: CaseRenderer): Panel {
  const sheet = matchMedia('(max-width: 44.99rem)');
  let current: ProjectId | null = null;
  let key = '';
  let ready: Promise<void> = Promise.resolve();
  let readyGen = -1;
  let shownStep = -1;
  let selfClosed = false;

  el.setAttribute('aria-labelledby', TITLE_ID);
  bindToggles(el, m);

  const leave = (): void => m.send(m.state.intent.k === 'project' ? { type: 'CLOSE' } : { type: 'BACK' });

  el.addEventListener('cancel', (e) => {
    e.preventDefault();
    leave();
  });
  /** The browser may still force a close (repeated Esc): keep the state in step. */
  el.addEventListener('close', () => {
    const forced = !selfClosed;
    selfClosed = false;
    if (forced && !el.open && m.state.intent.k === 'project') m.send({ type: 'CLOSE' });
  });
  el.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('[data-close]') !== null) {
      leave();
      return;
    }
    /** The second click of a double click on a sheet lands on the backdrop: it must not undo the open. */
    if (e.target !== el || e.detail > 1) return;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) leave();
  });

  function clearDriven(): void {
    delete el.dataset.driven;
    el.style.removeProperty('opacity');
    el.style.removeProperty('transform');
    shownStep = -1;
  }

  function bar(lang: Lang): string {
    const close = c.strings[lang]['panel.close'] ?? 'Close';
    return `<header class="pn-bar">${renderToggles(c.strings, lang, c.profile.cv, 'pn')}<button type="button" class="pn-close" data-close aria-label="${close}"><span aria-hidden="true">×</span></button></header>`;
  }

  const panel: Panel = {
    el,
    get current() {
      return current;
    },

    prepare(id: ProjectId, gen: number): Promise<void> {
      const lang = m.state.lang;
      const next = `${id}:${lang}`;
      readyGen = gen;
      if (next !== key) {
        const p = c.projects.find((x) => x.id === id);
        if (p === undefined) return Promise.resolve();
        const hadFocus = el.open && el.contains(document.activeElement);
        key = next;
        current = id;
        el.innerHTML = `${bar(lang)}<div class="pn-body">${render(p, lang, TITLE_ID)}</div>`;
        if (hadFocus) el.querySelector<HTMLElement>(`#${TITLE_ID}`)?.focus({ preventScroll: true });
        paintMode(el, m.state.mode, isPending(m.state), c.strings, lang);
        el.scrollTop = 0;
        const media = el.querySelectorAll<HTMLImageElement>('img[data-media]');
        media.forEach((img, i) => {
          if (i > 0) img.addEventListener('load', () => void reveal(img), { once: true });
        });
        const first = media[0];
        ready = first === undefined ? Promise.resolve() : reveal(first);
      }
      /** Repeat calls share one promise; PANEL_READY always carries the newest gen asked for. */
      return ready.then(() => {
        if (key === next) m.send({ type: 'PANEL_READY', id, gen: readyGen });
      });
    },

    setProgress(p: number): void {
      if (m.state.mode === 'herbario') return;
      const i = Math.round((p < 0 ? 0 : p > 1 ? 1 : p) * STEPS);
      if (el.dataset.driven === undefined) el.dataset.driven = '';
      if (i === shownStep) return;
      shownStep = i;
      el.style.opacity = OPACITY[i] ?? '1';
      el.style.transform = (sheet.matches ? SHEET : SIDE)[i] ?? 'none';
    },

    commitOpen(): void {
      delete el.dataset.closing;
      if (el.open) return;
      if (m.state.mode === 'garden') panel.setProgress(panelOf(m.ch.open.value));
      el.showModal();
      el.querySelector<HTMLElement>(`#${TITLE_ID}`)?.focus({ preventScroll: true });
    },

    commitClosed(): void {
      delete el.dataset.closing;
      if (el.open) {
        selfClosed = true;
        el.close();
      }
      const id = current;
      current = null;
      key = '';
      if (id !== null) returnFocus(id);
    },
  };

  async function hide(): Promise<void> {
    el.dataset.closing = '';
    await settle(el);
    if (el.dataset.closing !== undefined && wanted(m.state) === null) panel.commitClosed();
  }

  function reconcile(s: State): void {
    const id = wanted(s);
    if (id !== null) {
      if (key !== `${id}:${s.lang}` || readyGen !== s.gen) void panel.prepare(id, s.gen);
      panel.commitOpen();
      return;
    }
    if (!el.open) return;
    /** Garden: the channel runs the exit; close() waits until 'closing' has settled into another phase. */
    if (s.mode === 'garden' && s.phase === 'closing') {
      el.dataset.closing = '';
      return;
    }
    /** Garden: the channel has already faded the panel out, so the dialog closes on the same frame. */
    if (s.mode === 'garden' && el.dataset.driven !== undefined) {
      panel.commitClosed();
      return;
    }
    void hide();
  }

  m.subscribe((s, prev) => {
    if (s.mode !== prev.mode) {
      if (s.mode === 'herbario') clearDriven();
      paintMode(el, s.mode, isPending(s), c.strings, s.lang);
    } else if (s.gardenReady !== prev.gardenReady) {
      paintMode(el, s.mode, isPending(s), c.strings, s.lang);
    }
    reconcile(s);
  });
  reconcile(m.state);
  return panel;
}
