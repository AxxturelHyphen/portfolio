import { modeCanvasOf, modeDomOf } from '../core/motion.ts';
import type { Mode, ModeLayers } from '../types.ts';
import { applyMotionTokens } from './tokens.ts';
import { createMover } from './xform.ts';

/**
 * Garden and Herbario layers (cook/ARCH.md 2.10): ch.mode (0 garden, 1 herbario) to opacity, no View Transition.
 * The world layer fades out first, then the Herbario fades in (modeCanvasOf, modeDomOf: no overlap).
 * On settle the hidden layer gets inert and content-visibility: hidden (its block size is remembered, so the
 * Herbario keeps its scroll position), and html[data-mode] follows. As soon as progress leaves the settled end, the
 * hidden layer is made renderable again, once, before it becomes visible. Nothing is rebuilt in either direction,
 * so an open project, the bed and the scroll position survive the switch.
 */

const LAYER_HIDDEN = 'data-layer-hidden';

function setHidden(el: HTMLElement, hidden: boolean): void {
  el.inert = hidden;
  el.toggleAttribute(LAYER_HIDDEN, hidden);
}

export function createModeLayers(world: HTMLElement, herbario: HTMLElement): ModeLayers {
  const root = document.documentElement;
  const worldFade = createMover(world);
  const herbarioFade = createMover(herbario);
  let settled: Mode | null = null;

  applyMotionTokens(root);

  const layers: ModeLayers = {
    setProgress(p: number): void {
      if (settled === 'garden' && p > 0) {
        setHidden(herbario, false);
        settled = null;
      } else if (settled === 'herbario' && p < 1) {
        setHidden(world, false);
        settled = null;
      }
      worldFade.fade(modeCanvasOf(p));
      herbarioFade.fade(modeDomOf(p));
    },

    settle(m: Mode): void {
      settled = m;
      worldFade.fade(m === 'garden' ? 1 : 0);
      herbarioFade.fade(m === 'garden' ? 0 : 1);
      setHidden(world, m !== 'garden');
      setHidden(herbario, m === 'garden');
      root.dataset.mode = m;
    },
  };

  layers.settle(root.dataset.mode === 'garden' ? 'garden' : 'herbario');
  return layers;
}
