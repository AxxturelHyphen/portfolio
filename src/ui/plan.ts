import type { BedId, Machine, State } from '../types.ts';
import { uiText } from './copy.ts';
import './styles/plan.css';
import type { BedSign } from './signposts.ts';

/**
 * The garden plan (cook/ART.md section 4), bottom left. Folded: the dog-eared corner of a paper map that reads "Plan".
 * Open (click, or M): a strip plan drawn in pencil line on card (hatched wall, winding path, pond, beds, tree) with
 * one button per place, and a small moth in pale rose over the place where the visitor is. A place button travels
 * there (GOTO). Esc folds the plan first (the garden's own Esc then waits for the next press), and focus returns to
 * the label. No visited marks and no grotto.
 */

export interface Plan {
  mount(beds: readonly BedSign[]): void;
  onState(s: State): void;
}

const SVG = 'http://www.w3.org/2000/svg';
const W = 360;
const H = 104;
const MOTH = 'M7 3.6C5.6 1 2 0.6 1 2.2C0.2 3.8 2.4 5.6 5.6 5.4C3 6.2 2.2 8.4 3.6 9.2C5 9.8 6.4 7.8 7 5.8C7.6 7.8 9 9.8 10.4 9.2C11.8 8.4 11 6.2 8.4 5.4C11.6 5.6 13.8 3.8 13 2.2C12 0.6 8.4 1 7 3.6Z';

/** The engraved strip: wall with hatching along the back, the winding path, then one small motif per place. */
const WALL = `M4 10H${W - 4}M4 18H${W - 4}${Array.from({ length: 44 }, (_, i) => `M${8 + i * 8} 18L${14 + i * 8} 10`).join('')}`;
const PATH = `M4 72C40 60 60 84 100 74S160 58 200 72S270 88 300 70S340 62 ${W - 4} 70`;
const MOTIFS: Partial<Record<BedId, string>> = {
  puerta: 'M26 28V56M46 28V56M23 28H29M43 28H49M29 40C32 34 40 34 43 40',
  rosaleda: 'M88 32H128V54H88ZM98 43A3 3 0 1 0 98.1 43M108 43A3 3 0 1 0 108.1 43M118 43A3 3 0 1 0 118.1 43',
  estanque: 'M160 44C160 36 200 36 200 44C200 52 160 52 160 44ZM170 44C176 42 184 42 190 44',
  semillero: 'M232 34H250V54H232ZM254 34H272V54H254ZM241 40V48M263 40V48',
  salida: 'M312 56V34C312 28 336 28 336 34V56M304 26C310 22 314 30 320 24M340 22V54M334 30H346',
};
const TREE = 'M144 31A7 7 0 1 1 144.1 31M144 38V54';

function svg(cls: string, box: string, paths: readonly string[]): SVGSVGElement {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('viewBox', box);
  s.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}

export function createPlan(parent: HTMLElement, m: Machine): Plan {
  const root = document.createElement('div');
  root.className = 'pl';
  const tag = document.createElement('button');
  tag.type = 'button';
  tag.className = 'pl-tag';
  tag.setAttribute('aria-expanded', 'false');
  tag.setAttribute('aria-controls', 'pl-sheet');
  tag.setAttribute('aria-keyshortcuts', 'M');
  const sheet = document.createElement('section');
  sheet.className = 'pl-sheet';
  sheet.id = 'pl-sheet';
  sheet.setAttribute('aria-labelledby', 'pl-title');
  sheet.inert = true;
  const title = document.createElement('p');
  title.className = 'pl-title';
  title.id = 'pl-title';
  const map = document.createElement('div');
  map.className = 'pl-map';
  const drawing = svg('pl-drawing', `0 0 ${W} ${H}`, [WALL, PATH, TREE, ...Object.values(MOTIFS)]);
  const moth = svg('pl-moth', '0 0 14 10', [MOTH]);
  const places = document.createElement('ul');
  places.className = 'pl-places';
  map.append(drawing, moth, places);
  sheet.append(title, map);
  root.append(sheet, tag);
  parent.append(root);

  let beds: readonly BedSign[] = [];
  let here: BedId | null = null;

  function setOpen(open: boolean, refocus: boolean): void {
    root.toggleAttribute('data-open', open);
    tag.setAttribute('aria-expanded', String(open));
    sheet.inert = !open;
    if (!open && refocus && sheet.contains(document.activeElement)) tag.focus({ preventScroll: true });
  }
  const isOpen = (): boolean => root.hasAttribute('data-open');

  function paintHere(): void {
    const i = beds.findIndex((b) => b.id === here);
    moth.toggleAttribute('data-off', i < 0);
    if (i >= 0) moth.style.setProperty('--col', String(i));
    for (const b of places.querySelectorAll<HTMLButtonElement>('button')) {
      if (b.dataset.bed === here) b.setAttribute('aria-current', 'location');
      else b.removeAttribute('aria-current');
    }
  }

  tag.addEventListener('click', () => setOpen(!isOpen(), false));
  places.addEventListener('click', (e) => {
    const bed = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-bed]')?.dataset.bed : undefined;
    const target = beds.find((b) => b.id === bed);
    if (target !== undefined) m.send({ type: 'GOTO', place: { k: 'bed', bed: target.id } });
  });
  document.addEventListener('keydown', (e) => {
    if (m.state.mode !== 'garden' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable], dialog')) return;
    if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      setOpen(false, true);
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      setOpen(!isOpen(), true);
    }
  }, { capture: true });

  return {
    mount(next) {
      beds = next;
      const lang = m.state.lang;
      const label = uiText(null, lang, 'plan.title');
      title.textContent = label;
      tag.textContent = uiText(null, lang, 'plan.tag');
      tag.setAttribute('aria-label', label);
      places.style.setProperty('--cols', String(next.length));
      places.replaceChildren(...next.map((b) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.bed = b.id;
        btn.textContent = b.title;
        li.append(btn);
        return li;
      }));
      paintHere();
    },
    onState(s) {
      const at = s.phase === 'overview' || s.phase === 'intro' ? null : s.bed;
      if (at === here) return;
      here = at;
      paintHere();
    },
  };
}
