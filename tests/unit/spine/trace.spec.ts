import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { GardenGeo, RuntimeMachine } from '../../../src/core/machine.ts';
import { startRouter } from '../../../src/core/router.ts';
import type { BedId, Ev, Mode } from '../../../src/types.ts';
import { content, FakeHost, frame, machine, ORDER, PROJECTS } from './fixture.ts';

/**
 * Free roam must leave the rail machine bit for bit as it was. Every scenario below (the fuzz sequences of fuzz.spec
 * plus the flows of machine.spec and router.spec) is hashed over each state and every channel's value, target,
 * velocity and settled flag after every event and frame. The golden hashes were recorded before GardenGeo learned
 * roam() and arrived(); TRACE_RECORD=1 writes them anew.
 */

const GOLDEN = new URL('./trace.golden.json', import.meta.url);
type Geo = Partial<GardenGeo>;

/** FNV-1a over the text of each step, kept as a hex string. */
class Trace {
  private h = 0x811c9dc5;
  steps = 0;
  add(m: RuntimeMachine): void {
    let text = JSON.stringify(m.state);
    for (const [name, c] of Object.entries(m.ch)) text += `|${name}:${c.value},${c.target},${c.velocity},${c.settled}`;
    for (let i = 0; i < text.length; i++) this.h = Math.imul(this.h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    this.steps++;
  }
  get hex(): string {
    return `${this.steps}:${this.h.toString(16)}`;
  }
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BEDS: BedId[] = [...ORDER, 'gruta'];
const IDS = [...PROJECTS, 'nope'];

/** The fuzz.spec sequences, recorded step by step. */
function fuzz(seed: number, geo: Geo): string {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const host = new FakeHost(pick(['#/', '#/b/rosaleda', '#/p/lily-a', '?mode=herbario#/p/pod-a', '#/p/nope']));
  const m = machine(r() < 0.3 ? 'herbario' : 'garden', r() < 0.2, geo);
  startRouter(m, content, host);
  const trace = new Trace();
  const events: (() => Ev)[] = [
    () => ({ type: 'SKIP_INTRO' }),
    () => ({ type: 'GOTO', place: { k: 'overview' } }),
    () => ({ type: 'GOTO', place: { k: 'bed', bed: pick(BEDS) }, ...(r() < 0.3 ? { via: 'scroll' as const } : {}) }),
    () => ({ type: 'GOTO', place: { k: 'project', id: pick(IDS) } }),
    () => ({ type: 'STEP_BED', dir: r() < 0.5 ? -1 : 1 }),
    () => ({ type: 'FOCUS', slot: `${m.state.bed ?? pick(BEDS)}/${pick(IDS)}` }),
    () => ({ type: 'BLUR' }),
    () => ({ type: 'OPEN', id: pick(IDS) }),
    () => ({ type: 'CLOSE' }),
    () => ({ type: 'BACK' }),
    () => ({ type: 'SET_MODE', mode: r() < 0.5 ? 'garden' : 'herbario' }),
    () => ({ type: 'SET_LANG', lang: r() < 0.5 ? 'en' : 'es' }),
    () => ({ type: 'GARDEN_READY' }),
    () => ({ type: 'PANEL_READY', id: m.state.project ?? pick(IDS), gen: m.state.gen - (r() < 0.2 ? 1 : 0) }),
    () => ({ type: 'REDUCED', on: r() < 0.5 }),
  ];
  for (let i = 0; i < 60; i++) {
    const roll = r();
    if (roll < 0.6) m.send(pick(events)());
    else if (roll < 0.7) host.go(r() < 0.5 ? -1 : 1);
    else if (roll < 0.75) m.scrub('open', r() < 0.5 ? r() : null);
    trace.add(m);
    const frames = Math.floor(r() * 40);
    for (let f = 0; f < frames; f++) {
      frame(m, r() < 0.1 ? 0.05 : 1 / 60);
      trace.add(m);
    }
    host.flush();
    trace.add(m);
  }
  m.scrub('open', null);
  for (let f = 0; f < 900; f++) {
    frame(m);
    trace.add(m);
  }
  return trace.hex;
}

type Step = Ev | number | 'refresh' | 'ready';

/** A scripted flow: events, frame counts (1/60 s each), a refresh, or PANEL_READY for the current project and gen. */
function flow(mode: Mode, geo: Geo, steps: readonly Step[]): string {
  const m = machine(mode, false, geo);
  const trace = new Trace();
  trace.add(m);
  for (const s of steps) {
    if (typeof s === 'number') {
      for (let f = 0; f < s; f++) {
        frame(m);
        trace.add(m);
      }
      continue;
    }
    if (s === 'refresh') m.refresh();
    else if (s === 'ready') m.send({ type: 'PANEL_READY', id: m.state.project ?? '', gen: m.state.gen });
    else m.send(s);
    trace.add(m);
  }
  return trace.hex;
}

/** machine.spec: a deep link waits in the bed until the garden has entered it, then opens. */
function deepLink(geo: Geo): string {
  let entered = false;
  const m = machine('garden', false, { ...geo, bedReady: () => entered });
  const trace = new Trace();
  m.send({ type: 'SKIP_INTRO' });
  m.send({ type: 'GARDEN_READY' });
  m.send({ type: 'OPEN', id: 'rose-a' });
  for (let f = 0; f < 420; f++) {
    if (f === 300) {
      entered = true;
      m.refresh();
    }
    frame(m);
    trace.add(m);
  }
  return trace.hex;
}

const START: Step[] = [{ type: 'SKIP_INTRO' }, { type: 'GARDEN_READY' }];
const ROSALEDA: Ev = { type: 'GOTO', place: { k: 'bed', bed: 'rosaleda' } };
const ROSE: Ev = { type: 'FOCUS', slot: 'rosaleda/rose-a' };

function scenarios(geo: Geo): Record<string, string> {
  const out: Record<string, string> = {};
  for (let seed = 1; seed <= 200; seed++) out[`fuzz ${seed}`] = fuzz(seed, geo);
  out['intro'] = flow('garden', geo, [60, { type: 'SKIP_INTRO' }, 30]);
  out['open close'] = flow('garden', geo, [...START, ROSALEDA, 200, ROSE, 60, { type: 'OPEN', id: 'rose-a' }, 120, 'ready', 120, { type: 'BACK' }, 20, { type: 'OPEN', id: 'rose-a' }, 200, { type: 'CLOSE' }, 200]);
  out['travel retarget'] = flow('garden', geo, [{ type: 'SKIP_INTRO' }, 30, ROSALEDA, 24, { type: 'GOTO', place: { k: 'bed', bed: 'semillero' } }, 18, { type: 'GOTO', place: { k: 'overview' } }, 300]);
  out['back and step'] = flow('garden', geo, [...START, ROSALEDA, 200, ROSE, 30, { type: 'BACK' }, { type: 'STEP_BED', dir: 1 }, 200, { type: 'BACK' }, 200, { type: 'BACK' }]);
  out['scroll walk'] = flow('garden', geo, [...START, { type: 'GOTO', place: { k: 'bed', bed: 'puerta' }, via: 'scroll' }, 40, ROSALEDA, 10, { type: 'GOTO', place: { k: 'bed', bed: 'estanque' }, via: 'scroll' }, 300, { type: 'FOCUS', slot: 'estanque/lily-a' }, 5, { type: 'GOTO', place: { k: 'bed', bed: 'salida' }, via: 'scroll' }, 400]);
  out['other bed project'] = flow('garden', geo, [...START, ROSALEDA, 200, ROSE, 30, { type: 'OPEN', id: 'rose-a' }, 'ready', 200, { type: 'GOTO', place: { k: 'project', id: 'pod-a' } }, 600, 'ready', 300]);
  out['mode switch'] = flow('garden', geo, [{ type: 'SKIP_INTRO' }, { type: 'OPEN', id: 'lily-a' }, 100, { type: 'SET_MODE', mode: 'herbario' }, 60, { type: 'GOTO', place: { k: 'bed', bed: 'salida' } }, 10, { type: 'SET_MODE', mode: 'garden' }, 30, { type: 'GARDEN_READY' }, 300]);
  out['herbario deep link'] = flow('herbario', geo, [{ type: 'GOTO', place: { k: 'project', id: 'lily-a' } }, 200, { type: 'CLOSE' }, 100]);
  out['refresh while open'] = flow('garden', geo, [...START, ROSALEDA, 200, ROSE, 30, { type: 'OPEN', id: 'rose-a' }, 'ready', 200, 'refresh', 30]);
  out['deep link waits'] = deepLink(geo);
  return out;
}

test('with roam off the machine walks exactly the recorded trace', () => {
  const now = scenarios({});
  if (process.env['TRACE_RECORD'] === '1') writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>;
  expect(now).toEqual(golden);
  expect(scenarios({ roam: () => false, arrived: () => true })).toEqual(golden);
});

test('roam: a leg snaps, so travel ends the frame the visitor is inside the bed', () => {
  let inside = false;
  const m = machine('garden', false, { roam: () => true, arrived: (b) => inside && b === 'rosaleda' });
  m.send({ type: 'SKIP_INTRO' });
  m.send({ type: 'GARDEN_READY' });
  m.send({ type: 'GOTO', place: { k: 'bed', bed: 'puerta' }, via: 'scroll' });
  for (let f = 0; f < 200; f++) frame(m);
  expect(m.state.phase).toBe('travel');
  expect(m.ch.leg.value).toBe(1);
  expect(m.ch.dolly.value).toBe(1);
  m.send({ type: 'GOTO', place: { k: 'bed', bed: 'rosaleda' }, via: 'scroll' });
  expect(m.state.phase).toBe('travel');
  expect(m.state.bed).toBe('rosaleda');
  expect(m.ch.leg.value).toBe(1);
  expect(m.ch.leg.settled).toBe(true);
  frame(m);
  expect(m.state.phase).toBe('travel');
  inside = true;
  m.refresh();
  expect(m.state.phase).toBe('bed');
  m.send({ type: 'FOCUS', slot: 'rosaleda/rose-a' });
  expect(m.state.phase).toBe('focus');
});

test('roam: open and close still run their rows; the leg stays put', () => {
  const m = machine('garden', false, { roam: () => true, arrived: () => true });
  m.send({ type: 'SKIP_INTRO' });
  m.send({ type: 'GARDEN_READY' });
  m.send({ type: 'GOTO', place: { k: 'bed', bed: 'estanque' }, via: 'scroll' });
  for (let f = 0; f < 200; f++) frame(m);
  m.send({ type: 'FOCUS', slot: 'estanque/lily-a' });
  m.send({ type: 'OPEN', id: 'lily-a' });
  m.send({ type: 'PANEL_READY', id: 'lily-a', gen: m.state.gen });
  for (let f = 0; f < 120 && m.state.phase !== 'inspect'; f++) frame(m);
  expect(m.state.phase).toBe('inspect');
  m.send({ type: 'BACK' });
  for (let f = 0; f < 120 && m.state.phase === 'closing'; f++) frame(m);
  expect(m.state.phase).toBe('focus');
  expect(m.state.slot).toBe('estanque/lily-a');
  expect(m.ch.leg.value).toBe(1);
});
