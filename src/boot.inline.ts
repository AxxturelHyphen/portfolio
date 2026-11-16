import type { decideMode } from './core/quality.ts';

/**
 * Runs before first paint as an inline script (scripts/prerender.ts serialises it with decideMode as the argument).
 * Sets html[data-mode], html[data-lang] and html[data-garden] (1 when the garden chunk should load at idle).
 * Self-contained: no imports at runtime, no references outside its body.
 */
export function bootInline(decide: typeof decideMode): void {
  const q = new URLSearchParams(location.search);
  const m = q.get('mode');
  let stored: string | null = null;
  try {
    stored = localStorage.getItem('jardin.lang');
  } catch {
    // Storage blocked: fall back to ?lang= or English.
  }
  const l = q.get('lang') ?? stored;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const d = decide({
    webgl2: typeof WebGL2RenderingContext === 'function',
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    saveData: conn?.saveData === true,
    q: m === 'garden' || m === 'herbario' ? { mode: m } : {},
  });
  const root = document.documentElement;
  root.dataset.mode = d.mode;
  root.dataset.garden = d.loadGarden ? '1' : '0';
  root.dataset.lang = l === 'es' ? 'es' : 'en';
  root.lang = root.dataset.lang;
}
