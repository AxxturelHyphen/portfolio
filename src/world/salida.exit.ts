import type { Machine, State } from '../types.ts';
import { EXIT, exitGate, holdAt, pushAt } from './exit.ts';

/**
 * The paper sheet of La Salida's way out (world/exit.ts). One fixed element outside both mode layers, hidden while
 * idle; each run is one Web Animation on transform and opacity, built from keyframes made once. Its clock drives the
 * camera push and the layer hold, so a paused garden loop never strands the sheet. A click, tap or key during a run
 * skips it: the sheet finishes and the mode channel snaps to its target. Reduced motion never runs it:
 * the plain mode crossfade stays.
 */

/** Width of the inked deckle on the sheet's leading edge, px. */
const EDGE_PX = 56;
/** A torn edge drawn once in a 56 x 1000 box: x wanders, the paper fills to the right, ink rides the tear with a faint bleed. */
const TEAR =
  'M33.5 0L38.7 17L37.6 32L31.5 54L31.8 78L32.7 101L37.8 116L33.7 147L40.7 165L39.5 198L44.6 220L42.5 235L31.9 255L33.7 271L30.9 302L36.5 327L34.7 349L27.5 364L35.8 382L30.5 405L32.4 430L37.2 450L29.9 478L34.5 504L38.2 535L42.4 555L35.1 572L32.3 601L31.4 624L42.2 652L44.1 677L41.7 698L40.1 723L43.5 747L37.7 779L31.2 807L38.5 835L39.8 869L33.1 888L27.3 916L28.8 939L27.0 955L27.8 985L36 1000';
const SVG_NS = 'http://www.w3.org/2000/svg';

const ms = (s: number): number => s * 1000;
const at = (s: number, total: number): number => s / total;

const OUT = EXIT.out;
const BACK = EXIT.back;
const OUT_FRAMES: Keyframe[] = [
  { offset: 0, transform: 'translate3d(101%, 0, 0)', opacity: 1 },
  { offset: at(OUT.sweepFromS, OUT.totalS), transform: 'translate3d(101%, 0, 0)', opacity: 1, easing: 'cubic-bezier(0.55, 0, 0.35, 1)' },
  { offset: at(OUT.coverS, OUT.totalS), transform: 'translate3d(0, 0, 0)', opacity: 1 },
  { offset: at(OUT.liftFromS, OUT.totalS), transform: 'translate3d(0, 0, 0)', opacity: 1, easing: 'cubic-bezier(0.3, 0, 0.6, 1)' },
  { offset: 1, transform: 'translate3d(0, 0, 0)', opacity: 0 },
];
const BACK_FRAMES: Keyframe[] = [
  { offset: 0, transform: 'translate3d(0, 0, 0)', opacity: 0 },
  { offset: at(BACK.coverS, BACK.totalS), transform: 'translate3d(0, 0, 0)', opacity: 1 },
  { offset: at(BACK.sweepFromS, BACK.totalS), transform: 'translate3d(0, 0, 0)', opacity: 1, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  { offset: 1, transform: 'translate3d(101%, 0, 0)', opacity: 1 },
];

function buildSheet(): { root: HTMLElement; sheet: HTMLElement } {
  const root = document.createElement('div');
  root.className = 'salida-exit';
  root.setAttribute('aria-hidden', 'true');
  root.hidden = true;
  root.style.cssText = 'position:fixed;inset:0;z-index:9;overflow:hidden;contain:strict;pointer-events:auto';
  const sheet = document.createElement('div');
  sheet.style.cssText = `position:absolute;top:0;bottom:0;left:${-EDGE_PX}px;width:calc(100% + ${EDGE_PX}px);will-change:transform,opacity;transform:translate3d(101%,0,0)`;
  const paper = document.createElement('div');
  paper.style.cssText = `position:absolute;top:0;bottom:0;left:${EDGE_PX - 1}px;right:0;background:var(--paper)`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${EDGE_PX} 1000`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = `position:absolute;top:0;left:0;width:${EDGE_PX}px;height:100%;overflow:visible`;
  const fill = document.createElementNS(SVG_NS, 'path');
  fill.setAttribute('d', `${TEAR}H${EDGE_PX}V0Z`);
  fill.style.fill = 'var(--paper)';
  const ink = document.createElementNS(SVG_NS, 'path');
  ink.setAttribute('d', TEAR);
  ink.style.cssText = 'fill:none;stroke:var(--ink)';
  ink.setAttribute('stroke-width', '2');
  ink.setAttribute('stroke-linejoin', 'round');
  ink.setAttribute('vector-effect', 'non-scaling-stroke');
  const bleed = document.createElementNS(SVG_NS, 'path');
  bleed.setAttribute('d', TEAR);
  bleed.style.cssText = 'fill:none;stroke:var(--ink);stroke-opacity:0.14';
  bleed.setAttribute('stroke-width', '9');
  bleed.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(bleed, fill, ink);
  sheet.append(svg, paper);
  root.append(sheet);
  return { root, sheet };
}

export interface SalidaExit {
  onState(s: State, prev: State): void;
  /** Frame code: reads the sheet's clock into the camera push and the layer hold. No allocation. */
  update(): void;
  dispose(): void;
}

export function createSalidaExit(machine: Machine): SalidaExit {
  const { root, sheet } = buildSheet();
  document.body.append(root);
  let run: Animation | null = null;
  let out = true;

  const skip = (): void => {
    if (run === null) return;
    run.finish();
    const mode = machine.ch.mode;
    if (!mode.settled) mode.snap(mode.target);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (!e.repeat) skip();
  };

  function end(): void {
    run?.cancel();
    run = null;
    root.hidden = true;
    exitGate.push = 0;
    exitGate.hold = -1;
    window.removeEventListener('keydown', onKey, true);
  }

  function start(toCv: boolean): void {
    end();
    out = toCv;
    root.hidden = false;
    exitGate.push = toCv ? 0 : 1;
    exitGate.hold = toCv ? 0 : 1;
    const total = toCv ? OUT.totalS : BACK.totalS;
    run = sheet.animate(toCv ? OUT_FRAMES : BACK_FRAMES, { duration: ms(total), fill: 'both' });
    run.onfinish = end;
    window.addEventListener('keydown', onKey, true);
  }

  root.addEventListener('pointerdown', skip);

  return {
    onState(s, prev) {
      if (s.mode === prev.mode) return;
      if (s.reduced || !s.gardenReady || s.bed !== 'salida') {
        end();
        return;
      }
      start(s.mode === 'herbario');
    },
    update() {
      if (run === null) return;
      const now = run.currentTime;
      const t = typeof now === 'number' ? now / 1000 : 0;
      exitGate.push = pushAt(out, t);
      exitGate.hold = holdAt(out, t);
    },
    dispose() {
      end();
      root.removeEventListener('pointerdown', skip);
      root.remove();
    },
  };
}
