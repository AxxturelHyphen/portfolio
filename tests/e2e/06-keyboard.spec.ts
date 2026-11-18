import type { Page } from '@playwright/test';
import { expect, PROJECTS, SEL, test } from '../helpers/jardin.ts';

// Flow 6: keyboard only. Herbario: toggles, project, panel reachable, Esc backs out one level and focus returns.
// Garden (free roam, the default): signposts, the plan and Tab reach every bed and every flower without steering (Tab
// walks the visitor to a flower out of reach); Esc backs out one level. The rail's version is in 19-rail-fallback.

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

/** From the top of the page, Tab until a project flower of the current bed (not in `skip`) holds DOM focus. */
async function tabToProject(page: Page, skip: readonly string[] = []): Promise<string> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('Tab');
    const slot = await page.evaluate(() => {
      const n = document.activeElement as HTMLElement | null;
      return n?.classList.contains('px-project') === true ? (n.dataset.slot ?? null) : null;
    });
    if (slot !== null && !skip.includes(slot)) return slot;
  }
  throw new Error('no project flower reached by Tab');
}

test('flow 6 garden: gate, beds, flowers, panel and Herbario by keyboard, Esc backs out one level', async ({ page, jardin }) => {
  await jardin.visit({ mode: 'garden' });
  await jardin.settled();
  const state = () => jardin.withApi((api) => api.state());
  expect(await state(), 'a new visitor stands at the gate').toMatchObject({ phase: 'bed', bed: 'puerta' });
  await page.locator('#proxies .px-sign[data-dir="next"]').focus();
  await page.keyboard.press('Enter'); // the signpost walks the visitor to the next bed
  await jardin.settled();
  expect(await state()).toMatchObject({ phase: 'bed', bed: 'rosaleda' });
  const slot = await tabToProject(page); // Tab walks the visitor to a flower out of reach and focuses it on arrival
  await expect.poll(async () => (await state()).slot, { timeout: 10000 }).toBe(slot);
  expect((await state()).phase).toBe('focus');
  await page.keyboard.press('Enter'); // View
  await jardin.settled();
  expect((await state()).phase).toBe('inspect');
  await page.keyboard.press('Escape'); // one level: panel to the flower (closing returns focus to it)
  await jardin.settled();
  expect((await state()).phase).toBe('focus');
  await page.keyboard.press('Escape'); // one level: flower to bed
  await jardin.settled();
  expect((await state()).phase).toBe('bed');
  await page.keyboard.press('Escape'); // one level: bed to the whole-garden view
  await jardin.settled();
  expect((await state()).phase).toBe('overview');
  await page.getByRole('button', { name: 'Exit to the CV album' }).focus();
  await page.keyboard.press('Enter');
  await jardin.settled();
  expect(await jardin.mode()).toBe('herbario');
});

test('flow 6 garden: every project opens by keyboard alone, through the plan and Tab, without steering', async ({ page, jardin }) => {
  test.setTimeout(150_000);
  await jardin.visit({ mode: 'garden' });
  await jardin.settled();
  const beds = [...new Set(PROJECTS.map((p) => p.bed))];
  const opened: string[] = [];
  for (const bed of beds) {
    if ((await jardin.withApi((api) => api.state().phase)) === 'focus') {
      await page.keyboard.press('Escape'); // closing rests on the flower; one level back to the bed (phones hide the plan over a tag)
      await jardin.settled();
    }
    await page.locator('#proxies .pl-tag').focus();
    await page.keyboard.press('Enter'); // unfold the plan
    let onPlace = false;
    for (let i = 0; i < 12 && !onPlace; i++) {
      await page.keyboard.press('Shift+Tab'); // the unfolded sheet comes just before its tag
      onPlace = await page.evaluate((b) => (document.activeElement as HTMLElement | null)?.closest('.pl-places')?.contains(document.activeElement) === true
        && (document.activeElement as HTMLElement).dataset.bed === b, bed);
    }
    expect(onPlace, `the plan's place for ${bed} is a Tab stop`).toBe(true);
    await page.keyboard.press('Enter'); // the plan walks the visitor there
    await page.keyboard.press('Escape'); // fold the plan
    await jardin.settled();
    expect((await jardin.withApi((api) => api.state())).bed).toBe(bed);
    const seen: string[] = [];
    for (let k = 0; k < PROJECTS.filter((p) => p.bed === bed).length; k++) {
      const slot = await tabToProject(page, seen);
      seen.push(slot);
      await expect.poll(() => jardin.withApi((api) => api.state().slot), { timeout: 10000, message: `${slot} focused on arrival` }).toBe(slot);
      const id = await page.locator(`#proxies [data-slot="${slot}"]`).getAttribute('data-project');
      const project = PROJECTS.find((p) => p.id === id);
      if (project === undefined) throw new Error(`slot ${slot} opens no project`);
      await page.keyboard.press('Enter');
      await jardin.expectOpen(project);
      await page.keyboard.press('Escape');
      await jardin.expectClosed();
      await jardin.settled();
      opened.push(project.id);
    }
  }
  expect(opened.sort(), 'every project opened').toEqual(PROJECTS.map((p) => p.id).sort());
});
