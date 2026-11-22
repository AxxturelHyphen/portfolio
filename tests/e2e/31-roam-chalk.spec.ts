import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, test } from '../helpers/jardin.ts';
import { enterRoam, untilStill } from '../helpers/roam.ts';

// Chalk is only for the cat and the grotto's room (world/chalk.ts, gl/chalk.ts, garden/chalk.drive.ts): the cat has a
// chalk note floating over it on its own side of the path and no tag, yet its proxy keeps its name and wakes it; the
// note stays exactly where it is while the visitor walks; the gate has no chalk; the grotto's notes are on its back
// rock; the language switch redraws the chalk once. Clicked, the cat rubs its note out and follows the visitor for
// good (world/pet.leash.ts): past its bed's edge, behind them, through a reload, until start over.

const rosaleda = JSON.parse(readFileSync('content/beds/rosaleda.json', 'utf8')) as { bounds: [number, number]; slots: { id: string; x: number; z: number }[] };
const cat = rosaleda.slots.find((s) => s.id === 'cat')!;

type Mark = { id: string; text: string; opacity: number; x: number; y: number; z: number };
const marks = (page: Page): Promise<Mark[]> => page.evaluate(() => window.__chalk?.marks() ?? []);
const note = async (page: Page, id: string): Promise<Mark | undefined> => (await marks(page)).find((m) => m.id === id);

test('chalk: the cat has a fixed chalk note and no tag; its button keeps its name and still wakes it', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  await expect(page.getByRole('button', { name: 'The cat' })).toHaveCount(1);
  await expect.poll(async () => (await note(page, 'cat'))?.opacity, { message: 'the note is chalked by the bench' }).toBe(1);
  const before = await note(page, 'cat');
  expect(before?.text).toBe('cat');
  expect(before!.y, 'in the air over the cat').toBeGreaterThan(0.8);
  expect(Math.abs(before!.x - cat.x), 'over the cat').toBeLessThan(0.3);
  expect(Math.abs(before!.z - cat.z), "on the cat's own side of the path").toBeLessThan(0.2);
  const builds = await page.evaluate(() => window.__chalk?.builds ?? 0);
  await jardin.withApi((api, a) => api.walkTo(a.x, a.z), { x: cat.x + 0.4, z: cat.z + 1.1 });
  await expect.poll(() => jardin.withApi((api) => api.state().slot), { timeout: 10000, message: 'proximity focuses the cat' }).toBe('rosaleda/cat');
  await untilStill(page);
  expect(await note(page, 'cat'), 'the note has not moved or turned').toEqual(before);
  expect(await page.evaluate(() => window.__chalk?.builds ?? 0), 'nor been redrawn').toBe(builds);
  await page.waitForTimeout(900);
  await expect(page.locator('#label'), 'no tag on the cat').not.toHaveAttribute('data-shown');
  await page.evaluate(() => {
    const w = window as unknown as { __woke?: string };
    document.querySelector('#proxies')?.addEventListener('jardin:activate', (e) => { w.__woke = (e as CustomEvent<string>).detail; });
  });
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __woke?: string }).__woke), { message: 'Enter still wakes the cat' }).toBe('rosaleda/cat');
  expect(await jardin.openDialogs(), 'the cat opens no panel').toBe(0);
});

test('chalk: nothing is chalked at the gate', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/', { help: '1' });
  await untilStill(page);
  expect((await marks(page)).map((m) => m.id).sort()).toEqual(['cat', 'grotto/goal', 'grotto/push']);
  expect((await marks(page)).every((m) => m.opacity === 0), 'none in reach of the gate').toBe(true);
  expect(await page.evaluate(() => window.__chalk?.shown)).toBe(false);
});

test('chalk: the grotto room has its notes on the back rock', async ({ page, jardin, isMobile }) => {
  await enterRoam(jardin, '#/b/gruta');
  await expect.poll(async () => (await marks(page)).filter((m) => m.id.startsWith('grotto/')).every((m) => m.opacity === 1)).toBe(true);
  expect((await note(page, 'grotto/push'))?.text).toBe(isMobile ? 'tap the ring\n↓' : 'click the ring\n↓');
  expect((await note(page, 'cat'))?.opacity, 'the cat note is out of reach').toBe(0);
  expect(await page.locator('[data-gruta-target]').count(), 'the ring the note names is there').toBe(1);
});

