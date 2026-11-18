import type { CameraRig, ScreenPt } from '../types.ts';
import { createMover, type Mover } from './xform.ts';

/**
 * Free roam: a signpost planted in the world (ui/signposts.ts). Its cane is a separate element drawn from the label's
 * lashing down to the projected ground point of the sign, where a small contact shadow sits; both are moved by
 * transform only. The label stands SIGN_M above the ground, so the cane shortens with distance like the garden around it.
 */

/** Height of the label's lashing over the ground (m). */
export const SIGN_M = 1.6;
/** The visitor's box for keeping labels off them: half width and height over the ground (m). */
const VISITOR = { halfW: 0.45, h: 1.4 } as const;
/** Room between a lifted label and the top of the visitor (px). */
const CLEAR_PX = 8;
/** The cane's slant-cut tip above the lashing, and its laid-out length that the transform scales (px). */
const TIP_PX = 18;
const CANE_PX = 100;
/** Contact shadow: laid-out width in px and its width in the world (m). */
const FOOT_PX = 40;
const FOOT_H_PX = 12;
const FOOT_M = 0.5;

const TYPED_OM = typeof CSSRotate === 'function' && 'attributeStyleMap' in HTMLElement.prototype;
const EPS = 0.05;

export interface Stake {
  /** Cane from the lashing at (x, y) to the ground point (px); its shadow is sized by the point's px per metre. */
  stand(x: number, y: number, ground: Readonly<ScreenPt>): void;
  show(on: boolean): void;
}

/** One planted cane: translate to its tip, turn toward the ground point, stretch to reach it. No allocation per frame. */
function createCane(el: HTMLElement): (x: number, y: number, angle: number, len: number) => void {
  let lx = Number.NaN, ly = Number.NaN, la = Number.NaN, ll = Number.NaN;
  const tx = TYPED_OM ? CSS.px(0) : null;
  const ty = TYPED_OM ? CSS.px(0) : null;
  const ang = TYPED_OM ? CSS.rad(0) : null;
  const sy = TYPED_OM ? CSS.number(1) : null;
  const tv = tx !== null && ty !== null && ang !== null && sy !== null
    ? new CSSTransformValue([new CSSTranslate(tx, ty), new CSSRotate(ang), new CSSScale(CSS.number(1), sy)])
    : null;
  return (x, y, angle, len) => {
    if (Math.abs(x - lx) < EPS && Math.abs(y - ly) < EPS && Math.abs(angle - la) < 1e-4 && Math.abs(len - ll) < EPS) return;
    lx = x;
    ly = y;
    la = angle;
    ll = len;
    if (tv !== null && tx !== null && ty !== null && ang !== null && sy !== null) {
      tx.value = x;
      ty.value = y;
      ang.value = angle;
      sy.value = len / CANE_PX;
      el.attributeStyleMap.set('transform', tv);
    } else {
      el.style.transform = `translate(${x}px, ${y}px) rotate(${angle}rad) scale(1, ${len / CANE_PX})`;
    }
  };
}

export function createStake(group: HTMLElement): Stake {
  const cane = document.createElement('span');
  cane.className = 'px-sign-pole';
  cane.setAttribute('aria-hidden', 'true');
  const foot = document.createElement('span');
  foot.className = 'px-sign-foot';
  foot.setAttribute('aria-hidden', 'true');
  cane.hidden = true;
  foot.hidden = true;
  group.prepend(foot, cane);
  const place = createCane(cane);
  const footMover: Mover = createMover(foot);
  let shown = false;
  return {
    stand(x, y, ground) {
      const dx = ground.x - x;
      const dy = ground.y - y;
      place(x, y - TIP_PX, Math.atan2(-dx, dy), Math.hypot(dx, dy) + TIP_PX);
      footMover.move(ground.x - FOOT_PX / 2, ground.y - FOOT_H_PX / 2, (ground.scale * FOOT_M) / FOOT_PX);
    },
    show(on) {
      if (on === shown) return;
      shown = on;
      cane.hidden = !on;
      foot.hidden = !on;
    },
  };
}

const vg: ScreenPt = { x: 0, y: 0, scale: 1, visible: true };
const vt: ScreenPt = { x: 0, y: 0, scale: 1, visible: true };

/** The top (px) for a label of width w and height h at (x, y) that keeps it off the visitor standing at [x, z]. */
export function clearOfVisitor(rig: CameraRig, at: Float32Array, x: number, y: number, w: number, h: number): number {
  rig.project(at[0]!, 0, at[1]!, vg);
  rig.project(at[0]!, VISITOR.h, at[1]!, vt);
  const half = VISITOR.halfW * vg.scale;
  const overlaps = x < vg.x + half && x + w > vg.x - half && y < vg.y && y + h > vt.y;
  return overlaps ? vt.y - h - CLEAR_PX : y;
}
