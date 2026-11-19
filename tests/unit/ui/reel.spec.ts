import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import plateIndex from '../../../src/content/frames.json' with { type: 'json' };
import { loadContent } from '../../../src/content/load.ts';
import { frameOf, framesOf, MAX_FRAMES, MIN_FRAMES, motionOf, runs, stepOf, type Plate } from '../../../src/ui/reel.model.ts';
import { UNFURL, unfurlOf } from '../../../src/world/flower.ts';

// The project film (src/ui/reel.ts): which frame a media entry becomes, which plate an owner gap shows, and when it
// may move.
// The flower that unfurls in the garden as the project is entered (src/world/flower.ts).

const BLANK = 'Unexposed film';
const alt = (en: string): { en: string; es: string } => ({ en, es: en });

test('a media entry with a real src becomes a frame of its kind, with its own alt', () => {
  expect(frameOf({ type: 'image', src: 'shots/a.avif', alt: alt('The lesson list') }, 'en', BLANK, 'P')).toEqual({ kind: 'image', src: 'shots/a.avif', alt: 'The lesson list', caption: '' });
  expect(frameOf({ type: 'video', src: 'clips/a.mp4', alt: alt('Scrolling the list') }, 'en', BLANK, 'P').kind).toBe('video');
});

test('a gap src is a blank frame named by the caption; a gap alt on a real frame falls back to the title', () => {
  expect(frameOf({ type: 'image', src: '[FILL: screenshots]', alt: alt('[FILL]') }, 'en', BLANK, 'P')).toEqual({ kind: 'blank', src: '', alt: BLANK, caption: '' });
  expect(frameOf({ type: 'video', src: '[FILL]', alt: alt('A clip') }, 'en', BLANK, 'P').kind).toBe('blank');
  expect(frameOf({ type: 'image', src: 'a.avif', alt: alt('[FILL]') }, 'en', BLANK, 'Garagic').alt).toBe('Garagic');
});

const PLATES: Plate[] = [
  { src: 'frames/a.avif', title: 'Les Roses: Rosa Gallica', name: 'Rosa Gallica' },
  { src: 'frames/b.avif', title: 'Cabbage Rose (Rosa Centifolia Simplex)', name: 'Cabbage Rose' },
];

test('the strip carries two to four frames: gaps pad it, extra media are left off', () => {
  const one = framesOf({ title: 'P', media: [{ type: 'image', src: 'a.avif', alt: alt('A') }] }, 'en', BLANK, []);
  expect(one.map((f) => f.kind)).toEqual(['image', 'blank']);
  const many = Array.from({ length: 6 }, (_, i) => ({ type: 'image' as const, src: `${i}.avif`, alt: alt(`${i}`) }));
  expect(framesOf({ title: 'P', media: many }, 'en', BLANK, PLATES)).toHaveLength(MAX_FRAMES);
  expect(framesOf({ title: 'P', media: [] }, 'en', BLANK, [])).toHaveLength(MIN_FRAMES);
});

test('each gap takes the next plate under its real title; real media keep their place; no plate left is blank film', () => {
  const media = [{ type: 'image' as const, src: '[FILL]', alt: alt('[FILL]') }, { type: 'image' as const, src: 'a.avif', alt: alt('A') }, { type: 'video' as const, src: '[FILL]', alt: alt('B') }];
  expect(framesOf({ title: 'P', media }, 'en', BLANK, PLATES)).toEqual([
    { kind: 'plate', src: 'frames/a.avif', alt: 'Les Roses: Rosa Gallica', caption: 'Rosa Gallica' },
    { kind: 'image', src: 'a.avif', alt: 'A', caption: '' },
    { kind: 'plate', src: 'frames/b.avif', alt: 'Cabbage Rose (Rosa Centifolia Simplex)', caption: 'Cabbage Rose' },
  ]);
  expect(framesOf({ title: 'P', media: [] }, 'en', BLANK, PLATES.slice(1)).map((f) => f.kind)).toEqual(['plate', 'blank']);
});

test('every project today shows a plate in every frame, and no plate shows twice across the projects', () => {
  const seen = new Set<string>();
  for (const p of loadContent().projects) {
    const plates = plateIndex.frames.filter((f) => f.project === p.id).map((f) => ({ src: `frames/${f.file}`, title: f.plateTitle, name: f.name }));
    for (const l of ['en', 'es'] as const) {
      const frames = framesOf(p, l, BLANK, plates);
      expect(frames.length).toBeGreaterThanOrEqual(MIN_FRAMES);
      expect(frames.every((f) => f.kind === 'plate' && f.alt !== '' && f.caption !== ''), `${p.id} ${l}`).toBe(true);
    }
    for (const f of plateIndex.frames.filter((e) => e.project === p.id)) {
      expect(seen.has(f.source), `${f.source} repeats`).toBe(false);
      seen.add(f.source);
      expect(existsSync(`public/frames/${f.file}`), f.file).toBe(true);
    }
  }
});

test('steps wrap at both ends', () => {
  expect(stepOf(0, 3, 1)).toBe(1);
  expect(stepOf(2, 3, 1)).toBe(0);
  expect(stepOf(0, 3, -1)).toBe(2);
  expect(stepOf(1, 2, 1)).toBe(0);
});

test('reduced motion: no auto-advance and no pull; frozen time and stills: no auto-advance and no pull', () => {
  expect(motionOf(false, false)).toEqual({ auto: true, pull: true });
  expect(motionOf(true, false)).toEqual({ auto: false, pull: false });
  expect(motionOf(false, true)).toEqual({ auto: false, pull: false });
});

test('the film runs on by itself only while shown, not held, not stopped and the tab visible', () => {
  const m = motionOf(false, false);
  expect(runs(m, true, false, false, false)).toBe(true);
  expect(runs(m, false, false, false, false), 'panel not shown').toBe(false);
  expect(runs(m, true, true, false, false), 'hover or focus').toBe(false);
  expect(runs(m, true, false, true, false), 'stopped').toBe(false);
  expect(runs(m, true, false, false, true), 'tab hidden').toBe(false);
  expect(runs(motionOf(true, false), true, false, false, false), 'reduced motion').toBe(false);
});

test('the garden flower unfurls in stop-motion steps; frozen time and reduced motion switch it at once', () => {
  const n = UNFURL.steps - 1;
  expect(unfurlOf(0.5, true, false)).toBe(Math.round(0.5 * n) / n);
  expect(unfurlOf(1.4, true, false)).toBe(1);
  expect(unfurlOf(0.33, true, true)).toBe(1);
  expect(unfurlOf(0.9, false, true)).toBe(0);
  const seen = new Set<number>();
  for (let k = 0; k <= 1; k += 0.01) seen.add(unfurlOf(k, true, false));
  expect(seen.size).toBe(UNFURL.steps);
});
