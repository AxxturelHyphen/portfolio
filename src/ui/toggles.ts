import type { Lang, Machine, Mode, State, Strings, Toggles } from '../types.ts';
import { uiText } from './copy.ts';

/**
 * The three fixed controls, top right in every mode (cook/ART.md section 4): language, Download CV, and one way-out
 * button that leads to the other mode ("Exit" in the garden, named "Exit to the CV album" and showing a short hint on
 * hover and focus; "Enter the garden" in the Herbario). Text-first plant labels hung on a short wire: japanned zinc
 * in the garden, ink on paper in the Herbario. The panel renders the same controls in its dialog (renderToggles with its own id prefix, bound
 * with bindToggles) at the same spot, so they stay usable while the modal makes the rest of the page inert.
 * renderToggles is pure (scripts/prerender.ts puts it in index.html, so the controls exist without JS): there the
 * garden button is disabled, because without JS there is no garden.
 * The way-out button carries the mode it leads to in data-mode. "Enter the garden" is live wherever WebGL2 exists:
 * the machine keeps it pending until the garden is ready (data-pending, aria-busy). Without WebGL2, or once the
 * garden broke, it is disabled with its note.
 */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ESC[ch] ?? ch);
const LANGS: readonly Lang[] = ['en', 'es'];
/** False without WebGL2, or once the garden broke on this visit (disableGarden). */
let canGarden = typeof WebGL2RenderingContext === 'function';

/** The garden started and failed (or probed too slow): the offer is disabled for the rest of the visit. */
export function disableGarden(): void {
  canGarden = false;
}

export function renderToggles(strings: Strings, lang: Lang, cv: string, prefix = 'tg'): string {
  const s = (key: string): string => esc(uiText(strings, lang, key));
  const note = `${prefix}-note`;
  const langs = LANGS.map(
    (l) => `<a class="tg-lang-link" href="?lang=${l}" hreflang="${l}" lang="${l}" data-lang="${l}"${l === lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`,
  ).join('');
  return `<nav class="tg" aria-label="${s('nav.controls')}" data-label-key="nav.controls">
<div class="tg-plate tg-lang" role="group" aria-label="${s('nav.lang')}" data-label-key="nav.lang">${langs}</div>
<a class="tg-cv" href="${esc(cv)}" download aria-label="${s('cv.download')}" data-label-key="cv.download"><span class="tg-long" data-key="cv.download">${s('cv.download')}</span><span class="tg-short" aria-hidden="true" data-key="cv.short">${s('cv.short')}</span></a>
<div class="tg-mode">
<button type="button" class="tg-exit" data-mode="garden" aria-disabled="true" aria-describedby="${note}">${s('mode.garden')}</button>
<span class="tg-hint" aria-hidden="true" hidden></span>
<p class="tg-note" id="${note}" data-key="mode.gardenNote">${s('mode.gardenNote')}</p>
</div>
</nav>`;
}

/** Click delegation on any root that holds rendered toggles. Language links swap in place instead of reloading. */
export function bindToggles(root: HTMLElement, m: Pick<Machine, 'send'>): void {
  root.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>('.tg [data-lang], .tg [data-mode]') : null;
    if (target === null) return;
    const lang = target.dataset.lang;
    if (lang === 'en' || lang === 'es') {
      e.preventDefault();
      m.send({ type: 'SET_LANG', lang });
      return;
    }
    const mode = target.dataset.mode;
    if ((mode === 'garden' || mode === 'herbario') && target.getAttribute('aria-disabled') !== 'true') m.send({ type: 'SET_MODE', mode });
  });
}

/** The way-out button under `root`: where it leads, its words, and its pending and disabled state. */
export function paintMode(root: HTMLElement, mode: Mode, pending: boolean, strings: Strings, lang: Lang): void {
  const exit = root.querySelector<HTMLElement>('.tg-exit');
  if (exit === null) return;
  /** While the garden is still getting ready, the button keeps offering it (busy) instead of the way back out. */
  const toGarden = mode === 'herbario' || pending;
  exit.dataset.mode = toGarden ? 'garden' : 'herbario';
  exit.textContent = uiText(strings, lang, toGarden ? 'mode.garden' : 'mode.exit');
  if (toGarden) exit.removeAttribute('aria-label');
  else exit.setAttribute('aria-label', uiText(strings, lang, 'mode.exitLabel'));
  const hint = root.querySelector<HTMLElement>('.tg-hint');
  if (hint !== null) {
    hint.hidden = toGarden;
    hint.textContent = toGarden ? '' : uiText(strings, lang, 'mode.exitHint');
  }
  if (toGarden && !canGarden) exit.setAttribute('aria-disabled', 'true');
  else exit.removeAttribute('aria-disabled');
  if (pending) exit.setAttribute('aria-busy', 'true');
  else exit.removeAttribute('aria-busy');
  root.querySelector<HTMLElement>('.tg')?.toggleAttribute('data-pending', pending);
}

/** Texts and the current language mark under `root`. */
export function paintLang(root: HTMLElement, strings: Strings, l: Lang): void {
  for (const n of root.querySelectorAll<HTMLElement>('.tg [data-key]')) n.textContent = uiText(strings, l, n.dataset.key ?? '');
  for (const n of root.querySelectorAll<HTMLElement>('.tg [data-label-key]')) n.setAttribute('aria-label', uiText(strings, l, n.dataset.labelKey ?? ''));
  for (const a of root.querySelectorAll<HTMLElement>('.tg [data-lang]')) {
    if (a.dataset.lang === l) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }
}

export const isPending = (s: State): boolean => s.mode === 'garden' && !s.gardenReady;

export function createToggles(el: HTMLElement, m: Pick<Machine, 'send' | 'state' | 'subscribe'>, strings: Strings): Toggles {
  let lang = m.state.lang;
  let mode = m.state.mode;
  bindToggles(el, m);

  const toggles: Toggles = {
    setMode(next: Mode, pending: boolean): void {
      mode = next;
      paintMode(el, next, pending, strings, lang);
    },
    setLang(l: Lang): void {
      lang = l;
      paintLang(el, strings, l);
      paintMode(el, mode, isPending(m.state), strings, l);
    },
    setAudio(on: boolean): void {
      el.dataset.audio = on ? 'on' : 'off';
    },
  };

  m.subscribe((s, prev) => {
    if (s.lang !== prev.lang) toggles.setLang(s.lang);
    if (s.mode !== prev.mode || s.gardenReady !== prev.gardenReady) toggles.setMode(s.mode, isPending(s));
  });
  toggles.setLang(lang);
  return toggles;
}
