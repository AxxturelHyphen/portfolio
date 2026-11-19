import { panelOf } from '../core/motion.ts';
import type { Content, Lang, Machine, Panel, Project, ProjectId, State } from '../types.ts';
import { motionOf } from './reel.model.ts';
import type { Reel } from './reel.ts';
import { bindToggles, isPending, paintMode, renderToggles } from './toggles.ts';

/**
 * The project panel, drawn as the field notebook of cook/ART.md section 4: one native <dialog id="panel"> present
 * from load (cook/ARCH.md 2.10). The dialog itself is a transparent full-viewport layer; its .pn-page is the notebook
 * page (desktop: right side, about 40 % wide; mobile: a bottom sheet bound along the top) and the only thing that
 * moves. Layout comes from container queries in panel.css.
 * The panel subscribes to the machine and only follows it:
 *  - garden: shown while the phase is opening or inspect. The `open` channel drives it every frame through
 *    setProgress (panelOf: transform and opacity inline, CSS transitions off); close() when 'closing' has settled.
 *  - herbario: shown while the intent is a project. CSS transitions animate transform and opacity; leaving the
 *    project runs the exit while the dialog is still in the top layer, and close() follows it.
 * Its bar repeats the fixed controls at their own spot (the modal would otherwise make them inert). The page's
 * ribbon bookmark is the "Close" button. Esc, the ribbon and a click beside the page never close directly: they send
 * CLOSE (BACK when no project is the intent), and the state decides. Sections fade up once the page shows.
 * Over the garden the case carries the project's film (ui/reel.ts, a lazy chunk fetched when a flower is first
 * focused) under its head, and the media list is left to it; over the Herbario the case is unchanged.
 */

/** Renders the case of one project (head and body); injected by the composition root so ui stays free of content.
 * `media` false leaves the media section out (the film shows the media instead). */
export type CaseRenderer = (p: Project, lang: Lang, titleId: string, media: boolean) => string;

/** What the film needs from the composition root. */
export interface FilmSource {
  /** Frozen time (?t=) or a still (?shot=): the film holds its first frame and nothing moves. */
  still: boolean;
  /** The project's flower cutout url, or null. */
  flowerOf(id: ProjectId): string | null;
}

type ReelModule = typeof import('./reel.ts');
let reelChunk: Promise<ReelModule | null> | null = null;
const loadReel = (): Promise<ReelModule | null> => (reelChunk ??= import('./reel.ts').catch(() => {
  reelChunk = null;
  return null;
}));

const TITLE_ID = 'pn-title';
const STEPS = 100;
const EXIT_TIMEOUT_MS = 1000;
/** The panel shows after this even if the film's flower or first frame has not decoded yet. */
const FILM_WAIT_MS = 1500;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** From this step of setProgress the sections fade up (once per opening). */
const UNFOLD_STEP = 50;

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

