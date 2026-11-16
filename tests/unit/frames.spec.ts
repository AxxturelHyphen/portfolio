import { expect, test } from '@playwright/test';
import { checkBudget, summarise } from '../helpers/frames.ts';

test('summarise counts frames over 25, 50 and 100 ms and the max', () => {
  const s = summarise('x', [16.7, 16.7, 26, 51, 101, 16.7]);
  expect(s).toMatchObject({ frames: 6, over25: 3, over50: 2, over100: 1, max: 101 });
});

test('transition budgets of spec section 10', () => {
  const clean = { over25: 0, over50: 0, over100: 0, max: 17 };
  expect(checkBudget(clean, 'panel', false)).toBeNull();
  expect(checkBudget({ ...clean, over25: 1, max: 30 }, 'panel', false)).not.toBeNull();
  expect(checkBudget({ ...clean, over25: 5, over50: 2, max: 60 }, 'panel', true)).toBeNull();
  expect(checkBudget({ ...clean, over25: 5, over50: 3, max: 60 }, 'travel', true)).not.toBeNull();
  expect(checkBudget({ ...clean, max: 100 }, 'switch', false)).toBeNull();
  expect(checkBudget({ ...clean, max: 101 }, 'switch', false)).not.toBeNull();
  expect(checkBudget({ ...clean, max: 150 }, 'switch', true)).toBeNull();
  expect(checkBudget({ ...clean, max: 151 }, 'switch', true)).not.toBeNull();
});
