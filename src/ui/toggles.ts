import type { Lang, Machine, Mode, Strings, Toggles } from '../types.ts';

/**
 * Top-right controls in every mode: view (Garden, Herbario), Download CV, language.
 * renderToggles is pure (scripts/prerender.ts puts it in index.html, so the controls exist without JS).
 * createToggles adds behaviour: the language links swap in place instead of reloading, and texts follow the language.
 * Until the garden is ready its button stays aria-disabled with a visible note on hover and focus.
 */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ESC[ch] ?? ch);
const LANGS: readonly Lang[] = ['en', 'es'];

export function renderToggles(strings: Strings, lang: Lang, cv: string): string {
  const s = (key: string): string => esc(strings[lang][key] ?? key);
  const langs = LANGS.map(
    (l) => `<a class="tg-lang-link" href="?lang=${l}" hreflang="${l}" lang="${l}" data-lang="${l}"${l === lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`,
  ).join('');
  return `<nav class="tg" aria-label="${s('nav.controls')}" data-label-key="nav.controls">
<div class="tg-group tg-mode" role="group" aria-label="${s('nav.view')}" data-label-key="nav.view">
<button type="button" class="tg-seg" data-mode="garden" aria-pressed="false" aria-disabled="true" aria-describedby="tg-note" data-key="mode.gardenShort">${s('mode.gardenShort')}</button>
<button type="button" class="tg-seg" data-mode="herbario" aria-pressed="true" data-key="mode.herbario">${s('mode.herbario')}</button>
<p class="tg-note" id="tg-note" data-key="mode.gardenNote">${s('mode.gardenNote')}</p>
</div>
<a class="tg-cv" href="${esc(cv)}" download data-key="cv.download">${s('cv.download')}</a>
<div class="tg-group tg-lang" role="group" aria-label="${s('nav.lang')}" data-label-key="nav.lang">${langs}</div>
</nav>`;
}

export function createToggles(el: HTMLElement, m: Pick<Machine, 'send'>, strings: Strings): Toggles {
  el.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-lang], [data-mode]') : null;
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

  return {
    setMode(mode: Mode, pending: boolean): void {
      for (const b of el.querySelectorAll<HTMLElement>('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
      el.dataset.pending = pending ? 'true' : 'false';
    },
    setLang(l: Lang): void {
      for (const n of el.querySelectorAll<HTMLElement>('[data-key]')) n.textContent = strings[l][n.dataset.key ?? ''] ?? '';
      for (const n of el.querySelectorAll<HTMLElement>('[data-label-key]')) n.setAttribute('aria-label', strings[l][n.dataset.labelKey ?? ''] ?? '');
      for (const a of el.querySelectorAll<HTMLElement>('[data-lang]')) {
        if (a.dataset.lang === l) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    },
    setAudio(on: boolean): void {
      el.dataset.audio = on ? 'on' : 'off';
    },
  };
}
