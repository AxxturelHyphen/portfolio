import type { I18n, Lang, Strings } from '../types.ts';

/** UI strings by key plus the current language. Missing keys return the key itself, so gaps stay visible. */

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'es';
}

export function lookup(strings: Strings, lang: Lang, key: string): string {
  return strings[lang][key] ?? key;
}

let table: Strings = { en: {}, es: {} };
let current: Lang = 'en';
const listeners = new Set<(l: Lang) => void>();

export function initI18n(strings: Strings, lang: Lang): void {
  table = strings;
  current = lang;
}

export function t(key: string): string {
  return lookup(table, current, key);
}

export function tr(v: I18n): string {
  return v[current];
}

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  for (const fn of listeners) fn(l);
}

export function onLang(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
