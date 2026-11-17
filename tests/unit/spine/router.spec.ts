import { expect, test } from '@playwright/test';
import { startRouter } from '../../../src/core/router.ts';
import { content, expectUrlMatches, FakeHost, machine, run, settle } from './fixture.ts';

function boot(url: string, mode: 'garden' | 'herbario' = 'garden') {
  const host = new FakeHost(url);
  const m = machine(mode);
  startRouter(m, content, host);
  return { host, m };
}

test('cold deep link lands on the project; closing replaces with its bed', () => {
  const { host, m } = boot('?mode=herbario&t=2#/p/lily-a', 'herbario');
  expect(m.state.phase).toBe('opening');
  expect(host.url).toBe('?mode=herbario&t=2#/p/lily-a');
  m.send({ type: 'CLOSE' });
  host.flush();
  expect(host.backCalls).toBe(0);
  expect(host.entries.length).toBe(1);
  expect(host.url).toBe('?mode=herbario&t=2#/b/estanque');
  expectUrlMatches(m, host);
});

test('unknown place becomes the overview and the URL is replaced', () => {
  const { host, m } = boot('#/p/nope');
  expect(m.state.intent).toEqual({ k: 'overview' });
  expect(host.url).toBe('?mode=garden#/');
  expect(host.entries.length).toBe(1);
});

test('user moves push; close goes back when the previous entry is the target', () => {
  const { host, m } = boot('#/');
  m.send({ type: 'SKIP_INTRO' });
  m.send({ type: 'GOTO', place: { k: 'bed', bed: 'rosaleda' } });
  m.send({ type: 'OPEN', id: 'rose-a' });
  run(m, 3);
  expect(m.state.phase).toBe('opening');
  expect(host.entries.length).toBe(3);
  m.send({ type: 'BACK' });
  host.flush();
  expect(host.backCalls).toBe(1);
  expect(host.idx).toBe(1);
  expect(host.url).toBe('?mode=garden#/b/rosaleda');
  expectUrlMatches(m, host);
  host.go(1);
  expect(m.state.intent).toEqual({ k: 'project', id: 'rose-a' });
  host.go(-1);
  host.go(-1);
  expect(m.state.intent).toEqual({ k: 'overview' });
  expectUrlMatches(m, host);
});

test('mode, language and scroll replace; back after a mode switch keeps the mode', () => {
  const { host, m } = boot('#/');
  m.send({ type: 'GOTO', place: { k: 'bed', bed: 'estanque' } });
  m.send({ type: 'SET_MODE', mode: 'herbario' });
  m.send({ type: 'SET_LANG', lang: 'es' });
  m.send({ type: 'GOTO', place: { k: 'bed', bed: 'semillero' }, via: 'scroll' });
  expect(host.entries.length).toBe(2);
  expect(host.url).toBe('?mode=herbario&lang=es#/b/semillero');
  host.go(-1);
  expect(m.state.mode).toBe('herbario');
  expect(m.state.intent).toEqual({ k: 'overview' });
  expectUrlMatches(m, host);
});

test('a new intent while history.back() is pending is pushed once back lands', () => {
  const { host, m } = boot('#/');
  m.send({ type: 'GOTO', place: { k: 'bed', bed: 'rosaleda' } });
  m.send({ type: 'OPEN', id: 'rose-a' });
  m.send({ type: 'CLOSE' });
  m.send({ type: 'OPEN', id: 'rose-b' });
  host.flush();
  expect(host.url).toBe('?mode=garden#/p/rose-b');
  expect(host.entries.length).toBe(3);
  expectUrlMatches(m, host);
  settle(m);
});
