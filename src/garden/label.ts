import { labelOf } from '../core/motion.ts';
import type { Clock, LabelCard, ScreenPt, SlotView, State } from '../types.ts';
import type { GardenRig } from '../world/camera.ts';

/**
 * Drives the label card from the machine (spec section 7): shown for the focused slot after the MOTION delay,
 * placed at the flower's screen point in stage 'dom' (transform only), hidden once it has faded out. Under frozen
 * time it is fully shown while focused.
 */

export interface LabelDrive {
  onState(s: State, prev: State, slots: readonly SlotView[]): void;
  frame(c: Clock): void;
}

/** The card goes on the side of the flower that has more room. */
const LEFT_OF = 0.6;

export function createLabelDrive(label: LabelCard, rig: GardenRig): LabelDrive {
  const pt: ScreenPt = { x: 0, y: 0, scale: 0, visible: false };
  let view: SlotView | null = null;
  let focused = false;
  let elapsedS = 0;
  let shown = false;

  return {
    onState(s, prev, slots) {
      const want = s.phase === 'focus' && s.slot !== null;
      if (want && (s.slot !== prev.slot || !focused)) {
        view = slots.find((v) => v.id === s.slot) ?? null;
        if (view === null) return;
        label.show(view);
        shown = true;
        focused = true;
        elapsedS = 0;
      } else if (!want && focused) {
        focused = false;
        elapsedS = 0;
      }
    },

    frame(c) {
      if (!shown || view === null) return;
      elapsedS += c.dt;
      /** Frozen time (?t, stills) has no dt: the card shows at its end state, as a flower shows its target pose. */
      const p = c.frozen ? (focused ? 1 : 0) : labelOf(elapsedS, focused);
      if (!focused && p <= 0) {
        label.hide();
        shown = false;
        return;
      }
      rig.project(view.world[0], view.world[1], view.world[2], pt);
      label.place(pt, pt.x > rig.width * LEFT_OF ? 'left' : 'right');
      label.setProgress(p);
    },
  };
}
