import { expect, test } from '@playwright/test';
import { createQuest, QUEST_KEY } from '../../../src/ui/quest.ts';
import { createMemory, MEMORY_KEY, type KeyValue } from '../../../src/world/memory.ts';

// The lantern round (ui/quest.ts): flowers lit are the projects visited, a bed done and the whole garden each earn one
// note once, notes earned before the round loaded never replay, and start over forgets both.

const FLOWERS = [
  { id: 'a', bed: 'rosaleda' },
  { id: 'b', bed: 'semillero' },
  { id: 'c', bed: 'semillero' },
];

function fakeStore(seed: Record<string, string> = {}): KeyValue & { data: Record<string, string> } {
  const data = { ...seed };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

test('counts lit flowers and earns each note once: a bed, then the garden', () => {
  const store = fakeStore();
  const memory = createMemory(store);
  const quest = createQuest(FLOWERS, (id) => memory.visited(id), store);
  expect([quest.lit(), quest.total, quest.complete()]).toEqual([0, 3, false]);
  memory.visit('b');
  expect(quest.note('b')).toBeNull();
  memory.visit('a');
  expect(quest.note('a')).toEqual({ k: 'bed', bed: 'rosaleda' });
  expect(quest.note('a')).toBeNull();
  memory.visit('c');
  expect(quest.note('c')).toEqual({ k: 'complete' });
  expect([quest.lit(), quest.complete()]).toEqual([3, true]);
  expect(JSON.parse(store.data[QUEST_KEY] ?? '{}')).toEqual({ beds: ['rosaleda', 'semillero'], complete: true });
});

test('notes earned before the round loaded are taken as shown', () => {
  const store = fakeStore({ [MEMORY_KEY]: JSON.stringify(['a', 'b', 'c']) });
  const memory = createMemory(store);
  const quest = createQuest(FLOWERS, (id) => memory.visited(id), store);
  expect(quest.complete()).toBe(true);
  expect(quest.note('c')).toBeNull();
});

test('start over forgets the visits and the notes; broken or missing storage never throws', () => {
  const store = fakeStore({ [MEMORY_KEY]: JSON.stringify(['a']), [QUEST_KEY]: '{not json' });
  const memory = createMemory(store);
  const quest = createQuest(FLOWERS, (id) => memory.visited(id), store);
  memory.reset();
  quest.reset();
  expect([quest.lit(), store.data[MEMORY_KEY]]).toEqual([0, '[]']);
  memory.visit('a');
  expect(quest.note('a')).toEqual({ k: 'bed', bed: 'rosaleda' });
  const bare = createQuest(FLOWERS, () => true, null);
  expect(bare.note('a')).toBeNull();
  expect(bare.complete()).toBe(true);
});

test('start over tells its listeners at once, so the flowers resting open close live', () => {
  const memory = createMemory(fakeStore());
  memory.visit('a');
  let resets = 0;
  const off = memory.onReset(() => {
    resets++;
    expect(memory.visited('a'), 'the visits are gone before the listeners hear').toBe(false);
  });
  memory.reset();
  off();
  memory.reset();
  expect(resets).toBe(1);
});
