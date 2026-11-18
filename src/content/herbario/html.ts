/** Pure string helpers shared by the Herbario template and the case renderer. No DOM. */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const FILL_RE = /\[FILL[^\]]*\]/g;

export const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);

export const isFill = (s: string): boolean => s.includes('[FILL');

/** True when the text is nothing but owner gaps: a garden card leaves such a field out. */
export const onlyFill = (s: string): boolean => isFill(s) && s.replace(FILL_RE, '').trim() === '';

/** Escaped text with each owner gap ([FILL] or [FILL: note]) replaced by gap(mark). */
function withGaps(s: string, gap: (mark: string) => string): string {
  let out = '';
  let last = 0;
  for (const m of s.matchAll(FILL_RE)) {
    out += esc(s.slice(last, m.index)) + gap(m[0]);
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}

/** Escaped text; each owner gap is wrapped so it reads as a quiet, visible blank, its mark kept small (the Herbario). */
export const text = (s: string): string => withGaps(s, (mark) => `<span class="h-fill">${esc(mark)}</span>`);

/** Escaped text; each owner gap is an empty quiet blank and its note is never shown (the garden's cards). */
export const blank = (s: string): string => withGaps(s, () => '<span class="h-fill"></span>');

export function list(items: readonly string[], cls: string): string {
  return `<ul class="${cls}">${items.map((s) => `<li>${s}</li>`).join('')}</ul>`;
}

/** Host and path without the protocol, for printed links. */
export const printable = (href: string): string => href.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** A link only when the href is real; a gap renders as label plus the visible blank. */
export function link(label: string, href: string, cls: string): string {
  if (isFill(href)) return `<span class="${cls}">${text(label)} ${text(href)}</span>`;
  const shown = href.startsWith('mailto:') ? href.slice(7) : printable(href);
  return `<a class="${cls}" href="${esc(href)}" rel="noopener" data-print="${esc(shown)}">${text(label)}</a>`;
}
