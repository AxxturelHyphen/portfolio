import type { Lang, Project, ProjectBed } from '../../types.ts';
import { lookup } from '../i18n.ts';
import { projectsOf } from '../load.ts';
import type { HerbarioContent } from '../schema.ts';
import { latinOf, renderCaseBody } from './case.ts';
import { esc, link, list, text } from './html.ts';

/**
 * renderHerbario: the no-WebGL CV as one pure HTML string (no DOM), used by scripts/prerender.ts at build
 * and by the browser on a language switch. Structure and class names only; styles live in herbario.css and print.css.
 * Each project is one herbarium sheet: a mount for its specimen and a label. The full case sits in a <details>
 * so everything is readable without JS; with JS the sheet opens the project panel instead.
 */

type Lookup = (key: string) => string;

const BEDS: readonly ProjectBed[] = ['rosaleda', 'estanque', 'semillero'];

function renderSheet(p: Project, l: Lang, s: Lookup): string {
  const id = esc(p.id);
  const latin = esc(latinOf(p, s));
  const priv = p.private === true ? `<p class="h-private">${esc(s('project.private'))}</p>` : '';
  return `<article class="h-sheet" id="p-${id}" data-flower="${id}" data-kind="${p.flower}" data-status="${p.status}" aria-labelledby="p-${id}-t">
<div class="h-mount" data-flower-slot><span class="h-corners"></span><span class="h-corners h-corners-low"></span><p class="h-mount-note">${esc(s('specimen.pending'))}<span class="h-mount-latin" lang="la">${latin}</span></p></div>
<div class="h-label">
<h4 class="h-title" id="p-${id}-t"><a class="h-open" href="#/p/${id}">${esc(p.title)}</a></h4>
<p class="h-latin" lang="la">${latin}</p>
<p class="h-oneliner">${text(p.oneLiner[l])}</p>
${list(p.stack.slice(0, 4).map(text), 'h-tags')}
<dl class="h-meta"><div><dt>${esc(s('project.status'))}</dt><dd class="h-status" data-status="${p.status}">${esc(s(`status.${p.status}`))}</dd></div><div><dt>${esc(s('project.year'))}</dt><dd class="h-year">${text(String(p.year))}</dd></div></dl>
${priv}
</div>
<details class="h-case"><summary>${esc(s('project.case'))}</summary><div class="h-case-body">${renderCaseBody(p, l, s)}</div></details>
</article>`;
}

function renderBed(c: HerbarioContent, bed: ProjectBed, l: Lang, s: Lookup): string {
  const projects = projectsOf(bed, c.projects);
  if (projects.length === 0) return '';
  const name = s(`bed.${bed}`);
  const gloss = s(`bed.${bed}.gloss`);
  return `<section class="h-bed" id="b-${bed}" data-bed="${bed}" aria-labelledby="b-${bed}-t">
<header class="h-bed-head"><h3 class="h-bed-title" id="b-${bed}-t">${esc(name)}</h3>${gloss === name ? '' : `<p class="h-bed-gloss">${esc(gloss)}</p>`}</header>
<div class="h-sheets">
${projects.map((p) => renderSheet(p, l, s)).join('\n')}
</div>
</section>`;
}

function fact(cls: string, heading: string, body: string): string {
  return `<section class="h-fact ${cls}"><h2 class="h-fact-title">${esc(heading)}</h2>${body}</section>`;
}

export function renderHerbario(c: HerbarioContent, l: Lang): string {
  const s: Lookup = (key) => lookup(c.strings, l, key);
  const pr = c.profile;
  const education = pr.education.map(
    (e) => `<span class="h-edu-title">${text(e.title[l])}</span><span class="h-edu-place">${text(e.place)}</span><span class="h-edu-status">${text(e.status[l])}</span>`,
  );
  const languages = pr.languages.map(
    (x) => `<span class="h-lang-name">${text(x.name[l])}</span><span class="h-lang-level">${text(c.strings[l][`level.${x.level}`] ?? x.level)}</span>`,
  );
  const contact = pr.links.map((x) => link(x.label[l], x.href, `h-contact-link h-contact-${esc(x.key)}`));

  return `<a class="h-skip" href="#projects">${esc(s('nav.skip'))}</a>
<header class="h-header">
<p class="h-site">${esc(s('site.title'))}</p>
<div class="h-hero">
<div class="h-id">
<h1 class="h-name">${esc(pr.name)}</h1>
<p class="h-alias">${esc(pr.alias)}</p>
</div>
<div class="h-intro">
<p class="h-role">${text(pr.headline[l])}</p>
<p class="h-location">${text(pr.location)}</p>
<section class="h-about" aria-labelledby="h-about-t"><h2 class="h-fact-title" id="h-about-t">${esc(s('section.about'))}</h2><p>${text(pr.about[l])}</p></section>
</div>
</div>
</header>
<main class="h-main">
<div class="h-facts">
${fact('h-education', s('section.education'), list(education, 'h-edu'))}
${fact('h-languages', s('section.languages'), list(languages, 'h-langs'))}
${fact('h-stack', s('section.stack'), list(pr.stack.map(text), 'h-tags'))}
${fact('h-contact', s('section.contact'), list(contact, 'h-contact-list'))}
</div>
<section class="h-projects" aria-labelledby="projects">
<h2 class="h-section-title" id="projects" tabindex="-1">${esc(s('section.projects'))}</h2>
${BEDS.map((b) => renderBed(c, b, l, s)).join('\n')}
</section>
</main>
<footer class="h-footer"><p>${esc(s('footer.type'))}</p></footer>`;
}
