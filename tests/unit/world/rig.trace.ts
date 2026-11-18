import { readFileSync } from 'node:fs';
import type { BedId, Channel, ChannelName, Clock, Machine, SlotView, State } from '../../../src/types.ts';
import { omegaFor, springStep } from '../../../src/core/motion.ts';
import type { GardenRig } from '../../../src/world/camera.ts';
import type { WorldLayout } from '../../../src/world/layout.ts';

/**
 * A fixed script of machine states and channel moves played into a rig: overview with pan, fling and zoom, a walk
 * into the Rosaleda, focus, open and close, a neighbour walk, a long jump, the grotto, back to the overview, then
 * portrait. Returns the pose every 30 frames as [x, y, z, pitch, yaw, fov]: the rail pose recorded before free roam.
 */

function channel(durationS: number, v = 0): Channel {
  const s = { x: v, v: 0 };
  let target = v;
  let settled = true;
  return {
    get value() { return s.x; },
    get target() { return target; },
    get velocity() { return s.v; },
    get settled() { return settled; },
    to(t) { target = t; settled = false; },
    snap(x) { s.x = x; s.v = 0; target = x; settled = true; },
    hold() { target = s.x; },
    tick(dt) {
      if (settled) return false;
      settled = springStep(s, target, omegaFor(durationS), dt);
      return settled;
    },
  };
}

const DEG = Math.PI / 180;
const content = JSON.parse(readFileSync(new URL('../../../content/garden.json', import.meta.url), 'utf8')) as WorldLayout;
/** The rig takes the overview pitch in radians (the composition root converts it). */
export const traceLayout: WorldLayout = { ...content, overview: { ...content.overview, pitch: content.overview.pitch * DEG } };

const SLOT: SlotView = { id: 'rosaleda/a', kind: 'project', world: [11.6, 1.42, -1.5], hit: [1, 1], alt: 'a' };

export function traceRig(rig: GardenRig): number[][] {
  const ch: Record<ChannelName, Channel> = {
    intro: channel(3, 1), dolly: channel(1, 0), leg: channel(1.6, 0), focus: channel(0.4, 0), open: channel(0.46, 0), mode: channel(0.45, 0),
  };
  let s: State = {
    phase: 'overview', mode: 'garden', intent: { k: 'overview' }, bed: null, slot: null, project: null,
    fromX: 22.5, lang: 'en', gen: 1, gardenReady: true, panelReady: true, reduced: false,
  };
  const clock = { now: 0, dt: 1 / 60, t: 0, frame: 0, frozen: false } as Clock;
  const out: number[][] = [];
  let frame = 0;
  const run = (frames: number): void => {
    for (let i = 0; i < frames; i++) {
      for (const c of Object.values(ch)) c.tick(clock.dt);
      rig.update(clock, s, ch as Machine['ch']);
      if (++frame % 30 === 0) {
        const p = rig.pose;
        out.push([p.x, p.y, p.z, p.pitch, p.yaw, p.fov].map((v) => Math.round(v * 1e5) / 1e5));
      }
    }
  };
  const goto = (bed: BedId): void => {
    s = { ...s, phase: 'travel', intent: { k: 'bed', bed }, bed, slot: null, fromX: rig.pose.x };
    ch.dolly.to(1);
    ch.leg.snap(0);
    ch.leg.to(1);
  };

  rig.resize(1920, 1080);
  rig.setSlots([SLOT]);
  run(30);
  rig.panBy(-240);
  run(30);
  rig.fling(-900);
  rig.zoomBy(1.4, 700);
  run(60);
  goto('rosaleda');
  run(120);
  s = { ...s, phase: 'focus', slot: SLOT.id };
  ch.focus.to(1);
  run(60);
  ch.open.to(1);
  run(60);
  ch.open.to(0);
  run(90);
  ch.focus.to(0);
  goto('estanque');
  run(120);
  goto('salida');
  run(120);
  goto('gruta');
  run(120);
  goto('semillero');
  run(90);
  ch.dolly.to(0);
  ch.leg.hold();
  run(90);
  s = { ...s, phase: 'overview', intent: { k: 'overview' }, bed: null };
  run(30);
  rig.resize(390, 844);
  goto('puerta');
  run(120);
  return out;
}
