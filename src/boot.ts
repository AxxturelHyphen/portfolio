import './ui/fonts.css';
import './ui/styles/base.css';
import './ui/styles/toggles.css';
import './ui/styles/panel.css';
import './content/herbario/herbario.css';
import './content/herbario/sheet.css';
import './content/herbario/print.css';
import { renderCaseBody, renderCaseHead } from './content/herbario/case.ts';
import { renderHerbario } from './content/herbario/template.ts';
import { initI18n, isLang, lookup, onLang, setLang } from './content/i18n.ts';
import { loadContent } from './content/load.ts';
import { createPanel, type CaseRenderer } from './ui/panel.ts';
import { createSession } from './ui/session.ts';
import { createToggles } from './ui/toggles.ts';
import type { Lang } from './types.ts';

/** Boot chunk entry: no three.js here. The inline stub already set html[data-mode|data-lang|data-garden]. */

const LANG_KEY = 'jardin.lang';
const root = document.documentElement;
const content = loadContent();
const herbario = document.getElementById('herbario');
const dialog = document.getElementById('panel');
const togglesEl = document.getElementById('toggles');

const lang: Lang = isLang(root.dataset.lang) ? root.dataset.lang : 'en';

function storeLang(l: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    // Storage blocked: the language still follows ?lang= for this visit.
  }
}

function renderLang(l: Lang): void {
  if (herbario) herbario.innerHTML = renderHerbario(content, l);
  root.lang = l;
  root.dataset.lang = l;
}

const renderCase: CaseRenderer = (p, l, titleId) => {
  const s = (key: string): string => lookup(content.strings, l, key);
  return renderCaseHead(p, l, s, titleId) + renderCaseBody(p, l, s);
};

function loadGardenAtIdle(): void {
  const load = (): void => {
    void import('./garden/index.ts').then((m) => m.startGarden());
  };
  if ('requestIdleCallback' in window) requestIdleCallback(load);
  else setTimeout(load, 1);
}

initI18n(content.strings, lang);
onLang(renderLang);
if (new URLSearchParams(location.search).has('lang')) storeLang(lang);
if (lang !== 'en') renderLang(lang);

const session = createSession(content, { lang, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches });
const toggles = togglesEl ? createToggles(togglesEl, session, content.strings) : null;
toggles?.setLang(lang);
const panel = dialog instanceof HTMLDialogElement ? createPanel(dialog, content, session, renderCase) : null;

function openPanel(id: string, gen: number): void {
  if (panel === null) return;
  void panel.prepare(id, gen);
  panel.show();
}

session.subscribe((s, prev) => {
  if (s.lang !== prev.lang) {
    storeLang(s.lang);
    setLang(s.lang);
    toggles?.setLang(s.lang);
    if (s.project !== null && panel !== null) void panel.prepare(s.project, s.gen);
  }
  if (s.project === prev.project) return;
  if (s.project !== null) openPanel(s.project, s.gen);
  else void panel?.hide();
});

/** A sheet's title link opens the panel through the session, so the history entry carries where to go back to. */
herbario?.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const id = e.target instanceof Element ? e.target.closest<HTMLElement>('.h-sheet')?.dataset.flower : undefined;
  if (id === undefined || (e.target instanceof Element && e.target.closest('details, a:not(.h-open)') !== null)) return;
  e.preventDefault();
  session.send({ type: 'OPEN', id });
});

if (session.state.project !== null) openPanel(session.state.project, session.state.gen);
else if (session.state.intent.k === 'bed') document.getElementById(`b-${session.state.intent.bed}`)?.scrollIntoView();
if (root.dataset.garden === '1') loadGardenAtIdle();
