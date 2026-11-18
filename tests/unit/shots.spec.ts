import { expect, test } from '@playwright/test';
import { loadShots, pickShots } from '../helpers/shots.ts';

test('shot manifest lists S01 to S18 with valid sizes and times', () => {
  const shots = loadShots();
  expect(shots.map((s) => s.id)).toEqual(Array.from({ length: 18 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`));
  for (const s of shots) {
    expect(s.viewport[0], s.id).toBeGreaterThan(0);
    expect(s.viewport[1], s.id).toBeGreaterThan(0);
    expect(Number.isFinite(s.t) && s.t >= 0, `${s.id} frozen time`).toBe(true);
    expect(s.refs.length, `${s.id} refs`).toBeGreaterThan(0);
  }
  expect(shots.find((s) => s.id === 'S11')?.viewport).toEqual([390, 844]);
  expect(shots.find((s) => s.id === 'S18')?.viewport).toEqual([390, 844]);
  expect(shots.find((s) => s.id === 'S10')?.wait).toBe('dom');
});

test('pickShots validates ids', () => {
  const all = loadShots();
  expect(pickShots('S01, s03', all).map((s) => s.id)).toEqual(['S01', 'S03']);
  expect(() => pickShots('S99', all)).toThrow(/unknown shot/);
});
