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

test('a thin hand: strokes about 0.85 of a grid unit, thinned by light pressure, never thicker', () => {
  const unit = 6;
  for (const s of inkText('un gol hace', unit).strokes) {
    for (let o = 0; o < s.length; o += INK_STRIDE) {
      expect(s[o + 2]!).toBeLessThanOrEqual(unit * 0.85 + 1e-6);
      expect(s[o + 2]!).toBeGreaterThan(unit * 0.85 * 0.6);
    }
  }
});

test('the looping arrow: inked after the word, a long stroke that loops back over itself and ends at its tip under the word', () => {
  const unit = 6;
  const plain = inkText('cat', unit);
  const left = inkText('cat', unit, -1);
  const right = inkText('cat', unit, 1);
  expect(plain.tip).toBeNull();
  expect(left.strokes.length, 'the word, the shaft and two barbs').toBe(plain.strokes.length + 3);
  const shaft = left.strokes[plain.strokes.length]!;
  const xs: number[] = [];
  for (let o = 0; o < shaft.length; o += INK_STRIDE) xs.push(shaft[o]!);
  let turns = 0;
  for (let i = 2; i < xs.length; i++) if (Math.sign(xs[i]! - xs[i - 1]!) !== Math.sign(xs[i - 1]! - xs[i - 2]!) && Math.abs(xs[i]! - xs[i - 1]!) > 0.05) turns++;
  expect(turns, 'it runs back on itself round the loop').toBeGreaterThanOrEqual(2);
  const [tx, ty] = left.tip!;
  expect(tx, 'the tip lies right of the word (-1)').toBeGreaterThan(left.w * 0.6);
  expect(ty, 'and well below it').toBeGreaterThan(left.h * 0.8);
  expect(right.tip![0], 'or left of it (1)').toBeLessThan(right.w * 0.4);
  const last = left.strokes[left.strokes.length - 1]!;
  expect(Math.hypot(last[0]! - tx, last[1]! - ty), 'the last barb starts at the tip').toBeLessThan(unit * 0.8);
});

test('chalk is only for the cat and the grotto room; the cat note floats upright just over the cat, its arrow on its back', () => {
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
  expect(note.text).toBe('cat');
  expect(marks('es').find((m) => m.id === 'cat')!.text).toBe('gato');
  expect(note.surface).toBe('air');
  expect(note.arrow).not.toBe(0);
  expect(Math.abs(note.x - cat.x), 'the tip over the cat').toBeLessThan(0.2);
  expect(note.y - cat.y, 'just over its back').toBeGreaterThan(0.1);
  expect(note.y - cat.y).toBeLessThan(0.6);
  expect(Math.abs(note.z - cat.z), "on the cat's own side of the path, a hair in front of its card").toBeLessThan(0.15);
  expect(note.z).toBeGreaterThan(cat.z);
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
