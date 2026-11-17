import { expect, test } from '@playwright/test';
import { createLoopWith, createRecorder, IDLE_MS, type LoopHost } from '../../../src/core/loop.ts';
import { createQualityWith, DPR, tierFromDeltas } from '../../../src/core/quality.ts';
import type { Clock } from '../../../src/types.ts';

/** A fake browser: rAF runs only when the test calls step(ms). */
function fakeHost(mobile = false) {
  let now = 0;
  let next: ((t: number) => void) | null = null;
  let hidden = false;
  let onVis: (() => void) | null = null;
  const host: LoopHost = {
    raf: (fn) => {
      next = fn;
      return 1;
    },
    caf: () => {
      next = null;
    },
    now: () => now,
    hidden: () => hidden,
    onVisibility: (fn) => {
      onVis = fn;
    },
    mobile,
    longTasks: null,
  };
  return {
    host,
    step(ms: number): boolean {
      now += ms;
      const fn = next;
      next = null;
      fn?.(now);
      return fn !== null;
    },
    setHidden(h: boolean): void {
      hidden = h;
      onVis?.();
    },
  };
}

test('recorder counts budget frames and p95 from its ring', () => {
  const r = createRecorder(null, 8);
  r.start('x');
  for (const ms of [16, 16, 16, 30, 60, 120, 16, 16, 16, 16]) r.frame(ms, 20);
  const rep = r.stop();
  expect(rep).toMatchObject({ label: 'x', frames: 10, over25: 3, over50: 2, over100: 1, max: 120, callsP95: 20 });
  expect(rep.p95).toBe(120);
  expect(r.frame(16, 1)).toBeUndefined();
  expect(r.stop().frames).toBe(10);
});

test('loop runs stages in the fixed order and stops on a pause', () => {
  const f = fakeHost();
  const loop = createLoopWith({}, f.host);
  const seen: string[] = [];
  loop.on('dom', () => seen.push('dom'));
  loop.on('sim', () => seen.push('sim'));
  const off = loop.on('input', () => seen.push('input'));
  loop.on('render', () => seen.push('render'));
  loop.start();
  f.step(16);
  expect(seen).toEqual(['input', 'sim', 'render', 'dom']);
  off();
  loop.pause('herbario');
  expect(loop.running).toBe(false);
  expect(f.step(16)).toBe(false);
  loop.resume('herbario');
  seen.length = 0;
  f.step(16);
  expect(seen).toEqual(['sim', 'render', 'dom']);
});

test('hidden tab pauses, frozen ?t holds content time, dt is clamped', () => {
  const f = fakeHost();
  const loop = createLoopWith({ t: 12.5 }, f.host);
  let last: Clock | null = null;
  loop.on('sim', (c) => {
    last = c;
  });
  loop.start();
  f.step(16);
  f.step(200);
  expect(loop.clock.t).toBe(12.5);
  expect(loop.clock.dt).toBeCloseTo(0.05, 6);
  expect(last).not.toBeNull();
  f.setHidden(true);
  expect(loop.running).toBe(false);
  f.setHidden(false);
  expect(loop.running).toBe(true);
});

test('mobile idles after 3 s without wake, wake resumes', () => {
  const f = fakeHost(true);
  const loop = createLoopWith({}, f.host);
  loop.start();
  for (let i = 0; i < Math.ceil(IDLE_MS / 16) + 2; i++) f.step(16);
  expect(loop.paused.has('idle-mobile')).toBe(true);
  expect(loop.running).toBe(false);
  loop.wake();
  expect(loop.running).toBe(true);
  expect(f.step(16)).toBe(true);
});

const deltas = (ms: number, n = 120): Float32Array => new Float32Array(n).fill(ms);

test('probe tiers: refresh-bound high, 30 fps mid, 22 fps low, 12 fps fail', () => {
  expect(tierFromDeltas(deltas(16.7))?.tier).toBe('high');
  const mixed = deltas(16.7);
  for (let i = 0; i < 40; i++) mixed[i] = 33.4;
  expect(tierFromDeltas(mixed)?.tier).toBe('mid');
  const slow = deltas(16.7);
  for (let i = 0; i < 60; i++) slow[i] = 45;
  expect(tierFromDeltas(slow)?.tier).toBe('low');
  const awful = deltas(16.7);
  for (let i = 0; i < 100; i++) awful[i] = 80;
  expect(tierFromDeltas(awful)?.tier).toBe('fail');
  expect(tierFromDeltas(deltas(16.7, 10))).toBeNull();
});

function clockAt(frame: number, now: number, dt: number): Clock {
  return { frame, now, dt, t: 0, frozen: false };
}

test('?tier wins over the probe; probe never raises the start tier', async () => {
  const q = createQualityWith({ tier: 'low' }, { mobile: false, devicePixelRatio: 2, lowMemory: false });
  expect(await q.probe()).toBe('low');
  expect(q.cfg.halation).toBe(false);
  const m = createQualityWith({}, { mobile: true, devicePixelRatio: 3, lowMemory: false });
  expect(m.tier).toBe('mid');
  const p = m.probe();
  for (let i = 0; i < 200; i++) m.sample(clockAt(i, i * 16.7, 0.0167));
  expect(await p).toBe('mid');
});

test('adaptive DPR steps down on slow windows and back up with hysteresis', async () => {
  const q = createQualityWith({ tier: 'high' }, { mobile: false, devicePixelRatio: 2, lowMemory: false });
  await q.probe();
  expect(q.dpr).toBe(1.5);
  let frame = 0;
  const run = (ms: number, windows: number): void => {
    for (let i = 0; i < DPR.window * windows; i++) q.adapt(clockAt(frame++, frame * ms, ms / 1000));
  };
  run(30, 1);
  expect(q.dpr).toBe(1.375);
  run(16.7, 2);
  expect(q.dpr).toBe(1.375);
  run(16.7, 1);
  expect(q.dpr).toBe(1.5);
  q.setPanelScale(0.75);
  expect(q.scale).toBeCloseTo(0.75, 6);
});
