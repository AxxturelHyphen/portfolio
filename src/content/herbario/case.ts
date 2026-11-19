import type { Lang, Project } from '../../types.ts';
import { blank, esc, isFill, link, list, onlyFill, text } from './html.ts';

/**
 * The case of one project as HTML strings: the head (name, one-liner, status) and the body in the
 * fixed panel order of spec section 7: Problem, Why the naive approach fails, What I built, Stack, Result, Links, Media.
 * Used by the project panel and by the no-JS <details> inside each Herbario article.
 */

type Lookup = (key: string) => string;

/**
 * How owner gaps read. The Herbario marks each gap where it stands (MARKED_GAPS). The panel over the garden follows it
 * without the notes (BLANK_GAPS): a gap inside a sentence is an empty quiet blank, a field that is nothing but a gap is
 * left out with its heading, and a link or a medium whose target is a gap is not rendered.
 */
export interface Gaps {
  text(s: string): string;
  /** True for a field the card leaves out. */
  omit(s: string): boolean;
}

export const MARKED_GAPS: Gaps = { text, omit: () => false };
export const BLANK_GAPS: Gaps = { text: blank, omit: onlyFill };

const LINK_KEYS = ['repo', 'live', 'video', 'spotify'] as const;

function prose(p: Project, key: 'problem' | 'naiveFails' | 'built' | 'result', l: Lang, s: Lookup, g: Gaps): string {
  const body = p[key][l];
  if (g.omit(body)) return '';
  return `<section class="c-part c-${key}"><h3 class="c-h">${esc(s(`project.${key}`))}</h3><div class="c-text"><p>${g.text(body)}</p></div></section>`;
}

function part(cls: string, heading: string, body: string): string {
  return `<section class="c-part ${cls}"><h3 class="c-h">${esc(heading)}</h3><div class="c-text">${body}</div></section>`;
}

/** Private projects never show a repo link (spec section 5). */
function links(p: Project, s: Lookup, g: Gaps): string {
  const items = LINK_KEYS.flatMap((k) => {
    const href = p.links[k];
    if (href === undefined || (k === 'repo' && p.private === true) || g.omit(href)) return [];
    return [link(s(`link.${k}`), href, `c-link c-link-${k}`)];
  });
  const note = p.private === true ? `<p class="c-private">${esc(s('project.private'))}</p>` : '';
  if (items.length === 0 && note === '') return '';
  return part('c-links', s('project.links'), note + (items.length > 0 ? list(items, 'c-link-list') : ''));
}

/** Real media lazy-load and fade in once decoded; owner gaps render as quiet blanks, never as broken images. */
function media(p: Project, l: Lang, s: Lookup, g: Gaps): string {
  const shown = p.media.filter((m) => !g.omit(m.src));
  if (shown.length === 0) return '';
  const items = shown.map((m, i) => {
    if (isFill(m.src)) return `<p class="c-media-fill">${esc(s(`media.${m.type}`))}: ${g.text(m.src)}</p>`;
    const alt = esc(m.alt[l]);
    const src = esc(m.src);
    const load = i === 0 ? 'eager' : 'lazy';
    return m.type === 'image'
      ? `<img class="c-media-item" src="${src}" alt="${alt}" loading="${load}" decoding="async" data-media>`
      : `<video class="c-media-item" src="${src}" aria-label="${alt}" controls preload="none" playsinline></video>`;
  });
  return part('c-media', s('project.media'), `<div class="c-media-list">${items.join('')}</div>`);
}

/** One term of the meta list, or '' when the card leaves its value out. */
function meta(term: string, value: string, g: Gaps): string {
  return g.omit(value) ? '' : `<div><dt>${esc(term)}</dt><dd>${g.text(value)}</dd></div>`;
}

export function renderCaseHead(p: Project, l: Lang, s: Lookup, titleId: string, g: Gaps = MARKED_GAPS): string {
  const oneLiner = p.oneLiner[l];
  return `<header class="c-head">
<h2 class="c-title" id="${titleId}" tabindex="-1">${esc(p.title)}</h2>
${g.omit(oneLiner) ? '' : `<p class="c-oneliner">${g.text(oneLiner)}</p>\n`}<dl class="c-meta"><div><dt>${esc(s('project.status'))}</dt><dd class="c-status" data-status="${p.status}">${esc(s(`status.${p.status}`))}</dd></div>${meta(s('project.year'), String(p.year), g)}${meta(s('project.role'), p.role[l], g)}</dl>
</header>`;
}

/** `withMedia` false leaves the media section out: the garden's panel shows the media in its film. */
export function renderCaseBody(p: Project, l: Lang, s: Lookup, g: Gaps = MARKED_GAPS, withMedia = true): string {
  const stack = p.stack.filter((w) => !g.omit(w));
  return [
    prose(p, 'problem', l, s, g),
    prose(p, 'naiveFails', l, s, g),
    prose(p, 'built', l, s, g),
    stack.length === 0 && p.stack.length > 0 ? '' : part('c-stack', s('project.stack'), list(stack.map(g.text), 'h-tags')),
    prose(p, 'result', l, s, g),
    links(p, s, g),
    withMedia ? media(p, l, s, g) : '',
  ].join('\n');
}
