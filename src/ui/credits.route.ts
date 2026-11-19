import { CREDITS_HASH, hashOf } from '../core/router.ts';
import type { CreditsView } from '../credits/view.ts';
import type { Machine, Strings } from '../types.ts';

/**
 * The credits overlay's route, in the boot chunk: the view itself (src/credits/) and its data load only when asked
 * for, the chunk fetched as soon as a pointer or focus reaches a credits link. Any <a href="#/credits"> opens it
 * (the plan sheet in the garden, the Herbario footer) and pushes the credits entry; a deep link or the browser's
 * forward button opens it too. Closing (Esc, the close button, a click outside) goes back to the entry it was opened
 * from, or, on a cold deep link, replaces the URL with the current place. The router leaves the credits hash alone.
 */

type CreditsModule = typeof import('../credits/view.ts');

const LINK = `a[href="${CREDITS_HASH}"]`;

const isPlainClick = (e: MouseEvent): boolean => !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
const previousUrl = (): string | null => {
  const prev = (history.state as { prev?: unknown } | null)?.prev;
  return typeof prev === 'string' ? prev : null;
};

export function startCreditsRoute(m: Machine, strings: Strings): void {
  let chunk: Promise<CreditsModule> | null = null;
  let view: CreditsView | null = null;
  const load = (): Promise<CreditsModule> => (chunk ??= import('../credits/view.ts'));

  function leave(): void {
    if (location.hash !== CREDITS_HASH) return;
    const prev = previousUrl();
    if (prev !== null && !prev.endsWith(CREDITS_HASH)) history.back();
    else history.replaceState({ prev: null }, '', location.search + hashOf(m.state.intent));
  }

  function show(): void {
    load().then((mod) => {
      if (location.hash !== CREDITS_HASH) return;
      view ??= mod.createCredits(document.body, strings, leave);
      view.open(m.state.lang);
    }, (err: unknown) => {
      console.error('credits: failed to load', err);
      chunk = null;
      leave();
    });
  }

  const warm = (e: Event): void => {
    if (e.target instanceof Element && e.target.closest(LINK) !== null) void load();
  };
  document.addEventListener('pointerover', warm, { passive: true });
  document.addEventListener('focusin', warm);
  document.addEventListener('click', (e) => {
    if (!isPlainClick(e) || !(e.target instanceof Element) || e.target.closest(LINK) === null) return;
    e.preventDefault();
    if (location.hash !== CREDITS_HASH) history.pushState({ prev: location.search + location.hash }, '', location.search + CREDITS_HASH);
    show();
  });
  addEventListener('popstate', () => {
    if (location.hash === CREDITS_HASH) show();
    else view?.close();
  });
  if (location.hash === CREDITS_HASH) show();
}
