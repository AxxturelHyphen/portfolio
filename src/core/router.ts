import type { BedId, Lang, Machine, Mode, Place, Project, Route, State } from '../types.ts';
import { parseDebug } from './debug.ts';
import { causeOf } from './machine.ts';

/**
 * Two-way URL sync (cook/ARCH.md 2.2). The hash holds the place, the query holds mode, language and debug params.
 * The URL mirrors state.intent at all times and is written when the intent changes, never when a transition settles.
 * User place changes push; CLOSE and BACK go back when the previous entry is the target, else replace; mode,
 * language and scroll changes replace; popstate sends ROUTE and only writes to normalise.
 */

const BED_IDS: readonly string[] = ['puerta', 'rosaleda', 'estanque', 'semillero', 'gruta', 'salida'];
const OVERVIEW: Place = { k: 'overview' };

function parsePlace(hash: string, projects: readonly Pick<Project, 'id'>[]): Place {
  const bed = /^#\/b\/([a-z]+)$/.exec(hash);
  if (bed?.[1] !== undefined && BED_IDS.includes(bed[1])) return { k: 'bed', bed: bed[1] as BedId };
  const project = /^#\/p\/([a-z0-9-]+)$/.exec(hash);
  if (project?.[1] !== undefined && projects.some((p) => p.id === project[1])) return { k: 'project', id: project[1] };
  return OVERVIEW;
}

/** Unknown bed or id becomes the overview; the router then replaces the URL. Never an error state. */
export function parseRoute(href: string, c: { readonly projects: readonly Pick<Project, 'id'>[] }): Route {
  const url = new URL(href);
  const debug = parseDebug(url.searchParams);
  return { place: parsePlace(url.hash, c.projects), mode: debug.mode ?? null, debug };
}

export function hashOf(place: Place): string {
  if (place.k === 'bed') return `#/b/${place.bed}`;
  if (place.k === 'project') return `#/p/${place.id}`;
  return '#/';
}

/** '?<params>#/', '#/b/<bed>' or '#/p/<id>'; debug params in `keep` are kept. */
export function formatRoute(place: Place, mode: Mode, lang: Lang, keep: URLSearchParams): string {
  const q = new URLSearchParams(keep);
  q.set('mode', mode);
  if (lang === 'en') q.delete('lang');
  else q.set('lang', lang);
  return `?${q.toString()}${hashOf(place)}`;
}

/** The parts of `window` the router touches, so it runs against a fake history in unit tests. */
export interface RouterHost {
  readonly location: { readonly href: string; readonly search: string; readonly hash: string };
  readonly history: { readonly state: unknown; pushState(data: unknown, unused: string, url: string): void; replaceState(data: unknown, unused: string, url: string): void; back(): void };
  addEventListener(type: 'popstate', fn: () => void): void;
}

/** Each entry remembers the URL it was pushed from, so CLOSE can tell whether going back lands on its target. */
interface Entry { prev: string | null }

const prevOf = (v: unknown): string | null => {
  const prev = (v as Partial<Entry> | null)?.prev;
  return typeof prev === 'string' ? prev : null;
};

const hashPart = (url: string): string => {
  const i = url.indexOf('#');
  return i < 0 ? '' : url.slice(i);
};

export function startRouter(m: Machine, c: { readonly projects: readonly Pick<Project, 'id'>[] }, host: RouterHost = window): void {
  const { location: loc, history: h } = host;
  let pendingBack = false;

  const here = (): string => loc.search + loc.hash;
  const urlOf = (s: State): string => formatRoute(s.intent, s.mode, s.lang, new URLSearchParams(loc.search));
  const replace = (url: string): void => h.replaceState({ prev: prevOf(h.state) } satisfies Entry, '', url);
  const push = (url: string): void => h.pushState({ prev: here() } satisfies Entry, '', url);

  /** Writes the current intent: push when the place differs and the cause is a user move, else replace. */
  function sync(placeWrite: 'push' | 'replace'): void {
    const url = urlOf(m.state);
    if (url === here()) return;
    if (placeWrite === 'push' && hashPart(url) !== loc.hash) push(url);
    else replace(url);
  }

  m.subscribe((s, prev) => {
    if (pendingBack || (s.intent === prev.intent && s.mode === prev.mode && s.lang === prev.lang)) return;
    const cause = causeOf(m);
    if (cause === 'route') return;
    const url = urlOf(s);
    if (url === here()) return;
    const back = prevOf(h.state);
    if (cause === 'back' && back !== null && hashPart(back) === hashPart(url)) {
      pendingBack = true;
      h.back();
    } else {
      sync(cause === 'push' ? 'push' : 'replace');
    }
  });

  host.addEventListener('popstate', () => {
    if (pendingBack) {
      pendingBack = false;
      sync('push');
      return;
    }
    m.send({ type: 'ROUTE', route: parseRoute(loc.href, c) });
    sync('replace');
  });

  m.send({ type: 'ROUTE', route: parseRoute(loc.href, c) });
  sync('replace');
}
