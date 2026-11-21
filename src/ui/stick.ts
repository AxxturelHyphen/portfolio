import type { StickPad } from '../core/stick.gesture.ts';
import './styles/stick.css';

/**
 * The floating stick's drawing (core/stick.gesture.ts moves it): a chalk ring where the thumb landed and a card knob
 * that follows the push. It only draws: pointer-events none, hidden from screen readers (walking has its keys and the
 * plan's list). Transform and opacity only. The stick starts in the lower left of the screen on coarse pointers;
 * proxies (flowers, signboards, the cat) and the HUD sit above the canvas, so a touch on them never reaches it.
 */

/** The stick's corner: the left share of the width and the lower share of the height. */
const ZONE = { w: 0.45, h: 0.5 } as const;
/** The knob's throw from the origin (px). */
const REACH_PX = 46;

export function createStick(parent: HTMLElement): StickPad {
  const coarse = matchMedia('(pointer: coarse)');
  const root = document.createElement('div');
  root.className = 'sk';
  root.setAttribute('aria-hidden', 'true');
  const knob = document.createElement('div');
  knob.className = 'sk-knob';
  root.append(knob);
  parent.append(root);

  return {
    reachPx: REACH_PX,
    zone: (x, y) => coarse.matches && x <= innerWidth * ZONE.w && y >= innerHeight * ZONE.h,
    show(x, y) {
      root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      knob.style.transform = 'translate3d(0, 0, 0)';
      root.dataset.on = '';
    },
    knob(dx, dy) {
      knob.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    },
    hide() {
      delete root.dataset.on;
    },
  };
}
