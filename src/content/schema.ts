import type { Content, Lang } from '../types.ts';

/** Build-time validation of the content JSON. Collects every error with its path; never runs in the browser. */

export const FILL = '[FILL]';
const EM_DASH = '\u2014';
const BEDS = ['rosaleda', 'estanque', 'semillero'];
const FLOWERS = ['rose', 'lily', 'pod', 'bud'];
const STATUSES = ['idea', 'wip', 'shipped'];
const LINK_KEYS = ['repo', 'live', 'video', 'spotify'];
const MEDIA_TYPES = ['image', 'video'];
const LANGS: readonly Lang[] = ['en', 'es'];

type Raw = Record<string, unknown>;

class Checker {
  readonly errors: string[] = [];

  fail(path: string, msg: string): void {
    this.errors.push(`${path}: ${msg}`);
  }

  obj(v: unknown, path: string): Raw | null {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Raw;
    this.fail(path, 'expected an object');
    return null;
  }

  arr(v: unknown, path: string): unknown[] {
    if (Array.isArray(v)) return v;
    this.fail(path, 'expected an array');
    return [];
  }

  str(v: unknown, path: string): string {
    if (typeof v !== 'string' || v.trim() === '') {
      this.fail(path, 'expected a non-empty string');
      return '';
    }
    if (v.includes(EM_DASH)) this.fail(path, 'contains an em dash');
    return v;
  }

  oneOf(v: unknown, allowed: readonly unknown[], path: string): void {
    if (!allowed.includes(v)) this.fail(path, `expected one of ${allowed.join(', ')}`);
  }

  bool(v: unknown, path: string, optional = false): void {
    if (optional && v === undefined) return;
    if (typeof v !== 'boolean') this.fail(path, 'expected a boolean');
  }

  i18n(v: unknown, path: string): void {
    const o = this.obj(v, path);
    if (!o) return;
    for (const l of LANGS) this.str(o[l], `${path}.${l}`);
    this.onlyKeys(o, LANGS, path);
  }

  strings(v: unknown, path: string): void {
    this.arr(v, path).forEach((s, i) => this.str(s, `${path}[${i}]`));
  }

  onlyKeys(o: Raw, allowed: readonly string[], path: string): void {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) this.fail(`${path}.${k}`, 'unknown key');
  }
}

const PROJECT_KEYS = ['id', 'title', 'bed', 'flower', 'status', 'importance', 'private', 'year', 'oneLiner', 'problem', 'naiveFails',
  'built', 'result', 'stack', 'role', 'links', 'media', 'featured'];

function checkProject(c: Checker, v: unknown, path: string, ids: Set<string>): void {
  const p = c.obj(v, path);
  if (!p) return;
  c.onlyKeys(p, PROJECT_KEYS, path);
  const id = c.str(p.id, `${path}.id`);
  if (id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) c.fail(`${path}.id`, 'expected kebab-case');
  if (ids.has(id)) c.fail(`${path}.id`, `duplicate id ${id}`);
  ids.add(id);
  c.str(p.title, `${path}.title`);
  c.oneOf(p.bed, BEDS, `${path}.bed`);
  c.oneOf(p.flower, FLOWERS, `${path}.flower`);
  c.oneOf(p.status, STATUSES, `${path}.status`);
  c.oneOf(p.importance, [1, 2, 3], `${path}.importance`);
  c.bool(p.private, `${path}.private`, true);
  if (p.year !== FILL && !Number.isInteger(p.year)) c.fail(`${path}.year`, `expected a year or "${FILL}"`);
  for (const k of ['oneLiner', 'problem', 'naiveFails', 'built', 'result', 'role']) c.i18n(p[k], `${path}.${k}`);
  c.strings(p.stack, `${path}.stack`);
  const links = c.obj(p.links, `${path}.links`);
  if (links) {
    c.onlyKeys(links, LINK_KEYS, `${path}.links`);
    for (const k of Object.keys(links)) c.str(links[k], `${path}.links.${k}`);
    if (p.private === true && links.repo !== undefined) c.fail(`${path}.links.repo`, 'a private project has no repo link');
  }
  c.arr(p.media, `${path}.media`).forEach((m, i) => {
    const mp = `${path}.media[${i}]`;
    const o = c.obj(m, mp);
    if (!o) return;
    c.onlyKeys(o, ['type', 'src', 'alt'], mp);
    c.oneOf(o.type, MEDIA_TYPES, `${mp}.type`);
    c.str(o.src, `${mp}.src`);
    c.i18n(o.alt, `${mp}.alt`);
  });
  c.bool(p.featured, `${path}.featured`);
}

