import { expect } from '@playwright/test';
import { createMachine, type GardenGeo, type MachineContent, type RuntimeMachine } from '../../../src/core/machine.ts';
import { formatRoute, type RouterHost } from '../../../src/core/router.ts';
import { bedOfPlace } from '../../../src/core/transitions.ts';
import type { BedId, Clock, Machine, Mode, ProjectId } from '../../../src/types.ts';

/** A small garden and project list for the spine tests, plus a fake history that behaves like the browser's. */

export const ORDER: BedId[] = ['puerta', 'rosaleda', 'estanque', 'semillero', 'salida'];
const anchors: Record<BedId, number> = { puerta: 0, rosaleda: 10, estanque: 20, semillero: 30, gruta: 35, salida: 40 };
const projects: { id: ProjectId; bed: 'rosaleda' | 'estanque' | 'semillero' }[] = [
  { id: 'rose-a', bed: 'rosaleda' },
  { id: 'rose-b', bed: 'rosaleda' },
  { id: 'lily-a', bed: 'estanque' },
  { id: 'pod-a', bed: 'semillero' },
];
export const PROJECTS = projects.map((p) => p.id);
export const content: MachineContent = { projects, garden: { order: ORDER, anchors, overview: { x: 20, y: 2, z: 12, pitch: 0, fov: 40 } } };
export const bedOf = (id: ProjectId): BedId | null => projects.find((p) => p.id === id)?.bed ?? null;
export const slotOf = (id: ProjectId): string | null => {
  const bed = bedOf(id);
  return bed === null ? null : `${bed}/${id}`;
};
export const geo = { order: ORDER, anchor: (b: BedId) => anchors[b], bedOf, slotOf, bedReady: (): boolean => true, viewX: (): null => null };

export function machine(mode: Mode = 'garden', reduced = false, gardenGeo: Partial<GardenGeo> = {}): RuntimeMachine {
  return createMachine(content, { mode, reduced, lang: 'en', geo: { slotOf, bedReady: () => true, viewX: () => null, ...gardenGeo } });
}

const clock = { now: 0, dt: 1 / 60, t: 0, frame: 0, frozen: false };
export function frame(m: Machine, dt = 1 / 60): void {
  clock.dt = dt;
  clock.now += dt * 1000;
  clock.frame++;
  m.tick(clock as Clock);
}
export function run(m: Machine, seconds: number, dt = 1 / 60): void {
  for (let t = 0; t < seconds; t += dt) frame(m, dt);
}
/** Runs until every channel has stayed settled for 0.25 s, so holds have elapsed (or fails after `maxS`). */
export function settle(m: Machine, maxS = 10): void {
  let quiet = 0;
  for (let t = 0; t < maxS; t += 1 / 60) {
    frame(m);
    quiet = Object.values(m.ch).every((c) => c.settled) ? quiet + 1 : 0;
    if (quiet >= 15) return;
  }
  throw new Error(`not settled after ${maxS} s in phase ${m.state.phase}`);
}

/** Broken invariants of the current state (empty when valid). Plain checks: the fuzz test runs this a lot. */
export function violations(m: Machine): string[] {
  const s = m.state;
  const out: string[] = [];
  const fail = (cond: boolean, msg: string): void => {
    if (cond) out.push(`${s.phase}: ${msg}`);
  };
  for (const [name, c] of Object.entries(m.ch)) fail(c.value < 0 || c.value > 1, `${name} out of 0..1`);
  const want = bedOfPlace(s.intent, geo);
  if (s.intent.k === 'project') fail(bedOf(s.intent.id) === null, 'unknown project in intent');
  const shown = s.phase === 'opening' || s.phase === 'inspect' || s.phase === 'closing';
  const intentProject = s.intent.k === 'project' ? s.intent.id : null;
  if (s.phase === 'overview') fail(s.bed !== null || s.intent.k !== 'overview', 'overview with a bed or another intent');
  if (s.phase === 'travel') fail(s.bed === null, 'travel without a bed');
  if (s.phase === 'bed' || s.phase === 'focus') fail(s.intent.k !== 'bed' || want !== s.bed, 'resting away from the intent');
  if (s.phase === 'focus') fail(s.slot?.startsWith(`${s.bed}/`) !== true, 'focus on a slot of another bed');
  if (s.phase === 'opening' || s.phase === 'inspect') fail(intentProject !== s.project || want !== s.bed, 'panel for another project');
  if (s.phase === 'closing') fail(s.project === null || intentProject === s.project, 'closing toward itself');
  if (!shown) fail(s.project !== intentProject, 'project not following the intent');
  if (s.mode === 'herbario') fail(m.ch.mode.target !== 1, 'herbario without the mode channel at 1');
  else if (s.gardenReady) fail(m.ch.mode.target !== 0, 'garden ready but the mode channel not at 0');
  return out;
}

export function expectValid(m: Machine): void {
  expect(violations(m)).toEqual([]);
}

interface HistoryEntry { url: string; state: unknown }

export class FakeHost implements RouterHost {
  readonly entries: HistoryEntry[];
  idx = 0;
  backCalls = 0;
  private pops = 0;
  private readonly listeners: (() => void)[] = [];
  readonly location: RouterHost['location'];
  readonly history: RouterHost['history'];

  constructor(url: string) {
    this.entries = [{ url, state: null }];
    const host = this;
    const cur = (): HistoryEntry => host.entries[host.idx] ?? { url: '', state: null };
    const split = (u: string): [string, string] => {
      const i = u.indexOf('#');
      return i < 0 ? [u, ''] : [u.slice(0, i), u.slice(i)];
    };
    this.location = {
      get href() { return `https://jardin.test/${cur().url}`; },
      get search() { return split(cur().url)[0]; },
      get hash() { return split(cur().url)[1]; },
    };
    this.history = {
      get state() { return cur().state; },
      pushState(state: unknown, _u: string, url: string) {
        host.entries.splice(host.idx + 1);
        host.entries.push({ url, state });
        host.idx++;
      },
      replaceState(state: unknown, _u: string, url: string) {
        host.entries[host.idx] = { url, state };
      },
      back() {
        host.backCalls++;
        if (host.idx > 0) { host.idx--; host.pops++; }
      },
    };
  }

  addEventListener(_type: 'popstate', fn: () => void): void {
    this.listeners.push(fn);
  }

  /** Delivers popstate events queued by history.back() (asynchronous in browsers). */
  flush(): void {
    while (this.pops > 0) {
      this.pops--;
      for (const fn of this.listeners) fn();
    }
  }

  /** The visitor presses back (-1) or forward (+1). */
  go(delta: -1 | 1): void {
    const next = this.idx + delta;
    if (next < 0 || next >= this.entries.length) return;
    this.idx = next;
    for (const fn of this.listeners) fn();
  }

  get url(): string {
    return this.location.search + this.location.hash;
  }
}

export function urlOf(m: Machine, host: FakeHost): string {
  const s = m.state;
  return formatRoute(s.intent, s.mode, s.lang, new URLSearchParams(host.location.search));
}

export function expectUrlMatches(m: Machine, host: FakeHost): void {
  expect(host.url).toBe(urlOf(m, host));
}
