import type { Lang, Machine, Mode, State, Strings, Toggles } from '../types.ts';

/**
 * Top-right controls in every mode: view (Garden, Herbario), Download CV, language. The panel's header bar renders
 * the same controls (renderToggles with its own id prefix) and binds them with bindToggles, so they stay reachable
 * while the modal dialog makes the rest of the page inert.
 * renderToggles is pure (scripts/prerender.ts puts it in index.html, so the controls exist without JS): there the
 * garden button is disabled, because without JS there is no garden.
 * With JS, "Enter the garden" is live wherever WebGL2 exists: it sends SET_MODE garden, and the machine keeps it
 * pending until the garden is ready (data-pending, aria-busy). Without WebGL2, or once the garden broke, it is
 * disabled with its note.
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
  const s = (key: string): string => esc(strings[lang][key] ?? key);
  const note = `${prefix}-note`;
  const langs = LANGS.map(
    (l) => `<a class="tg-lang-link" href="?lang=${l}" hreflang="${l}" lang="${l}" data-lang="${l}"${l === lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`,
  ).join('');
  return `<nav class="tg" aria-label="${s('nav.controls')}" data-label-key="nav.controls">
<div class="tg-group tg-mode" role="group" aria-label="${s('nav.view')}" data-label-key="nav.view">
<button type="button" class="tg-seg" data-mode="garden" aria-pressed="false" aria-disabled="true" aria-describedby="${note}" data-key="mode.gardenShort">${s('mode.gardenShort')}</button>
<button type="button" class="tg-seg" data-mode="herbario" aria-pressed="true" data-key="mode.herbario">${s('mode.herbario')}</button>
<p class="tg-note" id="${note}" data-key="mode.gardenNote">${s('mode.gardenNote')}</p>
</div>
<a class="tg-cv" href="${esc(cv)}" download data-key="cv.download">${s('cv.download')}</a>
<div class="tg-group tg-lang" role="group" aria-label="${s('nav.lang')}" data-label-key="nav.lang">${langs}</div>
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

/** Pressed, pending and disabled state of the view buttons under `root`. */
export function paintMode(root: HTMLElement, mode: Mode, pending: boolean, strings: Strings, lang: Lang): void {
  for (const b of root.querySelectorAll<HTMLElement>('[data-mode]')) {
    const garden = b.dataset.mode === 'garden';
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    if (!garden) continue;
    if (canGarden) b.removeAttribute('aria-disabled');
    else b.setAttribute('aria-disabled', 'true');
    if (pending) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    if (canGarden && mode === 'herbario') b.setAttribute('aria-label', strings[lang]['mode.garden'] ?? 'mode.garden');
    else b.removeAttribute('aria-label');
  }
  root.querySelector<HTMLElement>('.tg')?.toggleAttribute('data-pending', pending);
}

/** Texts and the current language mark under `root`. */
export function paintLang(root: HTMLElement, strings: Strings, l: Lang): void {
  for (const n of root.querySelectorAll<HTMLElement>('.tg [data-key]')) n.textContent = strings[l][n.dataset.key ?? ''] ?? '';
  for (const n of root.querySelectorAll<HTMLElement>('.tg [data-label-key]')) n.setAttribute('aria-label', strings[l][n.dataset.labelKey ?? ''] ?? '');
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
