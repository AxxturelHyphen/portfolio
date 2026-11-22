import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { BedId, Profile, Project } from '../../../src/types.ts';
import { chalkMarks, MAX_MARKS, yawToward, type ChalkMark } from '../../../src/world/chalk.ts';
import { GRID, KNOWN, glyphOf } from '../../../src/world/chalk.glyphs.ts';
import { INK_STRIDE, inkText } from '../../../src/world/chalk.hand.ts';
import type { BedScene3, WorldLayout } from '../../../src/world/layout.ts';
import { BED_IDS, validateBedScene } from '../../../src/world/scene.ts';

// The chalk (world/chalk.glyphs.ts, chalk.hand.ts, chalk.ts): every letter is strokes inside its box, the hand's
// strokes stay inside the mark and are timed stroke by stroke, and the marks lie where they point at what they name.

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
const world = json('content/garden.json') as WorldLayout;
const content = { projects: json('content/projects.json') as Project[], profile: json('content/profile.json') as Profile };
const scenes = Object.fromEntries(BED_IDS.map((b) => [b, validateBedScene(json(`content/beds/${b}.json`), b)])) as Record<BedId, BedScene3>;
const marks = (lang: 'en' | 'es', device: 'keys' | 'touch' = 'keys', first = true): ChalkMark[] => chalkMarks({ world, scenes, content, device, lang, first });

test('every letter, digit, Spanish letter, sign and arrow is strokes of two points or more inside its box', () => {
  for (const ch of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789áéíóúñüÁÉÍÓÚÑÜ¿¡?!.,:-/+→←↑↓↗↖⟶⤳']) {
    const g = glyphOf(ch);
    expect(g, ch).not.toBeNull();
    for (const s of g!.strokes) {
      expect(s.pts.length, ch).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < s.pts.length; i += 2) {
        expect(s.pts[i]!, ch).toBeGreaterThanOrEqual(-2);
        expect(s.pts[i + 1]!, ch).toBeGreaterThanOrEqual(0);
        expect(s.pts[i + 1]!, ch).toBeLessThanOrEqual(GRID.top);
      }
    }
  }
  expect(KNOWN.length).toBeGreaterThan(80);
  expect(glyphOf(' ')).toBeNull();
});

test('an accent sits over its letter: above the x-height on lowercase, above the cap on capitals', () => {
  const top = (ch: string): number => Math.max(...glyphOf(ch)!.strokes.flatMap((s) => s.pts.filter((_, i) => i % 2 === 1)));
  expect(top('é')).toBeGreaterThan(GRID.xHeight + 1);
  expect(top('é')).toBeLessThan(GRID.cap);
  expect(top('É')).toBeGreaterThan(GRID.cap);
  expect(glyphOf('í')!.strokes.length, 'the accented i has no dot').toBe(2);
  expect(glyphOf('ñ')!.strokes.length).toBe(glyphOf('n')!.strokes.length + 1);
});

test('the hand inks inside its mark, the same way every time, stroke by stroke in time', () => {
  const a = inkText('gato ⟶\n[Q] [E]', 5);
  const b = inkText('gato ⟶\n[Q] [E]', 5);
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

test('the cat note lies near the bench and points at the cat; the gate holds the controls on a first visit only', () => {
  const cat = scenes.rosaleda.slots.find((s) => s.id === 'cat')!;
  const note = marks('en').find((m) => m.id === 'cat')!;
  expect(note.text).toContain('cat');
  expect(Math.hypot(note.x - cat.x, note.z - cat.z)).toBeLessThan(3.6);
  expect(note.yaw).toBeCloseTo(yawToward(note.x, note.z, cat.x, cat.z), 6);
  expect(note.z, 'in front of the bench, toward the lens').toBeGreaterThan(cat.z);
  expect(note.x, 'left of the cat, so its arrow points at it').toBeLessThan(cat.x - 0.8);
  expect(marks('es').find((m) => m.id === 'cat')!.text).toContain('gato');

  const firsts = marks('en').filter((m) => m.group === 'first');
  expect(firsts.map((m) => m.text).join(' ')).toContain('walk');
  expect(firsts.some((m) => m.text.includes('Enter / Open'))).toBe(true);
  for (const m of firsts.filter((f) => f.id !== 'first/open')) expect(Math.hypot(m.x - world.anchors.puerta!, m.z + 3.3)).toBeLessThan(4.2);
  expect(marks('en', 'touch').filter((m) => m.group === 'first').map((m) => m.text)).toEqual(['drag\nto walk', 'two\nfingers\nturn', 'Enter / Open ⟶']);
  expect(marks('en', 'keys', false).some((m) => m.group === 'first')).toBe(false);
});

test('each project is named in front of its flower; CV by the Salida doorway; an arrow into the grotto', () => {
  const all = marks('es');
  expect(all.length).toBeLessThanOrEqual(MAX_MARKS);
  const names = all.filter((m) => m.group === 'project');
  expect(names.map((m) => m.id.split('/')[1]).sort()).toEqual(content.projects.map((p) => p.id).sort());
  for (const m of names) expect(m.text.startsWith('↑\n')).toBe(true);
  const cv = all.find((m) => m.id === 'cv/note')!;
  expect(cv.text).toBe('CV ⟶');
  expect(cv.x).toBeLessThan(world.ground.enclosure.door[0]);
  expect(cv.yaw, 'its arrow turns toward the doorway').toBeGreaterThan(0);
  const wall = all.find((m) => m.id === 'grotto/wall')!;
  expect(wall.surface).toBe('wall');
  expect(wall.z).toBeGreaterThan(world.ground.wall.z);
  expect(wall.y).toBeGreaterThan(1);
  expect(Math.abs(all.find((m) => m.id === 'grotto')!.x - 33.5)).toBeLessThan(1.5);
  const walk = world.ground.enclosure.walk;
  for (const m of all.filter((x) => x.surface === 'ground')) {
    expect(m.x, m.id).toBeGreaterThan(walk.minX);
    expect(m.x, m.id).toBeLessThan(walk.maxX);
    expect(m.z, m.id).toBeGreaterThan(walk.minZ);
    expect(m.z, m.id).toBeLessThan(walk.maxZ);
  }
});
