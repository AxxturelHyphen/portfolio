import { loadContent } from '../content/load.ts';
import { CREDITS_HASH } from '../core/router.ts';
import type { BedId, Machine, State } from '../types.ts';
import { uiText } from './copy.ts';
import { createPlanIndex } from './plan.index.ts';
import { createPlanMap } from './plan.map.ts';
import './styles/plan.css';
import type { BedSign } from './signposts.ts';
import { gapFree } from './welcome.rules.ts';

/**
 * The garden plan (cook/ART.md section 4), bottom left, also the index of the work. Folded: the dog-eared corner of a
 * paper map that reads "Projects". Open (click, or M): a compact card unfolds out of that corner. Along its top the
 * owner's name, place and gap-free headline, and the link to the credits (ui/credits.route.ts opens them); below, on
 * the left, a paper diorama of the garden in CSS 3D (ui/plan.map.ts) with one standing card per place and a small moth
 * in pale rose over the place where the visitor is (in free roam it follows the visitor along the path, between the
 * places by their anchors); on the right the index of the work by bed, each project with its status
 * (ui/plan.index.ts). A place card travels there (GOTO). A project button folds the plan and dispatches WORK_EVENT
 * (detail: the project id) for the garden to walk the visitor to that flower and focus it (ui/plan.walk.ts). Arrow
 * keys move along the places and through the projects, Home and End jump to the ends. Esc folds the plan first (the
 * garden's own Esc then waits for the next press), and focus returns to the label.
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

function para(cls: string, id?: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = cls;
  if (id !== undefined) p.id = id;
  return p;
}

/** Arrow keys within a group of buttons: the previous or next one, or either end; null for any other key. */
function stepTo(key: string, all: readonly HTMLButtonElement[], at: number, back: string, on: string): HTMLButtonElement | null {
  if (key === 'Home') return all[0] ?? null;
  if (key === 'End') return all[all.length - 1] ?? null;
  if (key === back) return all[Math.max(0, at - 1)] ?? null;
  if (key === on) return all[Math.min(all.length - 1, at + 1)] ?? null;
  return null;
}

export function createPlan(parent: HTMLElement, m: Machine): Plan {
  const content = loadContent();
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
  const head = document.createElement('header');
  head.className = 'pl-head';
  const name = para('pl-name');
  const about = para('pl-about');
  const credits = document.createElement('a');
  credits.className = 'pl-credits';
  credits.href = CREDITS_HASH;
  head.append(name, about, credits);
  const map = createPlanMap();
  const workTitle = para('pl-title', 'pl-work-title');
  const work = document.createElement('ul');
  work.className = 'pl-work';
  work.setAttribute('aria-labelledby', 'pl-work-title');
  const index = createPlanIndex(work);
  sheet.append(head, map.el, workTitle, work);
  root.append(sheet, tag);
  parent.append(root);

  let beds: readonly BedSign[] = [];
  let here: BedId | null = null;
  let visitor: Float32Array | null = null;
  let anchorOf: Readonly<Record<BedId, number>> | null = null;
  let shownCol = Number.NaN;
  let box: DOMRect | null = null;

  /** The visitor's place along the path as a fractional column: linear between neighbouring places' anchors. */
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

  /** The diorama's lean after the pointer, each axis in [-1, 1]; 0, 0 rests it. */
  function lean(px: number, py: number): void {
    map.el.style.setProperty('--px', px.toFixed(2));
    map.el.style.setProperty('--py', py.toFixed(2));
  }

  function setOpen(open: boolean, refocus: boolean): void {
    shownCol = Number.NaN;
    root.toggleAttribute('data-open', open);
    tag.setAttribute('aria-expanded', String(open));
    sheet.inert = !open;
    if (!open) lean(0, 0);
    if (!open && refocus && sheet.contains(document.activeElement)) tag.focus({ preventScroll: true });
  }
  const isOpen = (): boolean => root.hasAttribute('data-open');

  function paintHere(): void {
    const i = beds.findIndex((b) => b.id === here);
    if (visitor === null) map.moveMoth(i < 0 ? null : i);
    map.mark(here);
    index.mark(here);
  }

  tag.addEventListener('click', () => setOpen(!isOpen(), false));
  map.places.addEventListener('click', (e) => {
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
  sheet.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLButtonElement)) return;
    const inPlaces = map.places.contains(t);
    if (!inPlaces && !work.contains(t)) return;
    const all = [...(inPlaces ? map.places : work).querySelectorAll<HTMLButtonElement>('button')];
    const at = all.indexOf(t);
    const next = inPlaces ? stepTo(e.key, all, at, 'ArrowLeft', 'ArrowRight') : stepTo(e.key, all, at, 'ArrowUp', 'ArrowDown');
    if (next === null) return;
    e.preventDefault();
    next.focus();
  });
  sheet.addEventListener('pointerenter', () => {
    box = map.el.getBoundingClientRect();
  });
  sheet.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || m.state.reduced || box === null || !isOpen()) return;
    const px = Math.max(-1, Math.min(1, ((e.clientX - box.left) / box.width) * 2 - 1));
    const py = Math.max(-1, Math.min(1, ((e.clientY - box.top) / box.height) * 2 - 1));
    lean(px, py);
  }, { passive: true });
  sheet.addEventListener('pointerleave', () => lean(0, 0));
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
      tag.textContent = text('plan.tag');
      credits.textContent = text('credits.link');
      tag.setAttribute('aria-label', text('plan.label'));
      sheet.setAttribute('aria-label', text('plan.label'));
      map.mount(next, text('plan.title'));
      index.mount(next, content.projects, (s) => text(`status.${s}`));
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
      map.moveMoth(col);
    },
  };
}
