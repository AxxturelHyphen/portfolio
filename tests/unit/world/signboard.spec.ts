import { expect, test } from '@playwright/test';
import { ARM_RECT, ATLAS, BOARD, LANTERN_RECT, MAX_SIGNS, PLANK_SPRITE, POST_RECT, flameInPlank, plankCentre, plankRect, signQuads, type AtlasRect } from '../../../src/world/signboard.ts';

// Free roam's signposts (world/signboard.ts): every part has its own place in the painted atlas, the lantern hangs
// past the plank on the side the sign points, and the button's centre is the board's.

const meets = (a: AtlasRect, b: AtlasRect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('the atlas holds every part apart and inside the page', () => {
  const rects = [POST_RECT, ARM_RECT, LANTERN_RECT, ...Array.from({ length: MAX_SIGNS }, (_, i) => plankRect(i))];
  for (const r of rects) {
    expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= ATLAS.side && r.y + r.h <= ATLAS.side, JSON.stringify(r)).toBe(true);
  }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(meets(rects[i]!, rects[j]!), `${i} and ${j}`).toBe(false);
});

test('the lantern hangs just past the plank on the side it points, at the top of the board', () => {
  const f = new Float32Array(2);
  flameInPlank(1, f);
  expect(f[0]).toBeGreaterThan(1);
  expect(f[0]).toBeLessThan(1.15);
  const right = f[0]!;
  flameInPlank(-1, f);
  expect(f[0]).toBeCloseTo(1 - right, 6);
  const boardTop = (PLANK_SPRITE.h - BOARD.plank.margin - BOARD.plank.bridle) / PLANK_SPRITE.h;
  expect(Math.abs(f[1]! - boardTop)).toBeLessThan(0.1);
});

test('the button lies on the board, and a sign pointing back mirrors the one pointing on', () => {
  const at: [number, number, number] = [0, 0, 0];
  plankCentre({ x: 10, z: -1, dir: -1 }, at);
  expect(at[0]).toBeCloseTo(10 - BOARD.plank.hookAt, 6);
  const on = signQuads({ x: 10, z: -1, dir: 1 }, 0);
  const back = signQuads({ x: 10, z: -1, dir: -1 }, 1);
  expect(on.plank.x - 10).toBeCloseTo(10 - back.plank.x, 6);
  expect(on.lantern.x - 10).toBeCloseTo(10 - back.lantern.x, 6);
  expect(on.arm.px + back.arm.px).toBeCloseTo(1, 6);
  expect(on.plank.y, 'the plank hangs from the arm').toBe(BOARD.arm.under);
  expect(on.plank.y - on.plank.py * on.plank.h, 'the board hangs over the visitor (1.4 m)').toBeGreaterThan(1.4);
});
