import { expect, test } from '@playwright/test';
import garden from '../../../content/garden.json' with { type: 'json' };
import { worldModeOf } from '../../../src/world/mode.ts';

// The world mode a visit asks for (cook/ROAM_PLAN.md P7): free roam by default, the rail behind ?roam=0 for one
// release, and the shots S01 to S12 on the rail so their stills stay comparable; roam shots name a visitor.

const shots: Record<string, { hash: string; visitor?: readonly number[] }> = garden.shots;
const isRoamShot = (id: string): boolean => shots[id]?.visitor !== undefined;

test('free roam by default; ?roam=0 keeps the rail and ?roam=1 still roams', () => {
  expect(worldModeOf(null, undefined, isRoamShot)).toBe('roam');
  expect(worldModeOf('0', undefined, isRoamShot)).toBe('rail');
  expect(worldModeOf('1', undefined, isRoamShot)).toBe('roam');
  expect(worldModeOf('yes', undefined, isRoamShot), 'an unknown value is the default').toBe('roam');
});

test('a shot keeps the rail world unless it is a roam shot; ?roam wins over the shot', () => {
  for (let i = 1; i <= 12; i++) expect(worldModeOf(null, `S${String(i).padStart(2, '0')}`, isRoamShot)).toBe('rail');
  for (let i = 13; i <= 18; i++) expect(worldModeOf(null, `S${i}`, isRoamShot)).toBe('roam');
  expect(worldModeOf('1', 'S03', isRoamShot)).toBe('roam');
  expect(worldModeOf('0', 'S14', isRoamShot)).toBe('rail');
});
