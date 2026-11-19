import { loadContent, projectsOf } from '../content/load.ts';
import type { BedId, Machine, ProjectBed, State } from '../types.ts';
import { uiText } from './copy.ts';
import { clearCover, covers, setCover } from './cover.ts';
import './styles/plan.css';
import type { BedSign } from './signposts.ts';
import { gapFree, hasGap } from './welcome.rules.ts';

/**
 * The garden plan (cook/ART.md section 4), bottom left, also the index of the work. Folded: the dog-eared corner of a
 * paper map that reads "Projects". Open (click, or M): the owner's name, place and gap-free headline (the first-visit
 * plate folds into here), one button per project in bed order, then a strip plan drawn in pencil line on card
 * (hatched wall, winding path, pond, beds, tree) with one button per place, and a small moth in pale rose over the
 * place where the visitor is (in free roam it follows the visitor along the strip, between the places by their
 * anchors). A place button travels there (GOTO). A project button folds the plan and dispatches WORK_EVENT (detail: the
 * project id) for the garden to walk the visitor to that flower and focus it (ui/plan.walk.ts). Esc folds the plan
 * first (the garden's own Esc then waits for the next press), and focus returns to the label. No visited marks and no
 * grotto. While open, the box the sheet and its corner take is written to ui/cover.ts for the cane labels.
 */

export interface Plan {
  mount(beds: readonly BedSign[]): void;
  onState(s: State): void;
  /** Free roam: the moth follows the visitor at [x, z]; places sit at their anchors' x. */
  follow(at: Float32Array, anchors: Readonly<Record<BedId, number>>): void;
  /** Stage 'dom': moves the following moth while the plan is open (only when it moved a hundredth of a place). */
  sync(): void;
}

/** Dispatched (bubbling) by a project button of the plan; detail: the project id. */
export const WORK_EVENT = 'jardin:work';

/** A following moth is moved again once the visitor has gone this share of a place. */
const MOTH_STEP = 0.01;

const SVG = 'http://www.w3.org/2000/svg';
const W = 360;
const H = 104;
const MOTH = 'M7 3.6C5.6 1 2 0.6 1 2.2C0.2 3.8 2.4 5.6 5.6 5.4C3 6.2 2.2 8.4 3.6 9.2C5 9.8 6.4 7.8 7 5.8C7.6 7.8 9 9.8 10.4 9.2C11.8 8.4 11 6.2 8.4 5.4C11.6 5.6 13.8 3.8 13 2.2C12 0.6 8.4 1 7 3.6Z';

/**
 * The engraved strip: the closed garden (hatched wall along the back, the two end walls, the low kerb along the front),
 * the winding path, then one small motif per place.
 */
const WALL = `M4 10H${W - 4}M4 18H${W - 4}${Array.from({ length: 44 }, (_, i) => `M${8 + i * 8} 18L${14 + i * 8} 10`).join('')}`
  + `M4 10V98M10 18V95M${W - 4} 10V98M${W - 10} 18V95M4 98H${W - 4}M10 95H${W - 10}`;
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

function para(cls: string, id?: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = cls;
  if (id !== undefined) p.id = id;
  return p;
}

export function createPlan(parent: HTMLElement, m: Machine): Plan {
  const content = loadContent();
  const isProjectBed = (b: BedId): b is ProjectBed => content.projects.some((p) => p.bed === b);
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
  sheet.inert = true;
  const name = para('pl-name');
  const about = para('pl-about');
  const workTitle = para('pl-title', 'pl-work-title');
  const work = document.createElement('ul');
  work.className = 'pl-work';
  work.setAttribute('aria-labelledby', 'pl-work-title');
  const title = para('pl-title');
  const map = document.createElement('div');
  map.className = 'pl-map';
  const drawing = svg('pl-drawing', `0 0 ${W} ${H}`, [WALL, PATH, TREE, ...Object.values(MOTIFS)]);
  const moth = svg('pl-moth', '0 0 14 10', [MOTH]);
  const places = document.createElement('ul');
  places.className = 'pl-places';
  map.append(drawing, moth, places);
  sheet.append(name, about, workTitle, work, title, map);
  root.append(sheet, tag);
  parent.append(root);

  let beds: readonly BedSign[] = [];
  let here: BedId | null = null;
  let visitor: Float32Array | null = null;
  let anchorOf: Readonly<Record<BedId, number>> | null = null;
  let shownCol = Number.NaN;

  /** The visitor's place along the strip as a fractional column: linear between neighbouring places' anchors. */
  function colOf(x: number, anchors: Readonly<Record<BedId, number>>): number {
    let a = anchors[beds[0]!.id];
    if (x <= a) return 0;
    for (let i = 1; i < beds.length; i++) {
      const b = anchors[beds[i]!.id];
      if (x <= b) return i - 1 + (x - a) / Math.max(1e-6, b - a);
      a = b;
    }
    return beds.length - 1;
  }

  /** The open sheet's laid-out box (transforms aside) from the corner's foot up; read on open, resize and sheet resize. */
  function writeCover(): void {
    if (!isOpen()) {
      clearCover(covers.plan);
      return;
    }
    const foot = root.getBoundingClientRect();
    setCover(covers.plan, foot.left, foot.top + sheet.offsetTop, foot.left + Math.max(sheet.offsetWidth, tag.offsetWidth), foot.bottom);
  }
  new ResizeObserver(writeCover).observe(sheet);
  addEventListener('resize', writeCover, { passive: true });

  function setOpen(open: boolean, refocus: boolean): void {
    shownCol = Number.NaN;
    root.toggleAttribute('data-open', open);
    writeCover();
    tag.setAttribute('aria-expanded', String(open));
    sheet.inert = !open;
    if (!open && refocus && sheet.contains(document.activeElement)) tag.focus({ preventScroll: true });
  }
  const isOpen = (): boolean => root.hasAttribute('data-open');

  function paintHere(): void {
    const i = beds.findIndex((b) => b.id === here);
    moth.toggleAttribute('data-off', i < 0 && visitor === null);
    if (i >= 0 && visitor === null) moth.style.setProperty('--col', String(i));
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
  work.addEventListener('click', (e) => {
    const id = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-project]')?.dataset.project : undefined;
    if (id === undefined) return;
    setOpen(false, true);
    root.dispatchEvent(new CustomEvent(WORK_EVENT, { detail: id, bubbles: true }));
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
      const text = (key: string): string => uiText(content.strings, lang, key);
      const profile = content.profile;
      const line = gapFree(profile.headline[lang]);
      name.textContent = profile.name;
      about.textContent = line === '' ? profile.location[lang] : `${profile.location[lang]} · ${line}`;
      workTitle.textContent = text('section.projects');
      title.textContent = text('plan.title');
      tag.textContent = text('plan.tag');
      tag.setAttribute('aria-label', text('plan.label'));
      sheet.setAttribute('aria-label', text('plan.label'));
      work.replaceChildren(...next.flatMap((b) => (isProjectBed(b.id) ? projectsOf(b.id, content.projects) : [])).filter((p) => !hasGap(p.title)).map((p) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.project = p.id;
        btn.textContent = p.title;
        li.append(btn);
        return li;
      }));
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
    follow(at, anchors) {
      visitor = at;
      anchorOf = anchors;
      shownCol = Number.NaN;
      paintHere();
    },
    sync() {
      if (visitor === null || anchorOf === null || beds.length === 0 || !isOpen()) return;
      const col = colOf(visitor[0]!, anchorOf);
      if (Math.abs(col - shownCol) < MOTH_STEP) return;
      shownCol = col;
      moth.style.setProperty('--col', col.toFixed(3));
    },
  };
}
