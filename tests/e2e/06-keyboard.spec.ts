import { expect, PROJECTS, SEL, test } from '../helpers/jardin.ts';

// Flow 6: keyboard only. Herbario: toggles, project, panel reachable, Esc backs out one level and focus returns.
// Garden: overview, beds, flowers, panel, Herbario reachable (fixme until P1).

test('flow 6 herbario: toggles are reachable by Tab', async ({ page, jardin }) => {
  await jardin.visit();
  const want = [SEL.modeToggle, SEL.cv, SEL.lang];
  const found = new Set<string>();
  for (let i = 0; i < 12 && found.size < want.length; i++) {
    await page.keyboard.press('Tab');
    for (const sel of want) if (await page.evaluate((s) => document.activeElement?.matches(s) === true, sel)) found.add(sel);
  }
  expect([...found].sort(), 'mode toggle, Download CV and language reachable in 12 Tabs').toEqual([...want].sort());
});

test('flow 6 herbario: Tab to a project, Enter opens the panel, Esc closes and returns focus', async ({ page, jardin }) => {
  const first = PROJECTS[0];
  if (first === undefined) return;
  await jardin.visit();
  let inArticle = false;
  for (let i = 0; i < 60 && !inArticle; i++) {
    await page.keyboard.press('Tab');
    inArticle = await page.evaluate(() => document.activeElement?.closest('article[data-flower]') != null);
  }
  expect(inArticle, 'a project is a keyboard stop').toBe(true);
  const opened = await page.evaluate(() => document.activeElement?.closest('article[data-flower]')?.getAttribute('data-flower') ?? '');
  const proj = PROJECTS.find((p) => p.id === opened) ?? first;
  await page.keyboard.press('Enter');
  await jardin.expectOpen(proj);
  expect(await page.evaluate(() => document.getElementById('panel')?.contains(document.activeElement) === true), 'focus is inside the panel').toBe(true);
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  expect(
    await page.evaluate((id) => document.activeElement?.closest('article[data-flower]')?.getAttribute('data-flower') === id, proj.id),
    'focus returns to the project',
  ).toBe(true);
});

test('flow 6 herbario: Esc with nothing open does nothing and breaks nothing', async ({ page, jardin }) => {
  await jardin.visit();
  await page.keyboard.press('Escape');
  expect(await jardin.openDialogs()).toBe(0);
  expect(await jardin.hash()).toBe('#/');
});

test.fixme('flow 6 garden: overview, beds, flowers, panel and Herbario by keyboard, Esc backs out one level', async ({ page, jardin }) => {
  const first = PROJECTS[0];
  if (first === undefined) return;
  await jardin.visit({ mode: 'garden' });
  await jardin.settled();
  const phase = () => jardin.withApi((api) => api.state().phase);
  expect(await phase()).toBe('overview');
  await page.keyboard.press('ArrowRight'); // arrows move between beds
  await page.keyboard.press('Enter'); // enter the bed
  await jardin.settled();
  expect(await phase()).toBe('bed');
  for (let i = 0; i < 20 && (await phase()) !== 'focus'; i++) await page.keyboard.press('Tab'); // flowers are proxies
  expect(await phase()).toBe('focus');
  await page.keyboard.press('Enter'); // View
  await jardin.settled();
  expect(await phase()).toBe('inspect');
  await page.keyboard.press('Escape'); // one level: panel to bed
  await jardin.settled();
  expect(await phase()).toBe('bed');
  await page.keyboard.press('Escape'); // one level: bed to overview
  await jardin.settled();
  expect(await phase()).toBe('overview');
  await page.getByRole('button', { name: /herbario/i }).focus();
  await page.keyboard.press('Enter');
  await jardin.settled();
  expect(await jardin.mode()).toBe('herbario');
});
