import type { Change, Credit, CreditsFile, FontCredit } from '../../scripts/stages/credits.ts';
import data from '../content/credits.json' with { type: 'json' };
import { lookup } from '../content/i18n.ts';
import { esc } from '../content/herbario/html.ts';
import { ATTRIBUTION } from './attribution.ts';
import type { Lang, Strings } from '../types.ts';
import './credits.css';

/**
 * The credits view: one native modal <dialog> holding a printed register on paper, built from src/content/credits.json
 * (written by the credits stage of npm run assets). Images by the holder of the original, then the recordings the
 * garden plays, then the fonts. Each entry
 * names its title (linked to the original), its maker, its licence (linked to the licence) and what the pipeline
 * changed; a CC BY or BY-SA entry also prints its full attribution line. This chunk and its data load lazily
 * (ui/credits.route.ts). Esc, the close button and a click outside close it; onClose then puts the URL back.
 */

const credits = data as CreditsFile;

type Lookup = (key: string) => string;

function licenceName(id: string, s: Lookup): string {
  if (id === 'PD') return s('credits.pd');
  if (id === 'OWN') return s('credits.own');
  if (id === 'OFL-1.1') return 'SIL Open Font License 1.1';
  return id.replace(/^CC-/, 'CC ').replace(/-(\d)/, ' $1');
}

const anchor = (href: string, label: string): string => (href === '' ? esc(label) : `<a href="${esc(href)}" rel="noopener">${esc(label)}</a>`);

/** "Changed: cropped, cut out and re-tinted.", each change kept on one line so "re-tinted" never breaks at its hyphen. */
function changed(changes: readonly Change[], s: Lookup, lang: Lang): string {
  if (changes.length === 0) return '';
  const parts = new Intl.ListFormat(lang, { type: 'conjunction' }).formatToParts(changes.map((c) => s(`credits.change.${c}`)));
  const list = parts.map((p) => (p.type === 'element' ? `<span class="cr-change">${esc(p.value)}</span>` : esc(p.value))).join('');
  const [before = '', after = ''] = s('credits.changed').split('{list}');
  return ` <span class="cr-changed">${esc(before)}${list}${esc(after)}</span>`;
}

function item(c: Credit, s: Lookup, lang: Lang): string {
  const line = ATTRIBUTION.test(c.license) ? `<p class="cr-line">${esc(c.attribution)}</p>` : '';
  return `<li class="cr-item" data-licence="${esc(c.license)}">
<p class="cr-name">${anchor(c.sourceUrl, c.title)}</p>
<p class="cr-who">${esc(c.creator)}</p>
<p class="cr-lic">${anchor(c.licenseUrl, licenceName(c.license, s))}.${changed(c.changes, s, lang)}</p>
${line}</li>`;
}

function font(f: FontCredit, s: Lookup): string {
  return `<li class="cr-item" data-licence="${esc(f.license)}">
<p class="cr-name">${anchor(f.sourceUrl, f.family)}</p>
<p class="cr-who">${esc(f.copyright)}</p>
<p class="cr-lic">${anchor(f.licenseUrl, licenceName(f.license, s))}. ${anchor(f.file, s('credits.fontText'))}</p>
</li>`;
}

function render(strings: Strings, lang: Lang): string {
  const s: Lookup = (key) => lookup(strings, lang, key);
  const groups = credits.groups.map((g, i) => `<section class="cr-group" aria-labelledby="cr-g${i}">
<h4 class="cr-holder" id="cr-g${i}">${esc(g.institution)}</h4>
<ul class="cr-list">${g.items.map((c) => item(c, s, lang)).join('')}</ul>
</section>`);
  return `<header class="cr-head">
<h2 class="cr-title" id="cr-title">${esc(s('credits.title'))}</h2>
<button type="button" class="cr-close" autofocus>${esc(s('panel.close'))}</button>
</header>
<p class="cr-intro">${esc(s('credits.intro'))}</p>
<section class="cr-part" aria-labelledby="cr-images"><h3 class="cr-part-title" id="cr-images">${esc(s('credits.images'))}</h3>
<div class="cr-groups">${groups.join('')}</div></section>
${credits.sounds.length === 0 ? '' : `<section class="cr-part" aria-labelledby="cr-sounds"><h3 class="cr-part-title" id="cr-sounds">${esc(s('credits.sounds'))}</h3>
<ul class="cr-list cr-sounds">${credits.sounds.map((c) => item(c, s, lang)).join('')}</ul></section>`}
<section class="cr-part" aria-labelledby="cr-fonts"><h3 class="cr-part-title" id="cr-fonts">${esc(s('credits.fonts'))}</h3>
<ul class="cr-list cr-fonts">${credits.fonts.map((f) => font(f, s)).join('')}</ul></section>`;
}

export interface CreditsView {
  /** Shows the register in `lang`, built again only when the language changed. */
  open(lang: Lang): void;
  close(): void;
}

export function createCredits(parent: HTMLElement, strings: Strings, onClose: () => void): CreditsView {
  const dialog = document.createElement('dialog');
  dialog.className = 'cr';
  dialog.setAttribute('aria-labelledby', 'cr-title');
  dialog.setAttribute('closedby', 'any');
  parent.append(dialog);
  let shown: Lang | null = null;

  dialog.addEventListener('close', onClose);
  dialog.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('.cr-close') !== null) dialog.close();
  });

  return {
    open(lang) {
      if (shown !== lang) {
        dialog.innerHTML = render(strings, lang);
        dialog.lang = lang;
        shown = lang;
      }
      if (!dialog.open) {
        dialog.scrollTop = 0;
        dialog.showModal();
      }
    },
    close() {
      if (dialog.open) dialog.close();
    },
  };
}
