import { expect, test } from '@playwright/test';
import type { BloomDef, Channel, ChannelName, Clock, GardenLayout, Machine, Pose, SlotView, State } from '../../../src/types.ts';
import { omegaFor, springStep } from '../../../src/core/motion.ts';
import { createRig } from '../../../src/world/camera.ts';
import { createFlower, restPose } from '../../../src/world/flower.ts';

function fakeChannel(durationS: number, v = 0): Channel {
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

const layout: GardenLayout = {
  order: ['puerta', 'rosaleda', 'estanque', 'semillero', 'salida'],
  anchors: { puerta: 0, rosaleda: 10, estanque: 20, semillero: 30, gruta: 32, salida: 40 },
  grutaHost: 'semillero',
  overview: { x: 20, y: 6, z: 30, pitch: -0.15, fov: 40 },
  pan: [0, 40],
  shots: {},
};

const slot: SlotView = { id: 'rosaleda/a', kind: 'project', world: [11, 1, -1], hit: [1, 1], alt: 'a' };
const base: State = {
  phase: 'focus', mode: 'garden', intent: { k: 'bed', bed: 'rosaleda' }, bed: 'rosaleda', slot: 'rosaleda/a', project: null,
  fromX: 20, lang: 'en', gen: 1, gardenReady: true, panelReady: true, reduced: false,
};

function rigWithChannels() {
  const ch: Record<ChannelName, Channel> = {
    intro: fakeChannel(3, 1), dolly: fakeChannel(1, 1), leg: fakeChannel(1.4, 1), focus: fakeChannel(0.4, 1), open: fakeChannel(0.46, 0), mode: fakeChannel(0.45, 0),
  };
  const rig = createRig(layout);
  rig.resize(1920, 1080);
  rig.setSlots([slot]);
  const clock = { now: 0, dt: 1 / 60, t: 0, frame: 0, frozen: false } as Clock;
  const run = (frames: number, onFrame?: (p: Pose) => void): void => {
    for (let i = 0; i < frames; i++) {
      for (const c of Object.values(ch)) c.tick(clock.dt);
      rig.update(clock, base, ch as Machine['ch']);
      onFrame?.(rig.pose);
    }
  };
  return { rig, ch, run };
}

test('closing a project lands on the exact stored pose', () => {
  const { rig, ch, run } = rigWithChannels();
  run(240);
  const before = { ...rig.pose };
  ch.open.to(1);
  run(120);
  expect(rig.pose.z).toBeLessThan(before.z);
  ch.open.to(0);
  run(240);
  expect(rig.pose).toEqual(before);
});

test('reversing mid-open continues from where it is (no frame jump)', () => {
  const { ch, run } = rigWithChannels();
  run(240);
  let prev: Pose | null = null;
  let maxStep = 0;
  const track = (p: Pose): void => {
    if (prev !== null) maxStep = Math.max(maxStep, Math.abs(p.x - prev.x) + Math.abs(p.z - prev.z));
    prev = { ...p };
  };
  ch.open.to(1);
  run(60, track);
  const forward = maxStep;
  ch.open.to(0);
  run(60);
  ch.open.to(1);
  prev = null;
  maxStep = 0;
  run(12, track);
  ch.open.to(0);
  run(60, track);
  expect(maxStep).toBeLessThanOrEqual(forward * 1.05);
});

test('fling glides with inertia and rubber-bands back inside the pan range', () => {
  const rig = createRig(layout);
  rig.resize(1920, 1080);
  const ch: Record<ChannelName, Channel> = {
    intro: fakeChannel(3, 1), dolly: fakeChannel(1, 0), leg: fakeChannel(1.4, 0), focus: fakeChannel(0.4, 0), open: fakeChannel(0.46, 0), mode: fakeChannel(0.45, 0),
  };
  const s: State = { ...base, phase: 'overview', bed: null, slot: null, intent: { k: 'overview' } };
  const clock = { now: 0, dt: 1 / 60, t: 0, frame: 0, frozen: false } as Clock;
  rig.update(clock, s, ch as Machine['ch']);
  const x0 = rig.pose.x;
  rig.panBy(-200);
  rig.fling(-20000);
  rig.update(clock, s, ch as Machine['ch']);
  const x1 = rig.pose.x;
  for (let i = 0; i < 600; i++) rig.update(clock, s, ch as Machine['ch']);
  expect(x1).toBeGreaterThan(x0);
  expect(rig.pose.x).toBeLessThanOrEqual(40 + 1e-3);
});

test('flower rests by status and opens one pose per 12 fps tick, closes two', () => {
  const bloom: BloomDef = { kind: 'rose', mode: 'frames', steps: 10, frames: [], rest: { idea: 0, wip: 0.4, shipped: 1 }, };
  expect(restPose(bloom, 'idea')).toBe(0);
  expect(restPose(bloom, 'shipped')).toBe(9);
  const f = createFlower({ slot, bloom, sprites: {}, scale: 1, env: { state: { reduced: false } } });
  const clock = { now: 0, dt: 1 / 60, t: 0, frame: 0, frozen: false };
  const restOpen = f.openness;
  f.update(clock);
  f.setFocused(true);
  for (let i = 1; i <= 5; i++) { clock.t = i / 12; f.update(clock); }
  expect(f.openness).toBeGreaterThan(restOpen);
  for (let i = 6; i <= 20; i++) { clock.t = i / 12; f.update(clock); }
  expect(f.openness).toBe(1);
  f.setFocused(false);
  for (let i = 21; i <= 25; i++) { clock.t = i / 12; f.update(clock); }
  expect(f.openness).toBeCloseTo(restOpen, 6);
});
