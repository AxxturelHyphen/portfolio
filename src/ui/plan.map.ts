import type { BedId } from '../types.ts';
import './styles/plan.map.css';
import type { BedSign } from './signposts.ts';

/**
 * The plan's map: a paper diorama of the garden in CSS 3D (perspective on the stage, the board tipped back by
 * rotateX). The board is card stock drawn in pencil line (hatched back wall, end walls, kerb, the winding path, the
 * pond); on it one raised card bed per place, and standing up from each bed a small card (the place's button) with its
 * motif and name, turned to face the eye. Unfolding, the cards rise from the board one after the other. The moth
 * hovers over the path above the visitor's place, its shadow on the board. The board leans a little after the pointer
 * (ui/plan.ts sets --px and --py), never under reduced motion. Transform and opacity only.
 */

export interface PlanMap {
  readonly el: HTMLElement;
  readonly places: HTMLUListElement;
  readonly moth: HTMLElement;
  mount(beds: readonly BedSign[], label: string): void;
  /** Marks the current place; null clears it. */
  mark(here: BedId | null): void;
  /** The moth over this fractional column, or hidden (null). */
  moveMoth(col: number | null): void;
}

const SVG = 'http://www.w3.org/2000/svg';
/** The board's drawing box; the CSS keeps the same 5:3 aspect. */
const W = 340;
const H = 204;
/** The path's depth on the board (share of its height) at the places, alternating to wind. */
const PATH_Y = [0.64, 0.8];
const MOTH = 'M7 3.6C5.6 1 2 0.6 1 2.2C0.2 3.8 2.4 5.6 5.6 5.4C3 6.2 2.2 8.4 3.6 9.2C5 9.8 6.4 7.8 7 5.8C7.6 7.8 9 9.8 10.4 9.2C11.8 8.4 11 6.2 8.4 5.4C11.6 5.6 13.8 3.8 13 2.2C12 0.6 8.4 1 7 3.6Z';

/** One small motif per place, drawn in a 32 x 20 box on its standing card. */
const MOTIFS: Partial<Record<BedId, string>> = {
  puerta: 'M8 19V5M24 19V5M5 5H11M21 5H27M11 11C14 6 18 6 21 11',
  rosaleda: 'M10 9A3 3 0 1 0 10.1 9M16 7A3 3 0 1 0 16.1 7M22 9A3 3 0 1 0 22.1 9M10 12V19M16 10V19M22 12V19M6 19H26',
  estanque: 'M4 14C4 9 28 9 28 14C28 19 4 19 4 14ZM10 14C14 12.5 18 12.5 22 14M22 4A3 3 0 1 0 22.1 4',
  semillero: 'M4 12H14V19H4ZM18 12H28V19H18ZM9 12V7M23 12V6M9 8C7 6 6 6 5 7M23 7C25 5 26 5 27 6',
  salida: 'M10 19V8C10 3 22 3 22 8V19M6 19H26M27 2V19',
};

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

function span(cls: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  return s;
}

/** Walls and kerb of the closed garden, the same for any number of places. */
function wallsPath(): string {
  const hatch = Array.from({ length: 41 }, (_, i) => `M${8 + i * 8} 22L${14 + i * 8} 12`).join('');
  return `M6 12H${W - 6}M6 22H${W - 6}${hatch}M6 12V${H - 8}M14 22V${H - 14}M${W - 6} 12V${H - 8}M${W - 14} 22V${H - 14}`
    + `M6 ${H - 8}H${W - 6}M14 ${H - 14}H${W - 14}`;
}

/** The path winding through every place's column, smooth between them. */
function pathThrough(n: number): string {
  const x = (i: number): number => ((i + 0.5) / n) * W;
  const y = (i: number): number => (PATH_Y[i % 2] ?? 0.7) * H;
  let d = `M14 ${y(0)}L${x(0)} ${y(0)}`;
  for (let i = 1; i < n; i++) {
    const mid = (x(i - 1) + x(i)) / 2;
    d += `C${mid} ${y(i - 1)} ${mid} ${y(i)} ${x(i)} ${y(i)}`;
  }
  return `${d}L${W - 14} ${y(n - 1)}`;
}

export function createPlanMap(): PlanMap {
  const el = document.createElement('div');
  el.className = 'pl-map';
  const board = span('pl-board');
  const drawing = svg('pl-drawing', `0 0 ${W} ${H}`, []);
  const places = document.createElement('ul');
  places.className = 'pl-places';
  const moth = span('pl-moth');
  moth.setAttribute('aria-hidden', 'true');
  const fly = svg('pl-fly', '0 0 14 10', [MOTH]);
  moth.append(span('pl-shade'), fly);
  board.append(drawing, places, moth);
  el.append(board);

  return {
    el,
    places,
    moth,
    mount(beds, label) {
      const n = beds.length;
      el.style.setProperty('--cols', String(n));
      places.setAttribute('aria-label', label);
      const walls = document.createElementNS(SVG, 'path');
      walls.setAttribute('d', wallsPath());
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('class', 'pl-path');
      path.setAttribute('d', pathThrough(n));
      drawing.replaceChildren(walls, path);
      places.replaceChildren(...beds.map((b, i) => {
        const li = document.createElement('li');
        li.style.setProperty('--i', String(i));
        li.style.setProperty('--at', String(PATH_Y[i % 2] ?? 0.7));
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pl-stand';
        btn.dataset.bed = b.id;
        const motif = MOTIFS[b.id];
        if (motif !== undefined) btn.append(svg('pl-motif', '0 0 32 20', [motif]));
        const name = span('pl-place');
        name.textContent = b.title;
        btn.append(name);
        const plot = span('pl-plot');
        plot.setAttribute('aria-hidden', 'true');
        li.append(plot, btn);
        return li;
      }));
    },
    mark(here) {
      for (const b of places.querySelectorAll<HTMLButtonElement>('button')) {
        if (b.dataset.bed === here) b.setAttribute('aria-current', 'location');
        else b.removeAttribute('aria-current');
      }
    },
    moveMoth(col) {
      moth.toggleAttribute('data-off', col === null);
      if (col === null) return;
      const i = Math.floor(col);
      const a = PATH_Y[i % 2] ?? 0.7;
      const b = PATH_Y[(i + 1) % 2] ?? 0.7;
      moth.style.setProperty('--col', col.toFixed(3));
      moth.style.setProperty('--my', (a + (b - a) * (col - i)).toFixed(3));
    },
  };
}
