import { expect, test } from '@playwright/test';
import { createPalette, NIGHT, paletteAt, wrapHour, type DayPalette } from '../../../src/world/daytime.ts';
import { linearHex } from '../../../src/gl/colour.ts';
import { DAY } from '../../../src/core/motion.ts';
import { Vector3 } from 'three';

// The garden's day (world/daytime.ts): continuous over the whole day and across 24 -> 0, and its night is the old
// lantern night, constant for constant.

const RGB = ['skyTop', 'skyHorizon', 'ambient', 'bounce', 'shadow', 'haze', 'key', 'keyDir', 'rim'] as const;
const NUM = ['hazeDensity', 'place', 'day', 'shadowSide', 'lampPool', 'invite', 'fireflies', 'nightSky', 'glow', 'sunDisc', 'sunAz', 'sunEl'] as const;

/** The largest difference between two palettes over every field. */
function gap(a: DayPalette, b: DayPalette): number {
  let d = 0;
  for (const f of RGB) for (let i = 0; i < 3; i++) d = Math.max(d, Math.abs(a[f][i]! - b[f][i]!));
  for (const f of NUM) d = Math.max(d, Math.abs(a[f] - b[f]) / (f === 'sunAz' ? 60 : 1));
  return d;
}

test('the palette moves smoothly over the whole day: no step between neighbouring minutes', () => {
  const a = createPalette();
  const b = createPalette();
  let worst = 0;
  for (let m = 0; m < 24 * 60; m++) {
    paletteAt(m / 60, a);
    paletteAt((m + 1) / 60, b);
    worst = Math.max(worst, gap(a, b));
  }
  expect(worst).toBeLessThan(0.03);
});

test('the day wraps: hour 24 is hour 0 and negative hours come round', () => {
  expect(gap(paletteAt(24, createPalette()), paletteAt(0, createPalette()))).toBeLessThan(1e-9);
  expect(gap(paletteAt(23.999, createPalette()), paletteAt(0.001, createPalette()))).toBeLessThan(1e-3);
  expect(gap(paletteAt(-2, createPalette()), paletteAt(22, createPalette()))).toBeLessThan(1e-9);
  expect(wrapHour(26.5)).toBeCloseTo(2.5, 9);
});

test('the night keyframe is the old lantern night, constant for constant', () => {
  const p = paletteAt(DAY.pinnedHour, createPalette());
  expect(gap(p, NIGHT)).toBeLessThan(1e-9);
  const lin = (hex: string, k = 1): number[] => linearHex(hex, new Vector3(), k).toArray();
  const close = (a: readonly number[], b: readonly number[]): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));
  close(p.key, lin('#b3aacb', 1.15));
  close(p.rim, lin('#c9c4d8', 0.65));
  close(p.haze, lin('#2a2940'));
  close(p.skyTop, lin('#141a46'));
  close(p.skyHorizon, lin('#3f528a'));
  close(p.ambient, lin('#424554'));
  close(p.bounce, lin('#424554', 0.8));
  close(p.shadow, lin('#261e3d'));
  close(p.keyDir, new Vector3(-0.35, 0.8, 0.5).normalize().toArray());
  expect([p.hazeDensity, p.place, p.day, p.shadowSide, p.lampPool, p.invite, p.fireflies, p.nightSky, p.glow, p.sunDisc]).toEqual([0.03, 1, 0, -1, 1, 1, 1, 1, 0, 0]);
});

test('by day the sun leads: no stars, faint pools, its own shadow map; the visit starts in daylight', () => {
  const noon = paletteAt(12, createPalette());
  expect(noon.day).toBe(1);
  expect(noon.nightSky).toBe(0);
  expect(noon.fireflies).toBe(0);
  expect(noon.lampPool).toBeLessThan(0.1);
  expect(noon.invite).toBeGreaterThan(0.1);
  expect(noon.shadowSide).toBeGreaterThan(0.5);
  expect(noon.skyTop[2]).toBeGreaterThan(noon.skyTop[0]);
  const start = paletteAt(DAY.startHour, createPalette());
  expect(start.day).toBeGreaterThan(0.9);
  expect(start.sunDisc).toBe(1);
});

test('the shadow map changes hands through zero strength at dusk and dawn', () => {
  const p = createPalette();
  let crossings = 0;
  let prev = paletteAt(0, p).shadowSide;
  for (let m = 1; m <= 24 * 60; m++) {
    const s = paletteAt(m / 60, p).shadowSide;
    if (Math.sign(s) !== Math.sign(prev)) {
      crossings++;
      expect(Math.abs(s)).toBeLessThan(0.03);
    }
    prev = s;
  }
  expect(crossings).toBe(2);
});
