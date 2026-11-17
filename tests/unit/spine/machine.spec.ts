import { expect, test } from '@playwright/test';
import { camX } from '../../../src/core/transitions.ts';
import type { Machine, State } from '../../../src/types.ts';
import { expectValid, frame, geo, machine, run, settle } from './fixture.ts';

function ready(m: Machine): void {
  m.send({ type: 'PANEL_READY', id: m.state.project ?? '', gen: m.state.gen });
}

/** A garden machine past the intro, focused on rose-a in the rosaleda. */
function focused(): Machine {
  const m = machine();
  m.send({ type: 'SKIP_INTRO' });
  m.send({ type: 'GARDEN_READY' });
  m.send({ type: 'GOTO', place: { k: 'bed', bed: 'rosaleda' } });
  settle(m);
  m.send({ type: 'FOCUS', slot: 'rosaleda/rose-a' });
  settle(m);
  expect(m.state.phase).toBe('focus');
  return m;
}

test('intro plays its 3 s; any input hurries it to 0.3 s without a snap', () => {
  const slow = machine();
  run(slow, 2.9);
  expect(slow.state.phase).toBe('intro');
  run(slow, 0.2);
  expect(slow.state.phase).toBe('overview');
  const fast = machine();
  run(fast, 1);
  const v = fast.ch.intro.value;
  fast.send({ type: 'SKIP_INTRO' });
  expect(fast.ch.intro.value).toBe(v);
  run(fast, 0.32);
  expect(fast.state.phase).toBe('overview');
});

test('herbario starts past the intro and walks to a deep link at once, open runs without the hold', () => {
  const m = machine('herbario');
  expect(m.state.phase).toBe('overview');
  m.send({ type: 'GOTO', place: { k: 'project', id: 'lily-a' } });
  expect(m.state.phase).toBe('opening');
  expect(m.state.bed).toBe('estanque');
  expect(m.state.slot).toBe('estanque/lily-a');
  settle(m);
  expect(m.state.phase).toBe('inspect');
});

test('open holds the iris shut at 0.5 until PANEL_READY with the current gen, then reveals', () => {
  const m = focused();
  m.send({ type: 'OPEN', id: 'rose-a' });
  expect(m.state.phase).toBe('opening');
  run(m, 2);
  expect(m.ch.open.value).toBeCloseTo(0.5, 2);
  m.send({ type: 'PANEL_READY', id: 'rose-a', gen: m.state.gen - 1 });
  expect(m.state.panelReady).toBe(false);
  ready(m);
  expect(m.state.panelReady).toBe(true);
  settle(m);
  expect(m.state.phase).toBe('inspect');
  expect(m.ch.open.value).toBe(1);
});

function trace(m: Machine, seconds: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    frame(m);
    out.push(m.ch.open.value);
  }
  return out;
}

test('Esc halfway through opening reverses smoothly from the current value', () => {
  const m = focused();
  m.send({ type: 'OPEN', id: 'rose-a' });
  ready(m);
  run(m, 0.12);
  const at = m.ch.open.value;
  expect(at).toBeGreaterThan(0.1);
  expect(at).toBeLessThan(0.5);
  m.send({ type: 'BACK' });
  expect(m.state.phase).toBe('closing');
  expect(m.ch.open.value).toBe(at);
  const tr = trace(m, 2);
  let prev = at;
  for (const v of tr) {
    expect(Math.abs(v - prev)).toBeLessThan(0.08);
    prev = v;
  }
  expect(Math.max(...tr)).toBeLessThan(0.5);
  settle(m);
  expect(m.state.phase).toBe('focus');
  expect(m.state.slot).toBe('rosaleda/rose-a');
  expect(m.ch.open.value).toBe(0);
});

test('closing from the panel passes the shut iris and reopens onto the garden; reopening mid-close continues', () => {
  const m = focused();
  m.send({ type: 'OPEN', id: 'rose-a' });
  ready(m);
  settle(m);
  m.send({ type: 'CLOSE' });
  run(m, 0.15);
  const mid = m.ch.open.value;
  expect(mid).toBeGreaterThan(0.5);
  expect(mid).toBeLessThan(1);
  m.send({ type: 'OPEN', id: 'rose-a' });
  expect(m.state.phase).toBe('opening');
  expect(m.ch.open.value).toBe(mid);
  settle(m);
  expect(m.state.phase).toBe('inspect');
  m.send({ type: 'BACK' });
  const tr = trace(m, 3);
  expect(Math.min(...tr.slice(0, 20))).toBeGreaterThan(0.45);
  expect(m.state.phase).toBe('focus');
});

test('repeated input is idempotent: one change, one notification, no queued work', () => {
  const m = focused();
  const seen: State[] = [];
  m.subscribe((s) => seen.push(s));
  for (let i = 0; i < 10; i++) m.send({ type: 'OPEN', id: 'rose-a' });
  expect(seen.length).toBe(1);
  ready(m);
  settle(m);
  const before = seen.length;
  const s = m.state;
  for (let i = 0; i < 10; i++) m.send({ type: 'OPEN', id: 'rose-a' });
  expect(m.state).toBe(s);
  m.send({ type: 'BACK' });
  m.send({ type: 'BACK' });
  m.send({ type: 'CLOSE' });
  expect(seen.length).toBe(before + 1);
  expect(m.state.intent).toEqual({ k: 'bed', bed: 'rosaleda' });
  settle(m);
  expect(m.state.phase).toBe('focus');
});

