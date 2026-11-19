import type { CameraRig, ScreenPt, SlotId, SlotView } from '../types.ts';
import type { FigureBox } from './signs.stake.ts';

/**
 * Portrait free roam: where the docked cane labels stand (ui/signposts.ts). Pure, so the rules are unit tested
 * (tests/unit/ui/phone.spec.ts). No allocation.
 */

/** A docked label's whole box (label turned by its tilt and its twine curl, measured from layout): its size in, its top-left out (px). */
export interface DockBox { w: number; h: number; x: number; y: number; on: boolean }

/**
 * The docked labels' band (px): gap to the figure; the gap between the pair and the least it may shrink to before the
 * pair stands as a column; the step down of the way on; the side margin wanted and its hard floor; the top row of tags;
 * the folded plan corner; the sideways and downward search steps. A docked label has no cane drawn (ui/styles/signs.css).
 */
export const DOCK = {
  gapPx: 8, pairPx: 24, pairMinPx: 16, stepPx: 14, edgePx: 16, edgeMinPx: 8, topPx: 120, bottomPx: 16, planW: 184, planPx: 132,
  shiftPx: 6, dropPx: 4,
} as const;

/** What the band must stay clear of, filled by the caller every frame (no allocation). */
export interface DockRoom {
  fig: FigureBox;
  vw: number;
  vh: number;
  safeLeft: number;
  safeRight: number;
  /** The lowest the labels' feet may reach: the top of the plant sheet on phones, else vh. */
  floor: number;
  /** Boxes a docked label never covers: the focused flower and the nearest project flower in front of the visitor. */
  avoid: readonly FigureBox[];
  avoidN: number;
}

/** The lowest top of a docked label: over the folded plan where it reaches the left corner, over the sheet, else over the edge. */
function floorOf(b: Readonly<DockBox>, r: Readonly<DockRoom>): number {
  const edge = r.vh - (b.x < DOCK.planW ? DOCK.planPx : DOCK.bottomPx);
  return Math.min(edge, r.floor - DOCK.gapPx) - b.h;
}

function clear(b: Readonly<DockBox>, r: Readonly<DockRoom>): boolean {
  if (!b.on) return true;
  if (b.y > floorOf(b, r) || b.y < DOCK.topPx) return false;
  const bottom = b.y + b.h;
  for (let i = 0; i < r.avoidN; i++) {
    const a = r.avoid[i]!;
    if (b.x < a.r && b.x + b.w > a.l && b.y < a.b && bottom > a.t) return false;
  }
  return true;
}

/** Sideways offsets in search order: 0, -s, s, -2s, 2s, ... */
const shiftAt = (i: number): number => (i === 0 ? 0 : (i & 1 ? -1 : 1) * Math.ceil(i / 2) * DOCK.shiftPx);

/** The pair's resting layout for one dockAround call (module scratch, no allocation). */
const lay = { px: 0, nx: 0, drop: 0, minShift: 0, maxShift: 0 };

/** Puts the pair with its band top at `top`, slid by dx; whether both labels are clear there. */
function tryAt(r: Readonly<DockRoom>, prev: DockBox, next: DockBox, top: number, dx: number): boolean {
  if (dx < lay.minShift || dx > lay.maxShift) return false;
  prev.x = lay.px + dx;
  next.x = lay.nx + dx;
  if (prev.on) prev.y = top;
  next.y = prev.on ? top + lay.drop : top;
  return clear(prev, r) && clear(next, r);
}

/**
 * Places the docked pair. Both on one row when their whole boxes keep DOCK.pairPx apart with at least edgeMinPx to the
 * sides (the gap shrinks to pairMinPx only once the sides are at that floor): the row centred on the screen (so 16 px
 * or more to the sides wherever the width allows), the way on a step lower; else the way on stands under the way back, each at its own side. One label alone stands on its own side of the
 * middle. The band's top is just under the visitor's shoes; where it would cover the focused flower or the nearest
 * flower in front, it slides sideways within the side margins, then drops by up to one label height, never under the
 * plan corner, the sheet or the bottom edge. With no sheet up and no room under the shoes, the band stands over the
 * hat instead. Returns false when nothing fits: the caller hides the labels (still reachable by keyboard), which then
 * stand under the top row.
 */
