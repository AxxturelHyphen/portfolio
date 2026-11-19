import { existsSync, statSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CLIP_GAP_S, SOUNDS, clipsOf, fileOf, loopLength, type SoundId } from '../../../src/audio/sounds.ts';
import { levelAt, panAt, perchFor } from '../../../src/audio/space.ts';
import { gainOf, graphOf } from '../../../scripts/stages/sound.ts';

// Where sounds come from (src/audio/space.ts), the recipe table (src/audio/sounds.ts) and the sound stage that cuts
// the shipped files from it (scripts/stages/sound.ts).

test('level: full within near, silent past far, falling smoothly between', () => {
  expect(levelAt(0, 1, 11)).toBe(1);
  expect(levelAt(1, 1, 11)).toBe(1);
  expect(levelAt(6, 1, 11)).toBeCloseTo(0.25);
  expect(levelAt(11, 1, 11)).toBe(0);
  expect(levelAt(40, 1, 11)).toBe(0);
  for (let d = 1; d < 11; d += 0.5) expect(levelAt(d + 0.5, 1, 11)).toBeLessThanOrEqual(levelAt(d, 1, 11));
});

test('pan: centred ahead, half way at 4 m, never hard to one side', () => {
  expect(panAt(0)).toBe(0);
  expect(panAt(4)).toBeCloseTo(0.5);
  expect(panAt(-4)).toBeCloseTo(-0.5);
  expect(panAt(1000)).toBe(0.75);
  expect(panAt(-1000)).toBe(-0.75);
});

test('perch: only perches in the ring around the visitor, none when the ring is empty', () => {
  const perches = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 30, z: 0 }];
  expect(perchFor(perches, 0, 0, 3, 18, 0)).toEqual({ x: 5, z: 0 });
  expect(perchFor(perches, 0, 0, 3, 18, 0.99)).toEqual({ x: 5, z: 0 });
  expect(perchFor(perches, 15, 0, 3, 18, 0)).toEqual({ x: 0, z: 0 });
  expect(perchFor(perches, 15, 0, 3, 18, 0.99)).toEqual({ x: 30, z: 0 });
  expect(perchFor(perches, 100, 0, 3, 18, 0.5)).toBeNull();
});

test('recipes: a loop is one stretch, sets pack their clips with a gap, every shipped file is small', () => {
  for (const id of Object.keys(SOUNDS) as SoundId[]) {
    const r = SOUNDS[id];
    for (const [a, b] of r.cuts) expect(b, `${id} cut`).toBeGreaterThan(a);
    if (r.loopFade !== undefined) {
      expect(r.cuts, `${id} loops one stretch`).toHaveLength(1);
      expect(loopLength(r), `${id} loop length`).toBeGreaterThan(4 * r.loopFade);
    }
    expect(r.kbps, `${id} bitrate`).toBeLessThanOrEqual(64);
    const file = `public/${fileOf(id)}`;
    if (existsSync(file)) expect(statSync(file).size, `${file} size`).toBeLessThan(200 * 1024);
  }
  const clips = clipsOf(SOUNDS.nightingale);
  expect(clips[0]?.at).toBe(0);
  const [first, second] = clips;
  expect(second?.at).toBeCloseTo((first?.dur ?? 0) + CLIP_GAP_S);
});

test('sound stage: a loop folds its tail into its head, a set concatenates, levelling hits its target', () => {
  const loop = graphOf(SOUNDS.crickets);
  expect(loop).toContain('amix=inputs=2:normalize=0');
  expect(loop.match(/curve=qsin/g)).toHaveLength(2);
  const set = graphOf(SOUNDS.nightingale);
  expect(set).toContain(`concat=n=${SOUNDS.nightingale.cuts.length}`);
  expect(gainOf(SOUNDS.nightingale, -30, -9)).toBeCloseTo(6);
  expect(gainOf(SOUNDS.crickets, -40, -20), 'a bed never peaks past -1 dBFS').toBeCloseTo(14);
  expect(gainOf(SOUNDS.crickets, -47, -30)).toBeCloseTo(21);
});
