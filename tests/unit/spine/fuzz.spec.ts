import { expect, test } from '@playwright/test';
import { startRouter } from '../../../src/core/router.ts';
import type { BedId, Ev } from '../../../src/types.ts';
import { content, FakeHost, frame, machine, ORDER, PROJECTS, urlOf, violations } from './fixture.ts';

/** Mulberry32: a seeded PRNG so a failing sequence can be replayed from its seed. */
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

test('200 random event sequences never reach an invalid state and the URL always matches', () => {
  const failures: string[] = [];
  const check = (seed: number, step: number, m: ReturnType<typeof machine>, host: FakeHost): void => {
    for (const v of violations(m)) failures.push(`seed ${seed} step ${step}: ${v}`);
    if (host.url !== urlOf(m, host)) failures.push(`seed ${seed} step ${step}: url ${host.url} != ${urlOf(m, host)}`);
  };
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    const host = new FakeHost(pick(['#/', '#/b/rosaleda', '#/p/lily-a', '?mode=herbario#/p/pod-a', '#/p/nope']));
    const m = machine(r() < 0.3 ? 'herbario' : 'garden', r() < 0.2);
    startRouter(m, content, host);
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
      const frames = Math.floor(r() * 40);
      for (let f = 0; f < frames; f++) frame(m, r() < 0.1 ? 0.05 : 1 / 60);
      host.flush();
      check(seed, i, m, host);
    }
    m.scrub('open', null);
    for (let f = 0; f < 900; f++) frame(m);
    host.flush();
    check(seed, 60, m, host);
  }
  expect(failures.slice(0, 10)).toEqual([]);
});
