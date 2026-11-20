import { expect, test } from '@playwright/test';
import type { Clock } from '../../../src/types.ts';
import { flutterAt } from '../../../src/world/moth.flutter.ts';
import { MOTH_ROAM, createMothRoam } from '../../../src/world/moth.roam.ts';

// Free roam's moth: it keeps to the grotto's mouth, is drawn out to a lantern that comes near, circles it, goes home
// and rests. Reduced motion holds it at home with its wings spread; frozen time decides from distance alone.

const home = new Float32Array([33.5, 1.4, -5.8]);
const clock = (t: number, dt: number, frozen = false): Clock => ({ now: t * 1000, t, dt, frame: Math.round(t * 60), frozen });

function run(flame: Float32Array, seconds: number, reduced = false) {
  const roam = createMothRoam(flame, home);
  const at = new Float32Array([home[0]!, home[1]!, home[2]! + MOTH_ROAM.homeOut]);
  const modes = new Set<string>();
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    roam.step(clock(t, dt), reduced, at);
    for (let i = 0; i < 3; i++) at[i] = at[i]! + (roam.target[i]! - at[i]!) * Math.min(1, dt / roam.tauS);
    modes.add(roam.mode);
  }
  return { roam, modes };
}

test('moth roam: a far lantern leaves the moth at home', () => {
  const { modes } = run(new Float32Array([20, 1, 0]), 5);
  expect([...modes]).toEqual(['rest']);
});

test('moth roam: a near lantern draws it out, it circles, then goes home', () => {
  const { modes, roam } = run(new Float32Array([33.4, 0.8, -4.7]), MOTH_ROAM.circleS + 4);
  expect(modes.has('follow')).toBe(true);
  expect(modes.has('circle')).toBe(true);
  expect(modes.has('flee')).toBe(true);
  expect(roam.mode).toBe('rest');
});

test('moth roam: reduced motion keeps it home, still, with its wings spread', () => {
  const { modes } = run(new Float32Array([33.4, 0.8, -4.7]), 3, true);
  expect([...modes]).toEqual(['rest']);
  const out = new Float32Array(4);
  flutterAt(7.3, 1.6, true, out);
  expect(Array.from(out)).toEqual([0, 0, 0, 1]);
});

test('moth roam: frozen time circles a near lantern on the clock alone', () => {
  const flame = new Float32Array([33.4, 0.8, -4.7]);
  const a = createMothRoam(flame, home);
  const b = createMothRoam(flame, home);
  const at = new Float32Array(3);
  a.step(clock(12.5, 0.05, true), false, at);
  for (const dt of [0.016, 0.033, 0.05]) b.step(clock(12.5, dt, true), false, at);
  expect(a.mode).toBe('circle');
  expect(Array.from(b.target)).toEqual(Array.from(a.target));
});

test('moth flutter: the wings beat through their whole range and the path stays near its line', () => {
  const out = new Float32Array(4);
  let lo = 1;
  let hi = 0;
  for (let t = 0; t < 3; t += 1 / 120) {
    flutterAt(t, 1, false, out);
    lo = Math.min(lo, out[3]!);
    hi = Math.max(hi, out[3]!);
    expect(Math.hypot(out[0]!, out[1]!, out[2]!)).toBeLessThan(0.5);
  }
  expect(lo).toBeLessThan(0.1);
  expect(hi).toBeGreaterThan(0.95);
});
