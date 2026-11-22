import { labelOf } from '../core/motion.ts';
import type { Clock, LabelCard, ScreenPt, SlotView, State } from '../types.ts';
import type { GardenRig } from '../world/camera.ts';

/**
 * Drives the label card from the machine (spec section 7): shown for the focused slot after the MOTION delay, placed
 * at the slot's screen point in stage 'dom' (transform only), hidden once it has faded out. Under frozen time it is
 * fully shown while focused. The cat never gets a tag (its chalk note says what it is, garden/chalk.drive.ts); its
 * proxy button keeps its name. The side asked for counts only for the tag's first placement (ui/label.ts keeps it).
 */

export interface LabelDrive {
  onState(s: State, prev: State, slots: readonly SlotView[]): void;
  frame(c: Clock): void;
}

/** The card goes on the side of the flower that has more room. */
const LEFT_OF = 0.6;
/** Height (m) of the visitor's middle: under free roam the card goes on the flower's side away from the figure. */
const VISITOR_MID_M = 0.9;

export function createLabelDrive(label: LabelCard, rig: GardenRig, visitor: Float32Array | null = null): LabelDrive {
  const pt: ScreenPt = { x: 0, y: 0, scale: 0, visible: false };
  const at: ScreenPt = { x: 0, y: 0, scale: 0, visible: false };
  let view: SlotView | null = null;
  let focused = false;
  let elapsedS = 0;
  let shown = false;

  return {
    onState(s, prev, slots) {
      const found = s.phase === 'focus' && s.slot !== null ? slots.find((v) => v.id === s.slot) : undefined;
      const want = found !== undefined && found.kind !== 'pet';
      if (want && (s.slot !== prev.slot || !focused)) {
        view = found;
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
      if (visitor === null) {
        label.place(pt, pt.x > rig.width * LEFT_OF ? 'left' : 'right');
      } else {
        rig.project(visitor[0]!, VISITOR_MID_M, visitor[1]!, at);
        label.place(pt, pt.x < at.x ? 'left' : 'right');
      }
      label.setProgress(p);
    },
  };
}
