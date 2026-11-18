import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Channel, ChannelName, Clock, Machine, SlotView, State } from '../../../src/types.ts';
import { LIGHT, MOTH, follow } from '../../../src/core/motion.ts';
import { createRig } from '../../../src/world/camera.ts';
import { createLight } from '../../../src/world/light.ts';
import { createMoth } from '../../../src/world/moth.ts';
import type { WorldLayout } from '../../../src/world/layout.ts';

// Frozen content time (?t, the test API) makes stills independent of load: every follower lands on its target in the
// first frame. With time running, the followers step exactly as before.

const content = JSON.parse(readFileSync(new URL('../../../content/garden.json', import.meta.url), 'utf8')) as WorldLayout;
const DEG = Math.PI / 180;
const layout: WorldLayout = { ...content, overview: { ...content.overview, pitch: content.overview.pitch * DEG } };

const slot: SlotView = { id: 'rosaleda/a', kind: 'project', world: [11.6, 1.42, -1.5], hit: [1, 1], alt: 'a' };
const bed: State = {
  phase: 'bed', mode: 'garden', intent: { k: 'bed', bed: 'rosaleda' }, bed: 'rosaleda', slot: null, project: null,
  fromX: 20, lang: 'en', gen: 1, gardenReady: true, panelReady: true, reduced: false,
};
/** Followers pass only 0.016 to 0.05 s frames; this mix is the load-dependent case the stills hit. */
const DTS = [0.016, 0.033, 0.05, 0.008, 0.02, 0.05, 0.017];

function still(v: number): Channel {
  return { value: v, target: v, velocity: 0, settled: true, to() {}, snap() {}, hold() {}, tick: () => false };
}
const ch = { intro: still(1), dolly: still(1), leg: still(1), focus: still(0), open: still(0), mode: still(0) } as Record<ChannelName, Channel> as Machine['ch'];

function scene() {
  const rig = createRig(layout);
  rig.resize(1920, 1080);
  rig.setSlots([slot]);
  const light = createLight();
  light.resize(1920, 1080);
  light.setSlots([slot]);
  const moth = createMoth(rig);
  const clock = { now: 0, dt: 0, t: 12.5, frame: 0, frozen: false };
  const step = (dt: number, frozen: boolean): void => {
    clock.dt = dt;
    clock.frozen = frozen;
    if (!frozen) clock.t += dt;
    clock.frame++;
    rig.update(clock as Clock, bed, ch);
    light.update(clock as Clock, bed, ch, rig);
    moth.update(clock as Clock, bed, ch, light, [slot]);
  };
  return { light, moth, step };
}

test('frozen time: the bed rest light and the ground pool are fully on after one frame', () => {
  const { light, step } = scene();
  step(DTS[0]!, true);
  expect(light.handThrow).toBe(1);
  expect(light.back[3]).toBe(Math.fround(0.6));
  expect(light.gather[3]).toBe(0);
});

test('frozen time: the end state does not depend on the frame times', () => {
  const a = scene();
  const b = scene();
  a.step(0.05, true);
  for (const dt of DTS) b.step(dt, true);
  expect(Array.from(b.light.cursor)).toEqual(Array.from(a.light.cursor));
  expect(Array.from(b.light.back)).toEqual(Array.from(a.light.back));
  expect(b.light.handThrow).toBe(a.light.handThrow);
});

test('frozen time: the moth lands on the project once the light has held still for one frame', () => {
  const { moth, step } = scene();
  step(0.016, true);
  step(0.016, true);
  expect(moth.mode).toBe('land');
  expect(moth.pos[0]).toBe(Math.fround(slot.world[0]));
  expect(moth.pos[2]).toBe(Math.fround(slot.world[2]));
});

test('running time: the light followers step exactly as follow() over the same frames', () => {
  const { light, step } = scene();
  let hand = 0;
  let rest = 0;
  for (const dt of DTS) {
    step(dt, false);
    hand = follow(hand, 1, LIGHT.gatherOutTauS, dt);
    rest = follow(rest, 0.6, LIGHT.gatherOutTauS, dt);
    expect(light.handThrow).toBe(hand);
    expect(light.back[3]).toBe(Math.fround(rest));
  }
  expect(hand).toBeLessThan(0.6);
});

test('running time: the moth follows the light and lands only after the still time', () => {
  const { moth, step } = scene();
  let t = 0;
  while (t < MOTH.landAfterS - 0.1) {
    step(0.05, false);
    t += 0.05;
    expect(moth.mode).toBe('follow');
  }
  for (let i = 0; i < 4; i++) step(0.05, false);
  expect(moth.mode).toBe('land');
});

test('frozen time: a pointer that never left (0,0) is the stray load event and keeps the overview rest light', () => {
  const rest = scene();
  const stray = scene();
  const real = scene();
  for (const s of [rest, stray, real]) s.light.setSlots([]);
  stray.light.setPointer(0, 0, 'mouse');
  real.light.setPointer(300, 500, 'mouse');
  for (const s of [rest, stray, real]) s.step(0.016, true);
  expect(stray.light.handThrow).toBe(0);
  expect(Array.from(stray.light.cursor)).toEqual(Array.from(rest.light.cursor));
  expect(real.light.handThrow).toBe(1);
});

test('running time: a pointer at (0,0) counts as present, as before', () => {
  const { light, step } = scene();
  light.setSlots([]);
  light.setPointer(0, 0, 'mouse');
  step(0.016, false);
  expect(light.handThrow).toBe(follow(0, 1, LIGHT.gatherOutTauS, 0.016));
});
