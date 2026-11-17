import type { Lang, Project } from '../../types.ts';
import { esc, isFill, link, list, text } from './html.ts';

/**
 * The case of one project as HTML strings: the head (name, Latin name, one-liner, status) and the body in the
 * fixed panel order of spec section 7: Problem, Why the naive approach fails, What I built, Stack, Result, Links, Media.
 * Used by the project panel and by the no-JS <details> inside each Herbario article.
 */

type Lookup = (key: string) => string;

const LINK_KEYS = ['repo', 'live', 'video', 'spotify'] as const;

/** The flower's Latin name, or '' when the kind has none yet (pod and bud until their source plate names one). */
export function latinOf(p: Project, s: Lookup): string {
  const key = `flower.${p.flower}.latin`;
  const name = s(key);
  return name === key ? '' : name;
}

function prose(p: Project, key: 'problem' | 'naiveFails' | 'built' | 'result', l: Lang, s: Lookup): string {
  return `<section class="c-part c-${key}"><h3 class="c-h">${esc(s(`project.${key}`))}</h3><div class="c-text"><p>${text(p[key][l])}</p></div></section>`;
}

function part(cls: string, heading: string, body: string): string {
  return `<section class="c-part ${cls}"><h3 class="c-h">${esc(heading)}</h3><div class="c-text">${body}</div></section>`;
}

/** Private projects never show a repo link (spec section 5). */
function links(p: Project, s: Lookup): string {
  const items = LINK_KEYS.flatMap((k) => {
    const href = p.links[k];
    if (href === undefined || (k === 'repo' && p.private === true)) return [];
    return [link(s(`link.${k}`), href, `c-link c-link-${k}`)];
  });
  const note = p.private === true ? `<p class="c-private">${esc(s('project.private'))}</p>` : '';
  if (items.length === 0 && note === '') return '';
  return part('c-links', s('project.links'), note + (items.length > 0 ? list(items, 'c-link-list') : ''));
}

/** Real media lazy-load and fade in once decoded; owner gaps render as quiet blanks, never as broken images. */
function media(p: Project, l: Lang, s: Lookup): string {
  if (p.media.length === 0) return '';
  const items = p.media.map((m, i) => {
    if (isFill(m.src)) return `<p class="c-media-fill">${esc(s(`media.${m.type}`))}: ${text(m.src)}</p>`;
    const alt = esc(m.alt[l]);
    const src = esc(m.src);
    const load = i === 0 ? 'eager' : 'lazy';
    return m.type === 'image'
      ? `<img class="c-media-item" src="${src}" alt="${alt}" loading="${load}" decoding="async" data-media>`
      : `<video class="c-media-item" src="${src}" aria-label="${alt}" controls preload="none" playsinline></video>`;
  });
  return part('c-media', s('project.media'), `<div class="c-media-list">${items.join('')}</div>`);
}

export function renderCaseHead(p: Project, l: Lang, s: Lookup, titleId: string): string {
  const latin = latinOf(p, s);
  const role = `<div><dt>${esc(s('project.role'))}</dt><dd>${text(p.role[l])}</dd></div>`;
  return `<header class="c-head">
<p class="c-bed">${esc(s(`bed.${p.bed}`))}</p>
<h2 class="c-title" id="${titleId}" tabindex="-1">${esc(p.title)}</h2>
${latin === '' ? '' : `<p class="c-latin" lang="la">${esc(latin)}</p>\n`}<p class="c-oneliner">${text(p.oneLiner[l])}</p>
<dl class="c-meta"><div><dt>${esc(s('project.status'))}</dt><dd class="c-status" data-status="${p.status}">${esc(s(`status.${p.status}`))}</dd></div><div><dt>${esc(s('project.year'))}</dt><dd>${text(String(p.year))}</dd></div>${role}</dl>
</header>`;
}

export function renderCaseBody(p: Project, l: Lang, s: Lookup): string {
  return [
    prose(p, 'problem', l, s),
    prose(p, 'naiveFails', l, s),
    prose(p, 'built', l, s),
    part('c-stack', s('project.stack'), list(p.stack.map(text), 'h-tags')),
    prose(p, 'result', l, s),
    links(p, s),
    media(p, l, s),
  ].join('\n');
}