test('chalk: the language switch redraws the chalk once', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  const before = await page.evaluate(() => window.__chalk?.builds ?? 0);
  await page.locator('#toggles [data-lang="es"]').first().click();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('es');
  await expect.poll(async () => (await note(page, 'cat'))?.text).toBe('gato');
  expect(await page.evaluate(() => window.__chalk?.builds ?? 0)).toBe(before + 1);
});

type At = { x: number; z: number };
const catAt = (page: Page): Promise<At | null> => page.evaluate(() => window.__cat?.at() ?? null);

test('cat: clicked, it rubs its note out and follows past its bed, behind the visitor, through a reload, until start over', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  await expect.poll(async () => (await note(page, 'cat'))?.opacity).toBe(1);
  await jardin.withApi((api, a) => api.walkTo(a.x, a.z), { x: cat.x + 0.4, z: cat.z + 1.1 });
  await expect.poll(() => jardin.withApi((api) => api.state().slot), { timeout: 10000 }).toBe('rosaleda/cat');
  await untilStill(page);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__cat?.on), { message: 'tied' }).toBe(true);
  await expect.poll(async () => (await note(page, 'cat'))?.opacity, { message: 'the note rubs out' }).toBe(0);
  await expect.poll(() => catAt(page), { timeout: 8000, message: 'down and following' }).not.toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('jardin.cat'))).toBe('1');

  const edge = rosaleda.bounds[1];
  const far = { x: edge + 2.7, z: 1.4 };
  await jardin.withApi((api, a) => api.walkTo(a.x, a.z), far);
  await expect.poll(async () => (await jardin.withApi((api) => api.roam()))!.x, { timeout: 15000, message: 'the visitor walks on' }).toBeGreaterThan(far.x - 0.2);
  await untilStill(page);
  await page.waitForTimeout(2500);
  const v = (await jardin.withApi((api) => api.roam()))!;
  const c = (await catAt(page))!;
  expect(c.x, 'past its bed toward the next one').toBeGreaterThan(edge);
  expect(v.x - c.x, 'behind the visitor walking on').toBeGreaterThan(0.2);
  expect(Math.hypot(v.x - c.x, v.z - c.z), 'a step or two away, never on them').toBeGreaterThan(0.5);
  expect(Math.hypot(v.x - c.x, v.z - c.z)).toBeLessThan(2.2);

  const settled = (await catAt(page))!;
  for (const [dx, dz] of [[0.03, 0], [-0.03, 0.02], [0.02, -0.03], [0, 0]] as const) {
    await jardin.withApi((api, a) => api.walkTo(a.x, a.z), { x: v.x + dx, z: v.z + dz });
    await page.waitForTimeout(300);
  }
  expect(await catAt(page), 'a jitter of the visitor moves nothing').toEqual(settled);

  await page.reload();
  await jardin.withApi((api) => api.ready);
  await expect.poll(() => page.evaluate(() => window.__cat?.on), { message: 'a reload keeps it' }).toBe(true);
  await jardin.goto('#/b/rosaleda');
  await expect.poll(() => catAt(page), { timeout: 15000, message: 'following again' }).not.toBeNull();
  expect((await note(page, 'cat'))?.opacity, 'its note stays gone').toBe(0);

  await page.locator('.pq-ask').click();
  await page.locator('#hp').getByRole('button', { name: 'Start over' }).click();
  await expect.poll(() => page.evaluate(() => window.__cat?.on), { message: 'start over lets it go' }).toBe(false);
  await expect.poll(() => catAt(page)).toBeNull();
  await expect.poll(async () => (await note(page, 'cat'))?.opacity, { message: 'and its note comes back' }).toBe(1);
  expect(jardin.errors).toEqual([]);
});
