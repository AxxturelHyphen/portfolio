import type { BedId, CameraRig, Machine, ScreenPt, State } from '../types.ts';
import { uiText } from './copy.ts';
import './styles/signs.css';
import { createMover, type Mover } from './xform.ts';

/**
 * Signposts (cook/ART.md section 4): while a bed is the current place, one sign points back to the previous place
 * and one on to the next (at La Salida the next is "To the CV"). Each is a real <button> on a night plate with the
 * place name and a drawn arrow. A click is the travel (GOTO), or the mode switch for the CV.
 * Where world supplies sign anchors (setAnchors), the label sits on its canvas board: projected each frame in stage
 * 'dom' (only when the rig moved), snapped to whole pixels, and docked to the nearest screen edge at the same height
 * when the board leaves the view, so a sign never disappears. Without anchors both signs dock at the screen edges
 * in the bottom third; on phones they stand above the folded plan, clear of the fixed controls and the hero.
 */

/** One canvas board: shown while `bed` is the current place; it points `dir` toward `to`. World point of the label. */
export interface SignAnchor { bed: BedId; to: BedId | 'cv'; dir: -1 | 1; at: readonly [number, number, number] }

export interface BedSign { id: BedId; title: string }

export interface Signposts {
  mount(beds: readonly BedSign[]): void;
  setAnchors(anchors: readonly SignAnchor[]): void;
  onState(s: State): void;
  /** Stage 'dom': places anchored signs; `force` after a remount or retarget. */
  sync(rig: CameraRig, force: boolean): void;
}

const EDGE_PX = 16;
/** Below the fixed labels and the exit hint that hangs under them. */
const TOP_PX = 120;
/** The board's stake below it (signs.css) stays on screen; a docked board stands with its foot at this height. */
const STAKE_PX = 58;
const DOCK_FOOT = 0.76;
const NARROW = '(max-width: 44.99rem)';
const SHOWN: readonly State['phase'][] = ['bed', 'focus'];
const ARROW = 'M1 6H17M12 1.5L17 6L12 10.5';

interface Sign {
  el: HTMLButtonElement;
  name: HTMLSpanElement;
  mover: Mover;
  dir: -1 | 1;
  to: BedId | 'cv' | null;
  /** Index into the anchors of the current bed, or -1 when docked. */
  anchor: number;
  w: number;
  h: number;
}

const pt: ScreenPt = { x: 0, y: 0, scale: 1, visible: true };

function makeSign(dir: -1 | 1, m: Machine): Sign {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'px-bed px-sign';
  el.dataset.dir = dir < 0 ? 'prev' : 'next';
  const name = document.createElement('span');
  name.className = 'px-sign-name';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'px-sign-arrow');
  svg.setAttribute('viewBox', '0 0 18 12');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ARROW);
  svg.append(path);
  el.append(name, svg);
  const sign: Sign = { el, name, mover: createMover(el), dir, to: null, anchor: -1, w: 140, h: 44 };
  el.addEventListener('click', () => {
    if (sign.to === 'cv') m.send({ type: 'SET_MODE', mode: 'herbario' });
    else if (sign.to !== null) m.send({ type: 'GOTO', place: { k: 'bed', bed: sign.to } });
  });
  return sign;
}

export function createSignposts(parent: HTMLElement, m: Machine): Signposts {
  const group = document.createElement('div');
  group.className = 'px-signs';
  const signs = [makeSign(-1, m), makeSign(1, m)] as const;
  group.append(signs[0].el, signs[1].el);
  parent.append(group);
  const narrow = matchMedia(NARROW);
  let beds: readonly BedSign[] = [];
  let anchors: readonly SignAnchor[] = [];
  let current: BedId | null = null;
  let vw = innerWidth;
  let vh = innerHeight;
  /** A new viewport or sign size re-places the signs on the next frame even when the rig stands still. */
  let resized = false;

  addEventListener('resize', () => {
    vw = innerWidth;
    vh = innerHeight;
    resized = true;
  }, { passive: true });
  const sizes = new ResizeObserver((entries) => {
    for (const e of entries) {
      const s = e.target === signs[0].el ? signs[0] : signs[1];
      const box = e.borderBoxSize[0];
      if (box === undefined) continue;
      s.w = box.inlineSize;
      s.h = box.blockSize;
      resized = true;
    }
  });
  sizes.observe(signs[0].el);
  sizes.observe(signs[1].el);

  function retarget(): void {
    const i = beds.findIndex((b) => b.id === current);
    const lang = m.state.lang;
    for (const s of signs) {
      const next = i < 0 ? undefined : beds[i + s.dir];
      s.to = i < 0 ? null : next !== undefined ? next.id : s.dir > 0 && i === beds.length - 1 ? 'cv' : null;
      s.el.hidden = s.to === null;
      if (s.to === null) continue;
      const title = s.to === 'cv' ? uiText(null, lang, 'sign.cv') : (next?.title ?? '');
      s.name.textContent = title;
      if (s.to === 'cv') {
        delete s.el.dataset.bed;
        s.el.removeAttribute('aria-label');
      } else {
        s.el.dataset.bed = s.to;
        s.el.setAttribute('aria-label', `${uiText(null, lang, 'sign.go')} ${title}`);
      }
      s.anchor = anchors.findIndex((a) => a.bed === current && a.dir === s.dir);
      s.el.toggleAttribute('data-docked', s.anchor < 0);
      s.mover.reset();
      if (s.anchor < 0) s.el.style.removeProperty('transform');
    }
  }

  function place(s: Sign, rig: CameraRig): void {
    const a = anchors[s.anchor];
    if (a === undefined) return;
    rig.project(a.at[0], a.at[1], a.at[2], pt);
    const maxX = vw - EDGE_PX - s.w;
    const maxY = vh - EDGE_PX - s.h - STAKE_PX;
    let x = pt.x - s.w / 2;
    let y = pt.y - s.h;
    if (!pt.visible) {
      x = s.dir < 0 ? EDGE_PX : maxX;
      y = vh * DOCK_FOOT - s.h;
    }
    s.mover.move(Math.round(x < EDGE_PX ? EDGE_PX : x > maxX ? maxX : x), Math.round(y < TOP_PX ? TOP_PX : y > maxY ? maxY : y), 1);
  }

  return {
    mount(next) {
      beds = next;
      retarget();
    },
    setAnchors(next) {
      anchors = next;
      retarget();
    },
    onState(s) {
      const at = SHOWN.includes(s.phase) ? s.bed : null;
      group.toggleAttribute('data-shown', at !== null);
      if (at === current) return;
      current = at;
      if (at !== null) retarget();
    },
    sync(rig, force) {
      if (current === null || narrow.matches || (!rig.changed && !force && !resized)) return;
      resized = false;
      for (let i = 0; i < signs.length; i++) {
        const s = signs[i];
        if (s !== undefined && s.anchor >= 0 && !s.el.hidden) place(s, rig);
      }
    },
  };
}