export function createPanel(el: HTMLDialogElement, c: Pick<Content, 'projects' | 'strings' | 'profile'>, m: Machine, render: CaseRenderer, film: FilmSource | null = null): Panel {
  const sheet = matchMedia('(max-width: 44.99rem)');
  let current: ProjectId | null = null;
  let key = '';
  let ready: Promise<void> = Promise.resolve();
  let readyGen = -1;
  let shownStep = -1;
  let selfClosed = false;
  let reel: Reel | null = null;
  /** Bumped whenever the film is dropped: a mount still waiting for the chunk then lets go. */
  let mountGen = 0;
  const keyOf = (id: ProjectId, s: State): string => `${id}:${s.lang}:${s.mode}:${s.reduced ? 1 : 0}`;

  el.setAttribute('aria-labelledby', TITLE_ID);
  const barEl = document.createElement('div');
  barEl.className = 'pn-bar';
  const page = document.createElement('div');
  page.className = 'pn-page';
  const closeEl = document.createElement('button');
  closeEl.type = 'button';
  closeEl.className = 'pn-close';
  closeEl.dataset.close = '';
  const body = document.createElement('div');
  body.className = 'pn-body';
  page.append(closeEl, body);
  el.replaceChildren(barEl, page);
  bindToggles(barEl, m);

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
    /** Beside the page is the dialog itself. The second click of a double click must not undo the open. */
    if (e.target === el && e.detail <= 1) leave();
  });

  function clearDriven(): void {
    delete el.dataset.driven;
    delete el.dataset.unfold;
    page.style.removeProperty('opacity');
    page.style.removeProperty('transform');
    shownStep = -1;
  }

  function dropReel(): void {
    mountGen++;
    reel?.dispose();
    reel = null;
  }

  /** Paints the case and wires its media list; resolves when the first listed picture shows. */
  function paintCase(p: Project, lang: Lang, withMedia: boolean): Promise<void> {
    body.innerHTML = render(p, lang, TITLE_ID, withMedia);
    const media = el.querySelectorAll<HTMLImageElement>('img[data-media]');
    media.forEach((img, i) => {
      if (i > 0) img.addEventListener('load', () => void reveal(img), { once: true });
    });
    const first = media[0];
    return first === undefined ? Promise.resolve() : reveal(first);
  }

  /** The film under the case head; resolves when its flower and first frame are decoded. Without the chunk the case
   * gets its media list back instead. */
  async function mountReel(p: Project, lang: Lang, forKey: string): Promise<void> {
    if (film === null) return;
    const gen = mountGen;
    const mod = await loadReel();
    if (gen !== mountGen || key !== forKey) return;
    if (mod === null) {
      await paintCase(p, lang, true);
      return;
    }
    const s = (k: string): string => c.strings[lang][k] ?? k;
    const next = mod.createReel({ project: p, lang, s, flower: film.flowerOf(p.id), motion: motionOf(m.state.reduced, film.still) });
    reel?.dispose();
    body.querySelector('.c-head')?.after(next.el);
    reel = next;
    showReel(m.state);
    await next.ready;
  }

  function showReel(s: State): void {
    reel?.setShown(s.mode === 'garden' && s.phase === 'inspect' && el.open);
  }

  function paintChrome(lang: Lang): void {
    barEl.innerHTML = renderToggles(c.strings, lang, c.profile.cv, 'pn');
    closeEl.textContent = c.strings[lang]['panel.close'] ?? 'Close';
  }

  const panel: Panel = {
    el,
    get current() {
      return current;
    },

    prepare(id: ProjectId, gen: number): Promise<void> {
      const lang = m.state.lang;
      const next = keyOf(id, m.state);
      const withFilm = film !== null && m.state.mode === 'garden';
      readyGen = gen;
      if (next !== key) {
        const p = c.projects.find((x) => x.id === id);
        if (p === undefined) return Promise.resolve();
        const hadFocus = el.open && el.contains(document.activeElement);
        key = next;
        current = id;
        paintChrome(lang);
        dropReel();
        const shown = paintCase(p, lang, !withFilm);
        if (hadFocus) el.querySelector<HTMLElement>(`#${TITLE_ID}`)?.focus({ preventScroll: true });
        paintMode(barEl, m.state.mode, isPending(m.state), c.strings, lang);
        page.scrollTop = 0;
        ready = withFilm ? Promise.race([Promise.all([shown, mountReel(p, lang, next)]).then(() => undefined), wait(FILM_WAIT_MS)]) : shown;
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
      if (i >= UNFOLD_STEP) el.dataset.unfold = '';
      else if (i === 0) delete el.dataset.unfold;
      page.style.opacity = OPACITY[i] ?? '1';
      page.style.transform = (sheet.matches ? SHEET : SIDE)[i] ?? 'none';
    },

    commitOpen(): void {
      delete el.dataset.closing;
      if (el.open) return;
      if (m.state.mode === 'garden') panel.setProgress(panelOf(m.ch.open.value));
      el.showModal();
      el.querySelector<HTMLElement>(`#${TITLE_ID}`)?.focus({ preventScroll: true });
      showReel(m.state);
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
      dropReel();
      if (id !== null) returnFocus(id);
    },
  };

  async function hide(): Promise<void> {
    el.dataset.closing = '';
    await settle(page);
    if (el.dataset.closing !== undefined && wanted(m.state) === null) panel.commitClosed();
  }

  function reconcile(s: State): void {
    const id = wanted(s);
    if (id !== null) {
      if (key !== keyOf(id, s) || readyGen !== s.gen) void panel.prepare(id, s.gen);
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
      paintMode(barEl, s.mode, isPending(s), c.strings, s.lang);
    } else if (s.gardenReady !== prev.gardenReady) {
      paintMode(barEl, s.mode, isPending(s), c.strings, s.lang);
    }
    if (film !== null && s.mode === 'garden' && s.phase === 'focus') void loadReel();
    reconcile(s);
    showReel(s);
  });
  reconcile(m.state);
  return panel;
}
