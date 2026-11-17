/**
 * Per-frame DOM writer for transform and opacity (cook/ARCH.md rule: stage 'dom' writes, never reads layout).
 * Where CSS Typed OM exists, every value lives in a preallocated CSSUnitValue that is mutated in place, so a frame
 * allocates nothing. Elsewhere it falls back to a style string. Unchanged values are never written.
 */

const TYPED_OM = typeof CSSTranslate === 'function' && typeof CSSScale === 'function' && typeof CSS.px === 'function'
  && 'attributeStyleMap' in HTMLElement.prototype;

/** Below this change (px, scale or opacity units) a write is skipped. */
const EPS = 0.05;
const EPS_UNIT = 0.0005;

export interface Mover {
  /** translate(x px, y px) scale(s). */
  move(x: number, y: number, s: number): void;
  fade(opacity: number): void;
  /** Forget the last written values, so the next move and fade write again. */
  reset(): void;
}

export function createMover(el: HTMLElement): Mover {
  let lx = Number.NaN, ly = Number.NaN, ls = Number.NaN, lo = Number.NaN;

  const tx = TYPED_OM ? CSS.px(0) : null;
  const ty = TYPED_OM ? CSS.px(0) : null;
  const sc = TYPED_OM ? CSS.number(1) : null;
  const op = TYPED_OM ? CSS.number(1) : null;
  const tv = tx !== null && ty !== null && sc !== null ? new CSSTransformValue([new CSSTranslate(tx, ty), new CSSScale(sc, sc)]) : null;

  return {
    move(x: number, y: number, s: number): void {
      if (Math.abs(x - lx) < EPS && Math.abs(y - ly) < EPS && Math.abs(s - ls) < EPS_UNIT) return;
      lx = x;
      ly = y;
      ls = s;
      if (tv !== null && tx !== null && ty !== null && sc !== null) {
        tx.value = x;
        ty.value = y;
        sc.value = s;
        el.attributeStyleMap.set('transform', tv);
      } else {
        el.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
      }
    },
    fade(opacity: number): void {
      if (Math.abs(opacity - lo) < EPS_UNIT) return;
      lo = opacity;
      if (op !== null) {
        op.value = opacity;
        el.attributeStyleMap.set('opacity', op);
      } else {
        el.style.opacity = String(opacity);
      }
    },
    reset(): void {
      lx = ly = ls = lo = Number.NaN;
    },
  };
}