export function dockAround(r: Readonly<DockRoom>, prev: DockBox, next: DockBox): boolean {
  const D = DOCK;
  const lo = r.safeLeft;
  const hi = r.vw - r.safeRight;
  const both = prev.on && next.on;
  const widths = both ? prev.w + next.w : prev.on ? prev.w : next.w;
  const free = hi - lo - widths;
  const pair = both ? Math.max(D.pairMinPx, Math.min(D.pairPx, free - 2 * D.edgeMinPx)) : 0;
  const row = !both || free - pair >= 2 * D.edgeMinPx;
  const edge = row ? Math.max(D.edgeMinPx, Math.min(D.edgePx, (free - pair) / 2)) : D.edgeMinPx;
  const mid = (lo + hi) / 2;
  if (both && row) {
    lay.px = mid - (widths + pair) / 2;
    lay.nx = lay.px + prev.w + pair;
  } else if (both) {
    lay.px = lo + edge;
    lay.nx = hi - edge - next.w;
  } else {
    lay.px = Math.max(lo + edge, mid - D.pairPx / 2 - prev.w);
    lay.nx = Math.min(hi - edge - next.w, mid + D.pairPx / 2);
  }
  lay.minShift = Math.min(0, lo + edge - (prev.on ? lay.px : lay.nx));
  lay.maxShift = Math.max(0, hi - edge - (next.on ? lay.nx + next.w : lay.px + prev.w));
  lay.drop = both ? (row ? D.stepPx : prev.h + D.gapPx) : 0;
  const tall = lay.drop + (next.on ? next.h : prev.h);
  const under = r.fig.b + D.gapPx;
  const maxDrop = Math.max(prev.on ? prev.h : 0, next.on ? next.h : 0);
  const shifts = 1 + 2 * Math.ceil(Math.max(-lay.minShift, lay.maxShift) / D.shiftPx);
  for (let down = 0; down <= maxDrop; down += D.dropPx) {
    for (let i = 0; i < shifts; i++) if (tryAt(r, prev, next, under + down, shiftAt(i))) return true;
  }
  if (r.floor >= r.vh) {
    for (let i = 0; i < shifts; i++) if (tryAt(r, prev, next, r.fig.t - D.gapPx - tall, shiftAt(i))) return true;
  }
  tryAt(r, prev, next, D.topPx, 0);
  return false;
}

const at3: ScreenPt = { x: 0, y: 0, scale: 1, visible: true };

/** A slot's hit box on screen (px), as its proxy ellipse stands; false while it is off screen. */
function slotBox(v: SlotView, rig: CameraRig, out: FigureBox): boolean {
  rig.project(v.world[0], v.world[1], v.world[2], at3);
  if (!at3.visible) return false;
  const hw = (v.hit[0] * at3.scale) / 2;
  const hh = (v.hit[1] * at3.scale) / 2;
  out.l = at3.x - hw;
  out.r = at3.x + hw;
  out.t = at3.y - hh;
  out.b = at3.y + hh;
  return true;
}

/**
 * The flowers a docked label keeps off, as screen boxes into `out`: the focused slot, and the project flower nearest the
 * visitor at [x, z] among those in front of it (nearer the camera). Returns how many were written.
 */
export function avoidOf(slots: readonly SlotView[], focused: SlotId | null, rig: CameraRig, at: Float32Array, out: readonly FigureBox[]): number {
  let n = 0;
  let near: SlotView | null = null;
  let best = Infinity;
  for (let i = 0; i < slots.length; i++) {
    const v = slots[i]!;
    if (v.id === focused) {
      if (slotBox(v, rig, out[n]!)) n++;
      continue;
    }
    if (v.kind !== 'project' || v.world[2] <= at[1]!) continue;
    const d = Math.hypot(v.world[0] - at[0]!, v.world[2] - at[1]!);
    if (d < best) {
      best = d;
      near = v;
    }
  }
  if (near !== null && slotBox(near, rig, out[n]!)) n++;
  return n;
}
