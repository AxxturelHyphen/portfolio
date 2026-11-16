import type { BedId, Lang, Mode, Place, Project, Route } from '../types.ts';
import { parseDebug } from './debug.ts';

/** Hash holds the place, query holds mode, language and debug params (cook/ROUNDS.md decision 21:50). */

const BED_IDS: readonly string[] = ['puerta', 'rosaleda', 'estanque', 'semillero', 'gruta', 'salida'];
const OVERVIEW: Place = { k: 'overview' };

function parsePlace(hash: string, projects: readonly Project[]): Place {
  const bed = /^#\/b\/([a-z]+)$/.exec(hash);
  if (bed?.[1] !== undefined && BED_IDS.includes(bed[1])) return { k: 'bed', bed: bed[1] as BedId };
  const project = /^#\/p\/([a-z0-9-]+)$/.exec(hash);
  if (project?.[1] !== undefined && projects.some((p) => p.id === project[1])) return { k: 'project', id: project[1] };
  return OVERVIEW;
}

/** Unknown bed or id becomes the overview; the caller replaces the URL when formatRoute differs. Never an error state. */
export function parseRoute(href: string, c: { projects: readonly Project[] }): Route {
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
