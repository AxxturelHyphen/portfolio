import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { BedId } from '../../../src/types.ts';
import { chalkMarks, MAX_MARKS, rockZ, type ChalkMark } from '../../../src/world/chalk.ts';
import { GRID, KNOWN, glyphOf } from '../../../src/world/chalk.glyphs.ts';
import { INK_STRIDE, inkText } from '../../../src/world/chalk.hand.ts';
import { DOME } from '../../../src/world/grotto.ts';
import type { BedScene3 } from '../../../src/world/layout.ts';
import { BED_IDS, validateBedScene } from '../../../src/world/scene.ts';

// The chalk (world/chalk.glyphs.ts, chalk.hand.ts, chalk.ts): every letter is strokes inside its box, the hand's
// strokes stay inside the mark and are timed stroke by stroke, and only the cat and the grotto's room have chalk, every
// mark fixed in place.

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
const scenes = Object.fromEntries(BED_IDS.map((b) => [b, validateBedScene(json(`content/beds/${b}.json`), b)])) as Record<BedId, BedScene3>;
const marks = (lang: 'en' | 'es', device: 'keys' | 'touch' = 'keys'): ChalkMark[] => chalkMarks({ scenes, device, lang });

test('every lowercase letter, Spanish letter and arrow is strokes of two points or more inside its box', () => {
  for (const ch of [...'abcdefghijklmnopqrstuvwxyzáéíóúñü↑↓']) {
    const g = glyphOf(ch);
    expect(g, ch).not.toBeNull();
    for (const s of g!.strokes) {
      expect(s.pts.length, ch).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < s.pts.length; i += 2) {
        expect(s.pts[i]!, ch).toBeGreaterThanOrEqual(-2);
        expect(s.pts[i + 1]!, ch).toBeGreaterThanOrEqual(0);
        expect(s.pts[i + 1]!, ch).toBeLessThanOrEqual(11);
      }
    }
  }
  expect(KNOWN.length).toBe(35);
  expect(glyphOf(' ')).toBeNull();
});

test('an accent sits over its letter, above the x-height', () => {
  const top = (ch: string): number => Math.max(...glyphOf(ch)!.strokes.flatMap((s) => s.pts.filter((_, i) => i % 2 === 1)));
  expect(top('é')).toBeGreaterThan(GRID.xHeight + 1);
  expect(top('é')).toBeLessThan(GRID.cap);
  expect(glyphOf('í')!.strokes.length, 'the accented i has no dot').toBe(2);
  expect(glyphOf('ñ')!.strokes.length).toBe(glyphOf('n')!.strokes.length + 1);
});

test('the hand inks inside its mark, the same way every time, stroke by stroke in time', () => {
  const a = inkText('gato ↑\nel aro', 5);
  const b = inkText('gato ↑\nel aro', 5);
  expect(a.w).toBe(b.w);
  expect(a.strokes.length).toBe(b.strokes.length);
  expect(Array.from(a.strokes[3]!)).toEqual(Array.from(b.strokes[3]!));
  let last = -1;
  for (const s of a.strokes) {
    for (let o = 0; o < s.length; o += INK_STRIDE) {
      expect(s[o]!).toBeGreaterThanOrEqual(0);
      expect(s[o]!).toBeLessThanOrEqual(a.w);
      expect(s[o + 1]!).toBeGreaterThanOrEqual(0);
      expect(s[o + 1]!).toBeLessThanOrEqual(a.h);
      expect(s[o + 3]!, 'pressure').toBeGreaterThan(0.3);
      expect(s[o + 4]!, 'time runs on').toBeGreaterThan(last);
      last = s[o + 4]!;
    }
  }
  expect(last).toBeLessThan(1);
  expect(inkText('cat', 5).strokes.length, 'c, a (two), t (two)').toBe(5);
});

test('chalk is only for the cat and the grotto room; the cat note lies straight before the bench, its arrow up at the cat', () => {
  for (const lang of ['en', 'es'] as const) {
    for (const device of ['keys', 'touch'] as const) {
      const all = marks(lang, device);
      expect(all.length).toBeLessThanOrEqual(MAX_MARKS);
      expect(new Set(all.map((m) => m.group))).toEqual(new Set(['cat', 'grotto']));
      for (const m of all) for (const ch of m.text.replace(/\s/g, '')) expect(glyphOf(ch), `${m.id}: ${ch}`).not.toBeNull();
    }
  }
  const cat = scenes.rosaleda.slots.find((s) => s.id === 'cat')!;
  const note = marks('en').find((m) => m.id === 'cat')!;
  expect(note.text).toBe('↑\ncat');
  expect(marks('es').find((m) => m.id === 'cat')!.text).toBe('↑\ngato');
  expect(note.surface).toBe('ground');
  expect(Math.abs(note.x - cat.x), 'straight before the cat, so the up arrow points at it').toBeLessThan(0.4);
  expect(note.z - cat.z, 'past the path, toward the lens').toBeGreaterThan(1.8);
  expect(marks('en', 'touch').find((m) => m.id === 'cat'), 'the same on every device').toEqual(note);
});

test('the grotto notes stand on the back rock in front of its face, inside the room', () => {
  const notes = marks('es', 'touch').filter((m) => m.group === 'grotto');
  expect(notes.map((m) => m.text.split('\n')[0])).toEqual(['toca el aro', 'un gol hace']);
  expect(marks('en').find((m) => m.id === 'grotto/push')!.text).toBe('click the ring\n↓');
  for (const m of notes) {
    expect(m.surface).toBe('rock');
    expect(m.z, 'in front of the rock at its middle').toBeGreaterThan(rockZ(m.x, m.y) - 1e-6);
    expect(m.z, 'deep in the room').toBeLessThan(DOME.z - 2.5);
    const k = ((m.x - DOME.x) / DOME.rx) ** 2 + ((m.y - DOME.y) / DOME.ry) ** 2 + ((m.z - DOME.z) / DOME.rz) ** 2;
    expect(k, `${m.id} inside the dome`).toBeLessThan(1);
    expect(m.y).toBeGreaterThan(1);
  }
});