function checkProfile(c: Checker, v: unknown): void {
  const p = c.obj(v, 'profile');
  if (!p) return;
  c.onlyKeys(p, ['name', 'alias', 'location', 'headline', 'about', 'education', 'languages', 'stack', 'links', 'portrait', 'cv'], 'profile');
  for (const k of ['name', 'alias', 'cv']) c.str(p[k], `profile.${k}`);
  c.i18n(p.location, 'profile.location');
  c.i18n(p.headline, 'profile.headline');
  c.i18n(p.about, 'profile.about');
  c.arr(p.education, 'profile.education').forEach((e, i) => {
    const o = c.obj(e, `profile.education[${i}]`);
    if (!o) return;
    c.i18n(o.title, `profile.education[${i}].title`);
    c.str(o.place, `profile.education[${i}].place`);
    c.i18n(o.status, `profile.education[${i}].status`);
  });
  c.arr(p.languages, 'profile.languages').forEach((l, i) => {
    const o = c.obj(l, `profile.languages[${i}]`);
    if (!o) return;
    c.i18n(o.name, `profile.languages[${i}].name`);
    c.str(o.level, `profile.languages[${i}].level`);
  });
  c.strings(p.stack, 'profile.stack');
  const keys = new Set<string>();
  c.arr(p.links, 'profile.links').forEach((l, i) => {
    const o = c.obj(l, `profile.links[${i}]`);
    if (!o) return;
    const key = c.str(o.key, `profile.links[${i}].key`);
    if (keys.has(key)) c.fail(`profile.links[${i}].key`, `duplicate key ${key}`);
    keys.add(key);
    c.i18n(o.label, `profile.links[${i}].label`);
    c.str(o.href, `profile.links[${i}].href`);
  });
  const portrait = c.obj(p.portrait, 'profile.portrait');
  if (portrait) {
    c.str(portrait.src, 'profile.portrait.src');
    c.i18n(portrait.alt, 'profile.portrait.alt');
  }
}

function checkStrings(c: Checker, v: unknown): void {
  const s = c.obj(v, 'strings');
  if (!s) return;
  c.onlyKeys(s, LANGS, 'strings');
  const en = c.obj(s.en, 'strings.en') ?? {};
  const es = c.obj(s.es, 'strings.es') ?? {};
  for (const [lang, table, other] of [['en', en, es], ['es', es, en]] as const) {
    for (const k of Object.keys(table)) {
      c.str(table[k], `strings.${lang}.${k}`);
      if (!(k in other)) c.fail(`strings.${lang}.${k}`, `missing in ${lang === 'en' ? 'es' : 'en'}`);
    }
  }
}

export type HerbarioContent = Pick<Content, 'projects' | 'profile' | 'strings'>;

/** Throws with every schema error listed; returns the typed content when valid. */
export function validateContent(raw: { projects: unknown; profile: unknown; strings: unknown }): HerbarioContent {
  const c = new Checker();
  const ids = new Set<string>();
  c.arr(raw.projects, 'projects').forEach((p, i) => checkProject(c, p, `projects[${i}]`, ids));
  checkProfile(c, raw.profile);
  checkStrings(c, raw.strings);
  if (c.errors.length > 0) throw new Error(`content schema: ${c.errors.length} error(s)\n  ${c.errors.join('\n  ')}`);
  return raw as HerbarioContent;
}

/** Counts '[FILL]' markers (with or without a hint) in any JSON value. */
export function countFills(v: unknown): number {
  if (typeof v === 'string') return v.split(FILL.slice(0, -1)).length - 1;
  if (Array.isArray(v)) return v.reduce<number>((n, x) => n + countFills(x), 0);
  if (typeof v === 'object' && v !== null) return Object.values(v).reduce<number>((n, x) => n + countFills(x), 0);
  return 0;
}
