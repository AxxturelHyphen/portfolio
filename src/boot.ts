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
import { parseDebug } from './core/debug.ts';
import { channelsSettled, createLoop } from './core/loop.ts';
import { createMachine, type GardenGeo } from './core/machine.ts';
import { panelOf } from './core/motion.ts';
import { startRouter } from './core/router.ts';
import { createPanel, type CaseRenderer } from './ui/panel.ts';
import { createToggles, disableGarden } from './ui/toggles.ts';
import type { Content, Lang, Mode } from './types.ts';

/**
 * Boot chunk entry: no three.js here. The inline stub already set html[data-mode|data-lang|data-garden].
 * Owns the one machine, the router and the one rAF loop, so the Herbario panel runs on the same channels as the
 * garden. The loop pauses ('herbario') whenever the Herbario shows and nothing moves; any state change resumes it.
 */

const LANG_KEY = 'jardin.lang';
const root = document.documentElement;
const content: Content = loadContent();
const q = parseDebug(new URLSearchParams(location.search));
const herbario = document.getElementById('herbario');
const dialog = document.getElementById('panel');
const togglesEl = document.getElementById('toggles');

const lang: Lang = isLang(root.dataset.lang) ? root.dataset.lang : 'en';
const mode: Mode = root.dataset.mode === 'garden' ? 'garden' : 'herbario';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

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

type GardenModule = typeof import('./garden/index.ts');
let gardenChunk: Promise<GardenModule> | null = null;
/** 'broken': the garden started but could not get ready; it is not started twice on the same canvas. */
let gardenRun: 'none' | 'starting' | 'running' | 'broken' = 'none';

const importGarden = (): Promise<GardenModule> => (gardenChunk ??= import('./garden/index.ts'));

/** Evaluates the garden chunk at idle, before the mode toggle can ask for it (cook/ARCH.md section 6, risk 2). */
function loadGardenAtIdle(): void {
  const load = (): void => void importGarden();
  if ('requestIdleCallback' in window) requestIdleCallback(load);
  else setTimeout(load, 1);
}

/** No garden after all: back to the Herbario, so the state never rests in 'garden' without a garden. Only a chunk
 * import failure (nothing touched the canvas yet) leaves "Enter the garden" able to retry; any failure once
 * startGarden ran (no WebGL2, renderer or warm-up threw, probe judged it too slow) disables the offer for the visit. */
function gardenFailed(err: unknown, broken: boolean): void {
  if (err !== null) console.error('garden: failed to start', err);
  if (broken) {
    gardenRun = 'broken';
    disableGarden();
  } else {
    gardenRun = 'none';
    gardenChunk = null;
  }
  machine.send({ type: 'SET_MODE', mode: 'herbario' });
  toggles?.setMode(machine.state.mode, false);
}

/** Starts the garden once, when the garden is the mode (at boot, or "Enter the garden" from the Herbario). */
function startGardenOnce(): void {
  if (gardenRun === 'broken') {
    gardenFailed(null, true);
    return;
  }
  if (gardenRun !== 'none') return;
  const canvas = document.getElementById('garden');
  const world = document.getElementById('world');
  const proxies = document.getElementById('proxies');
  const label = document.getElementById('label');
  if (typeof WebGL2RenderingContext !== 'function' || !(canvas instanceof HTMLCanvasElement) || world === null || herbario === null || proxies === null || label === null) {
    gardenFailed(null, true);
    return;
  }
  gardenRun = 'starting';
  importGarden().then(
    (g) => {
      gardenRun = 'running';
      return g.startGarden({
        machine, loop, content, q, canvas, world, herbario, proxies, label,
        attachGeo: (geo) => {
          gardenGeo = geo;
          machine.refresh();
        },
        refresh: () => machine.refresh(),
        prepare: (id, gen) => void panel?.prepare(id, gen),
        fail: () => gardenFailed(null, true),
      }).ready;
    },
    (err: unknown) => gardenFailed(err, false),
  ).catch((err: unknown) => gardenFailed(err, true));
}

initI18n(content.strings, lang);
onLang(renderLang);
if (new URLSearchParams(location.search).has('lang')) storeLang(lang);
if (lang !== 'en') renderLang(lang);

/** Until the garden attaches its own, no slot is bound, no bed is entered and there is no overview pan. */
let gardenGeo: GardenGeo = { slotOf: () => null, bedReady: () => false, viewX: () => null };
const machine = createMachine(content, {
  mode, reduced, lang,
  geo: { slotOf: (id) => gardenGeo.slotOf(id), bedReady: (b) => gardenGeo.bedReady(b), viewX: () => gardenGeo.viewX() },
});
const loop = createLoop(q);
startRouter(machine, content);
const toggles = togglesEl ? createToggles(togglesEl, machine, content.strings) : null;
toggles?.setLang(lang);
const panel = dialog instanceof HTMLDialogElement ? createPanel(dialog, content, machine, renderCase) : null;

loop.on('sim', (c) => {
  machine.tick(c);
  if (!channelsSettled(machine)) loop.wake();
  else if (machine.state.mode === 'herbario') loop.pause('herbario');
});
if (panel !== null) loop.on('dom', () => panel.setProgress(panelOf(machine.ch.open.value)));

machine.subscribe((s, prev) => {
  loop.resume('herbario');
  loop.wake();
  if (s.mode === 'garden') startGardenOnce();
  if (s.lang !== prev.lang) {
    storeLang(s.lang);
    setLang(s.lang);
    toggles?.setLang(s.lang);
  }
});

/** A sheet's title link opens the panel through the machine, so the history entry carries where to go back to. */
herbario?.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const id = e.target instanceof Element ? e.target.closest<HTMLElement>('.h-sheet')?.dataset.flower : undefined;
  if (id === undefined || (e.target instanceof Element && e.target.closest('details, a:not(.h-open)') !== null)) return;
  e.preventDefault();
  machine.send({ type: 'OPEN', id });
});

/** Until the garden chunk takes the layers over (ui/mode.ts), a Herbario start keeps the world layer inert. */
if (mode === 'herbario') document.getElementById('world')?.toggleAttribute('inert', true);

loop.start();
if (machine.state.intent.k === 'bed') document.getElementById(`b-${machine.state.intent.bed}`)?.scrollIntoView();
if (mode === 'garden') startGardenOnce();
else if (root.dataset.garden === '1') loadGardenAtIdle();
