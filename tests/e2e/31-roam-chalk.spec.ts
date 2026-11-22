import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, isLow, test } from '../helpers/jardin.ts';
import { enterRoam, focusIn, untilStill } from '../helpers/roam.ts';

// The garden says things in chalk (world/chalk.ts, gl/chalk.ts, garden/chalk.drive.ts) instead of DOM tags: the cat
// has a chalk note by the bench and no tag, yet its proxy keeps its name and wakes it; the controls are chalked at the
// gate on a first visit and wear away once learnt; the language switch redraws the chalk; the help card waits behind
// the "?".

const rosaleda = JSON.parse(readFileSync('content/beds/rosaleda.json', 'utf8')) as { slots: { id: string; x: number; z: number }[] };
const cat = rosaleda.slots.find((s) => s.id === 'cat')!;

type Mark = { id: string; text: string; opacity: number };
const marks = (page: Page): Promise<Mark[]> => page.evaluate(() => window.__chalk?.marks() ?? []);
const opacityOf = async (page: Page, id: string): Promise<number> => (await marks(page)).find((m) => m.id === id)?.opacity ?? -1;

test('chalk: the cat has a chalk note and no tag; its button keeps its name and still wakes it', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  await expect(page.getByRole('button', { name: 'The cat' })).toHaveCount(1);
  await jardin.withApi((api, a) => api.walkTo(a.x, a.z), { x: cat.x + 0.4, z: cat.z + 1.1 });
  await expect.poll(() => jardin.withApi((api) => api.state().slot), { timeout: 10000, message: 'proximity focuses the cat' }).toBe('rosaleda/cat');
  await page.waitForTimeout(900);
  await expect(page.locator('#label'), 'no tag on the cat').not.toHaveAttribute('data-shown');
  const note = (await marks(page)).find((m) => m.id === 'cat');
  expect(note?.text).toBe('cat ⟶');
  await expect.poll(() => opacityOf(page, 'cat'), { message: 'the note is chalked by the bench' }).toBe(1);
  await page.evaluate(() => {
    const w = window as unknown as { __woke?: string };
    document.querySelector('#proxies')?.addEventListener('jardin:activate', (e) => { w.__woke = (e as CustomEvent<string>).detail; });
  });
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __woke?: string }).__woke), { message: 'Enter still wakes the cat' }).toBe('rosaleda/cat');
  expect(await jardin.openDialogs(), 'the cat opens no panel').toBe(0);
});

test('chalk: a project flower keeps its tag and is named in chalk in front of it', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  await jardin.withApi((api) => api.walkTo(11.6, -0.4));
  await focusIn(page, 'rosaleda');
  await expect(page.locator('#label')).toHaveAttribute('data-shown', '');
  await expect.poll(() => opacityOf(page, 'project/garagic'), { message: 'the name shows as the visitor comes near' }).toBe(1);
  expect((await marks(page)).find((m) => m.id === 'project/garagic')?.text).toBe('↑\nGaragic');
});

test('chalk: on a first visit the controls are chalked at the gate and the help card waits behind the "?"', async ({ page, jardin, isMobile, tierOpt }) => {
  await enterRoam(jardin, '#/', { help: '1' });
  await untilStill(page);
  const first = (await marks(page)).filter((m) => m.id.startsWith('first/'));
  expect(first.map((m) => m.text).join(' ')).toContain(isMobile ? 'to walk' : 'walk');
  await expect.poll(async () => (await marks(page)).filter((m) => m.id.startsWith('first/')).every((m) => m.opacity === 1)).toBe(true);
  expect((await marks(page)).some((m) => m.id === 'cv/note' && m.text === 'CV ⟶')).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__chalk?.shown), { message: isLow(tierOpt) ? 'shown while standing still' : 'shown' }).toBe(true);
  await page.waitForTimeout(2500);
  await expect(page.locator('#hp'), 'no card by itself').toBeHidden();
  await page.locator('.pq-ask').click();
  await expect(page.locator('#hp')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#hp')).toBeHidden();
});

test('chalk: the controls wear away once the visitor has walked and opened something, and stay away', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/', { help: '1' });
  await jardin.withApi((api) => api.walkTo(4, 1));
  await untilStill(page);
  await jardin.goto('#/p/garagic');
  await expect(jardin.panel).toBeVisible();
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('jardin.chalk'))).toBe('1');
  await expect.poll(async () => (await marks(page)).filter((m) => m.id.startsWith('first/')).every((m) => m.opacity === 0), { message: 'worn away' }).toBe(true);
  await enterRoam(jardin, '#/b/puerta');
  expect((await marks(page)).some((m) => m.id.startsWith('first/')), 'never chalked again').toBe(false);
});

test('chalk: the language switch redraws the chalk once', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  const before = await page.evaluate(() => window.__chalk?.builds ?? 0);
  await page.locator('#toggles [data-lang="es"]').first().click();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('es');
  await expect.poll(async () => (await marks(page)).find((m) => m.id === 'cat')?.text).toBe('gato ⟶');
  expect(await page.evaluate(() => window.__chalk?.builds ?? 0)).toBe(before + 1);
});