test('steady frames notify nobody and keep the same State object', () => {
  const m = focused();
  let calls = 0;
  m.subscribe(() => calls++);
  const s = m.state;
  run(m, 2);
  expect(calls).toBe(0);
  expect(m.state).toBe(s);
});

test('travel retarget keeps the camera continuous; going back to the overview reverses the dolly', () => {
  const m = machine();
  m.send({ type: 'SKIP_INTRO' });
  run(m, 0.5);
  m.send({ type: 'GOTO', place: { k: 'bed', bed: 'rosaleda' } });
  run(m, 0.4);
  const x = camX(m.state, m.ch as never, geo);
  m.send({ type: 'GOTO', place: { k: 'bed', bed: 'semillero' } });
  expect(camX(m.state, m.ch as never, geo)).toBeCloseTo(x, 9);
  expect(m.state.bed).toBe('semillero');
  run(m, 0.3);
  const d = m.ch.dolly.value;
  m.send({ type: 'GOTO', place: { k: 'overview' } });
  expect(m.ch.dolly.value).toBe(d);
  expect(m.ch.dolly.target).toBe(0);
  settle(m);
  expect(m.state.phase).toBe('overview');
  expectValid(m);
});

test('BACK walks out one level at a time; STEP_BED moves along the order', () => {
  const m = focused();
  m.send({ type: 'BACK' });
  expect(m.state.phase).toBe('bed');
  m.send({ type: 'STEP_BED', dir: 1 });
  expect(m.state.intent).toEqual({ k: 'bed', bed: 'estanque' });
  settle(m);
  m.send({ type: 'BACK' });
  settle(m);
  expect(m.state.phase).toBe('overview');
  const s = m.state;
  m.send({ type: 'BACK' });
  expect(m.state).toBe(s);
});

test('opening another bed\'s project closes, travels, then opens; stale panel results are dropped', () => {
  const m = focused();
  m.send({ type: 'OPEN', id: 'rose-a' });
  ready(m);
  settle(m);
  const oldGen = m.state.gen;
  m.send({ type: 'GOTO', place: { k: 'project', id: 'pod-a' } });
  expect(m.state.phase).toBe('closing');
  m.send({ type: 'PANEL_READY', id: 'rose-a', gen: oldGen });
  for (let i = 0; i < 600 && m.state.phase !== 'opening'; i++) frame(m);
  expect(m.state.bed).toBe('semillero');
  expect(m.state.project).toBe('pod-a');
  expect(m.state.panelReady).toBe(false);
  ready(m);
  settle(m);
  expect(m.state.phase).toBe('inspect');
});

test('mode switch keeps the place and the open panel; garden waits for gardenReady', () => {
  const m = focused();
  m.send({ type: 'OPEN', id: 'rose-a' });
  ready(m);
  settle(m);
  m.send({ type: 'SET_MODE', mode: 'herbario' });
  settle(m);
  expect(m.state.phase).toBe('inspect');
  expect(m.ch.mode.value).toBe(1);
  m.send({ type: 'SET_MODE', mode: 'garden' });
  settle(m);
  expect(m.ch.mode.value).toBe(0);
  const h = machine('herbario');
  h.send({ type: 'SET_MODE', mode: 'garden' });
  expect(h.state.mode).toBe('garden');
  expect(h.ch.mode.target).toBe(1);
  h.send({ type: 'GARDEN_READY' });
  expect(h.ch.mode.target).toBe(0);
});

test('scrub tracks the finger and releases toward the nearer end', () => {
  const m = focused();
  m.send({ type: 'OPEN', id: 'rose-a' });
  ready(m);
  settle(m);
  m.scrub('open', 0.8);
  run(m, 0.5);
  expect(m.ch.open.value).toBe(0.8);
  m.scrub('open', null);
  settle(m);
  expect(m.state.phase).toBe('inspect');
  m.scrub('open', 0.3);
  m.scrub('open', null);
  expect(m.state.phase).toBe('closing');
  settle(m);
  expect(m.state.phase).toBe('focus');
});

test('a subscriber that sends during notification sees every state in order', () => {
  const m = focused();
  const log: string[] = [];
  m.subscribe((s, prev) => {
    log.push(`${prev.phase}>${s.phase}`);
    if (s.phase === 'opening' && !s.panelReady) ready(m);
  });
  m.send({ type: 'OPEN', id: 'rose-a' });
  expect(log).toEqual(['focus>opening', 'opening>opening']);
  expect(m.state.panelReady).toBe(true);
});

test('a deep link waits in the bed until the garden has entered it, then opens toward the bound slot', () => {
  let entered = false;
  const m = machine('garden', false, { bedReady: () => entered });
  m.send({ type: 'SKIP_INTRO' });
  m.send({ type: 'GARDEN_READY' });
  m.send({ type: 'OPEN', id: 'rose-a' });
  settle(m);
  expect(m.state.phase).toBe('bed');
  expect(m.ch.open.value).toBe(0);
  entered = true;
  m.refresh();
  expect(m.state.phase).toBe('opening');
  expect(m.state.slot).toBe('rosaleda/rose-a');
});

test('from the overview a leg starts at the pan the visitor left the camera at', () => {
  const m = machine('garden', false, { viewX: () => 33 });
  m.send({ type: 'SKIP_INTRO' });
  m.send({ type: 'GARDEN_READY' });
  settle(m);
  m.send({ type: 'GOTO', place: { k: 'bed', bed: 'rosaleda' } });
  expect(m.state.fromX).toBe(33);
});
