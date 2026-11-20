import type { BedId, CameraRig, Machine, ScreenPt, State } from '../types.ts';
import { uiText } from './copy.ts';
import { makeSign, readTilt, type Sign } from './signs.label.ts';
import './styles/signs.css';

/**
 * Signposts (cook/ART.md section 4): while a bed is the current place, one sign points back to the previous place
 * and one on to the next (at La Salida the next is "To the CV"). Each is a real <button>; a click is the travel
 * (GOTO), or the mode switch for the CV.
 * Rail (`?roam=0`): a slim painted garden label lashed with twine to a bamboo cane, lettered with the place name, with an
 * engraved pointing hand (a manicule) showing the way. Where world supplies sign anchors (setAnchors), the label sits
 * on its canvas board: projected each frame in stage 'dom' (only when the rig moved), snapped to whole pixels, and
 * docked to the nearest screen edge at the same height when the board leaves the view. The label's CSS tilt turns the
 * per-frame translate too (read once per retarget): where that turn would carry the label nearer a side than SIDE_PX,
 * the offset is pulled in. Without anchors both signs dock at the screen edges in the lower half; on phones the way
 * back stands above the folded plan and the way on at the foot of the screen. The way back always stands higher than
 * the way on, so the pair never reads as one row.
 * Free roam (setRoam): the signs are painted planks standing in the world (garden/signs.drive.ts). The button is the
 * plank's keyboard, screen-reader and click target: transparent, laid over the plank's board by transform (its centre
 * projected, scaled to the board's size, never under a 44 px tap target), and it moves only with the camera. Its ring
 * shows on keyboard focus only. While the board is off screen the button lets the pointer through (data-off) but
 * stays in the Tab order, held inside the screen edge so its focus ring shows where focus is. data-anchor names the
 * sign it covers, for the world's hover and focus.
 */

/** One canvas board: shown while `bed` is the current place; it points `dir` toward `to`. World point of the label,
 * and under free roam the board's size (m), the label point then being the board's centre. */
export interface SignAnchor { bed: BedId; to: BedId | 'cv'; dir: -1 | 1; at: readonly [number, number, number]; board?: readonly [number, number] }

export interface BedSign { id: BedId; title: string }

export interface Signposts {
  mount(beds: readonly BedSign[]): void;
  setAnchors(anchors: readonly SignAnchor[]): void;
  onState(s: State): void;
  /** Stage 'dom': places anchored signs; `force` after a remount or retarget. */
  sync(rig: CameraRig, force: boolean): void;
  /** Free roam: the buttons lie over the planks standing in the world. */
  setRoam(): void;
}

const EDGE_PX = 16;
/** Least room between a label's turned box and the left or right edge of the screen. */
const SIDE_PX = 40;
/** Below the fixed labels and the exit hint that hangs under them. */
const TOP_PX = 120;
/** Room kept under a label so its cane shows before it leaves the screen. */
const STAKE_PX = 48;
const DOCK_FOOT = 0.7;
/** Half the height step between the way back (higher) and the way on (lower). */
const STEP_PX = 40;
const NARROW = '(max-width: 44.99rem)';
const SHOWN: readonly State['phase'][] = ['bed', 'focus'];
/** Free roam: the button is laid out at this many px per metre of the board; the transform scales it to the projection. */
const BOARD_PX_M = 100;
/** Free roam: the least tap target (px) and, for a board off screen, how far inside the edge its button is held. */
const TARGET_PX = 44;
const OFF_EDGE_PX = 96;
const pt: ScreenPt = { x: 0, y: 0, scale: 1, visible: true };

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
  let roam = false;

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

  /** Free roam: the button sized to the board it covers, centred on its place. */
  function fit(s: Sign, a: SignAnchor | undefined): void {
    s.el.dataset['anchor'] = String(s.anchor);
    const w = (a?.board?.[0] ?? 0) * BOARD_PX_M;
    const h = (a?.board?.[1] ?? 0) * BOARD_PX_M;
    s.el.style.width = `${w}px`;
    s.el.style.height = `${h}px`;
    s.el.style.marginLeft = `${-w / 2}px`;
    s.el.style.marginTop = `${-h / 2}px`;
    s.least = h > 0 ? TARGET_PX / h : 1;
  }

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
      if (roam) fit(s, anchors[s.anchor]);
      else if (s.anchor < 0) s.el.style.removeProperty('transform');
      else readTilt(s);
    }
  }

  /** Turns the label's wanted top-left (x, y) into its transform: the tilt turns the translate, so it is undone, and
   * the turned box is pulled in where it would come nearer a side than SIDE_PX. */
  function settle(s: Sign, x: number, y: number): void {
    let vx = x * s.cos - y * s.sin;
    const inset = SIDE_PX + Math.ceil(s.h * Math.abs(s.sin));
    const maxVx = vw - inset - s.w;
    vx = vx < inset ? inset : vx > maxVx ? maxVx : vx;
    const vy = x * s.sin + y * s.cos;
    s.mover.move(Math.round(vx * s.cos + vy * s.sin), Math.round(vy * s.cos - vx * s.sin), 1);
  }

  /** Free roam: the button over its board, or held inside the screen edge (data-off) while the board is off screen. */
  function cover(s: Sign, a: SignAnchor, rig: CameraRig): void {
    rig.project(a.at[0], a.at[1], a.at[2], pt);
    const off = !pt.visible;
    if (off !== s.off) {
      s.off = off;
      s.el.toggleAttribute('data-off', off);
    }
    const k = pt.scale / BOARD_PX_M;
    if (!off) {
      s.mover.move(pt.x, pt.y, k > s.least ? k : s.least);
      return;
    }
    const x = pt.scale > 0 ? pt.x : vw / 2 + s.dir * vw;
    const y = pt.scale > 0 ? pt.y : vh / 2;
    const maxX = vw - OFF_EDGE_PX;
    const maxY = vh - OFF_EDGE_PX;
    s.mover.move(x < OFF_EDGE_PX ? OFF_EDGE_PX : x > maxX ? maxX : x, y < OFF_EDGE_PX ? OFF_EDGE_PX : y > maxY ? maxY : y, 1);
  }

  function place(s: Sign, rig: CameraRig): void {
    const a = anchors[s.anchor];
    if (a === undefined) return;
    if (roam) {
      cover(s, a, rig);
      return;
    }
    rig.project(a.at[0], a.at[1], a.at[2], pt);
    const maxX = vw - EDGE_PX - s.w;
    const maxY = vh - EDGE_PX - s.h - STAKE_PX;
    let x = pt.x - s.w / 2;
    let y = pt.y - s.h;
    if (!pt.visible) {
      x = s.dir < 0 ? EDGE_PX : maxX;
      y = vh * DOCK_FOOT - s.h;
    }
    y += s.dir * STEP_PX;
    x = x < EDGE_PX ? EDGE_PX : x > maxX ? maxX : x;
    y = y < TOP_PX ? TOP_PX : y > maxY ? maxY : y;
    settle(s, x, y);
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
      if (current === null || (narrow.matches && !roam) || (!rig.changed && !force && !resized)) return;
      resized = false;
      for (let i = 0; i < signs.length; i++) {
        const s = signs[i]!;
        if (s.anchor >= 0 && !s.el.hidden) place(s, rig);
      }
    },
    setRoam() {
      roam = true;
      group.toggleAttribute('data-roam', true);
      retarget();
    },
  };
}
