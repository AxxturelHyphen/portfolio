import { formatRoute, hashOf, parseRoute } from '../core/router.ts';
import type { BedId, Ev, Lang, Machine, Place, Project, State } from '../types.ts';

/**
 * Herbario session: a stand-in for the Machine (cook/ARCH.md 2.1) with the same send and subscribe contract,
 * covering what the Herbario needs before core/machine.ts exists: OPEN, CLOSE, BACK, ROUTE, SET_LANG, PANEL_READY.
 * Intent rules follow ARCH 2.2: the URL is written when the intent changes; user opens push, close goes back when
 * the previous entry is where the visitor came from, else replaces; language replaces; popstate only reads.
 * send is idempotent: no change keeps the same State object and notifies nobody.
 */

export type Session = Pick<Machine, 'state' | 'send' | 'subscribe'>;

interface HistoryEntry {
  back?: string;
}

const backOf = (v: unknown): string | null => {
  const back = (v as HistoryEntry | null)?.back;
  return typeof back === 'string' ? back : null;
};

const projectOf = (place: Place): string | null => (place.k === 'project' ? place.id : null);

export function createSession(c: { projects: readonly Project[] }, init: { lang: Lang; reduced: boolean }): Session {
  const initial = parseRoute(location.href, c);
  let state: State = {
    phase: 'overview',
    mode: 'herbario',
    intent: initial.place,
    bed: null,
    slot: null,
    project: projectOf(initial.place),
    fromX: 0,
    lang: init.lang,
    gen: 0,
    gardenReady: false,
    panelReady: false,
    reduced: init.reduced,
  };
  const subs = new Set<(s: State, prev: State) => void>();

  const here = (): string => location.search + location.hash;
  const urlOf = (place: Place, lang: Lang): string => formatRoute(place, 'herbario', lang, new URLSearchParams(location.search));
  const bedOf = (id: string): BedId | null => c.projects.find((p) => p.id === id)?.bed ?? null;

  function toPlace(place: Place, prev: State): State {
    const project = projectOf(place);
    return { ...prev, intent: place, project, phase: project === null ? 'overview' : 'opening', gen: prev.gen + 1, panelReady: false };
  }

  function open(id: string): State {
    if (state.project === id) return state;
    const place: Place = { k: 'project', id };
    const entry: HistoryEntry = { back: state.project === null ? here() : (backOf(history.state) ?? here()) };
    if (state.project === null) history.pushState(entry, '', urlOf(place, state.lang));
    else history.replaceState(entry, '', urlOf(place, state.lang));
    return toPlace(place, state);
  }

  function close(): State {
    if (state.project === null) return state;
    const back = backOf(history.state);
    if (back !== null) {
      const next = toPlace(parseRoute(new URL(back, location.href).href, c).place, state);
      history.back();
      return next;
    }
    const bed = bedOf(state.project);
    const place: Place = bed === null ? { k: 'overview' } : { k: 'bed', bed };
    history.replaceState(null, '', urlOf(place, state.lang));
    return toPlace(place, state);
  }

  function reduce(ev: Ev): State {
    switch (ev.type) {
      case 'OPEN':
        return open(ev.id);
      case 'CLOSE':
      case 'BACK':
        return close();
      case 'ROUTE':
        return hashOf(ev.route.place) === hashOf(state.intent) ? state : toPlace(ev.route.place, state);
      case 'SET_LANG':
        if (ev.lang === state.lang) return state;
        history.replaceState(history.state, '', urlOf(state.intent, ev.lang));
        return { ...state, lang: ev.lang };
      case 'PANEL_READY':
        if (ev.gen !== state.gen || ev.id !== state.project || state.panelReady) return state;
        return { ...state, panelReady: true, phase: 'inspect' };
      default:
        return state;
    }
  }

  const canonical = urlOf(state.intent, state.lang);
  if (canonical !== here()) history.replaceState(history.state, '', canonical);
  window.addEventListener('popstate', () => {
    session.send({ type: 'ROUTE', route: parseRoute(location.href, c) });
    const want = urlOf(state.intent, state.lang);
    if (want !== here()) history.replaceState(history.state, '', want);
  });

  const session: Session = {
    get state() {
      return state;
    },
    send(ev: Ev): void {
      const prev = state;
      state = reduce(ev);
      if (state !== prev) for (const fn of subs) fn(state, prev);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
  return session;
}
