import type { Vector4 } from 'three';
import { INTRO, clamp01, irisOf, stripOf, travelDipOf, travelS } from '../core/motion.ts';
import type { BedId, Clock, GardenLayout, Machine, ScreenPt, SlotView, State } from '../types.ts';
import type { GardenRig } from '../world/camera.ts';
import { slotWorld } from '../world/camera.ts';

/**
 * Film inputs that come from state (cook/ARCH.md 2.7): the iris (intro iris-out, then the project iris around the
 * flower), the film strip on bed-to-bed travel and the slow travel exposure dip. Leg bookkeeping happens in the
 * machine subscriber (discrete), the uniform writes in stage 'world' (no allocation).
 */

export interface FilmDrive {
  /** Discrete: a new camera leg may have started. */
  onState(s: State, prev: State): void;
  /** Stage 'world': writes uIris and uStrip, returns the exposure multiplier (1 = none). */
  frame(c: Clock, iris: Vector4, strip: Vector4, slots: readonly SlotView[]): number;
}

const INTRO_IRIS_FROM = INTRO.irisOut[0] / INTRO.totalS;
const INTRO_IRIS_SPAN = (INTRO.irisOut[1] - INTRO.irisOut[0]) / INTRO.totalS;

export function createFilmDrive(machine: Machine, rig: GardenRig, g: GardenLayout): FilmDrive {
  const pt: ScreenPt = { x: 0, y: 0, scale: 0, visible: false };
  const world = new Float32Array(3);
  let hops = 0;
  let moveS = 1;
  let elapsedS = 0;

  /** Beds crossed from the nearest bed at x to bed b, on the garden order (the grotto counts as one). */
  function hopsTo(x: number, b: BedId): number {
    let from = 0;
    let best = Infinity;
    for (let i = 0; i < g.order.length; i++) {
      const id = g.order[i];
      if (id === undefined) continue;
      const d = Math.abs(g.anchors[id] - x);
      if (d < best) {
        best = d;
        from = i;
      }
    }
    return Math.abs(g.order.indexOf(b) - from);
  }

  return {
    onState(s, prev) {
      if (s.phase !== 'travel' || s.bed === null || (s.bed === prev.bed && s.fromX === prev.fromX && prev.phase === 'travel')) return;
      hops = machine.ch.dolly.value > 0.5 ? hopsTo(s.fromX, s.bed) : 0;
      moveS = travelS(Math.max(1, hops));
      elapsedS = 0;
    },

    frame(c, iris, strip, slots) {
      const s = machine.state;
      const ch = machine.ch;
      const aspect = rig.width / rig.height;
      let cx = 0.5;
      let cy = 0.5;
      if (slotWorld(slots, s.slot, world)) {
        rig.project(world[0] ?? 0, world[1] ?? 0, world[2] ?? 0, pt);
        cx = clamp01(pt.x / rig.width);
        cy = clamp01(1 - pt.y / rig.height);
      }
      irisOf(ch.open.value, cx, cy, aspect, iris);
      if (s.phase === 'intro' || ch.intro.value < 1) {
        const k = clamp01((ch.intro.value - INTRO_IRIS_FROM) / INTRO_IRIS_SPAN);
        iris.x = 0.5;
        iris.y = 0.5;
        iris.z *= k * k * (3 - 2 * k);
      }
      const travelling = s.phase === 'travel' && hops > 0;
      stripOf(travelling ? ch.leg.value : 0, travelling ? hops : 0, strip);
      if (!travelling) return 1;
      elapsedS += c.dt;
      return travelDipOf(elapsedS, moveS, s.reduced);
    },
  };
}
