import { expect, PROJECTS, projectsInDifferentBeds, test } from '../helpers/jardin.ts';

// Flow 2: deep link #/p/<id> cold: correct bed and project; back returns to a valid state. Unknown ids never error.

test('flow 2 herbario: cold deep link opens the right project in view of its bed', async ({ page, jardin }) => {
  for (const p of projectsInDifferentBeds()) {
    await jardin.visit(); // an earlier document to go back to
    await jardin.visit({ hash: `#/p/${p.id}`, query: { cold: p.id } }); // different query: a full document load, not a hash change
    await jardin.expectOpen(p);
    await expect(page.locator(`#b-${p.bed}`)).toBeAttached();
    await expect(page.locator(`article#p-${p.id}`)).toBeAttached();
    // Back from a cold deep link: Esc replaces the URL (no earlier entry of ours), back stays valid.
    await page.keyboard.press('Escape');
    await jardin.expectClosed();
    await page.goBack();
    expect(await jardin.mode(), 'back lands on the previous document, in a valid mode').toBe('herbario');
    expect(await jardin.openDialogs()).toBe(0);
    expect(await jardin.hash()).toBe('#/');
  }
});

test('flow 2 herbario: unknown project or bed becomes the overview, never an error', async ({ page, jardin }) => {
  await jardin.visit({ hash: '#/p/does-not-exist' });
  await expect.poll(() => jardin.hash()).toBe('#/');
  expect(await jardin.openDialogs()).toBe(0);
  await jardin.visit({ hash: '#/b/nowhere' });
  await expect.poll(() => jardin.hash()).toBe('#/');
  await expect(page.locator('h1')).toBeVisible();
});

test('flow 2 herbario: bed deep link scrolls its section into view', async ({ page, jardin }) => {
  const p = PROJECTS[PROJECTS.length - 1];
  if (p === undefined) return;
  await jardin.visit({ hash: `#/b/${p.bed}` });
  await expect(page.locator(`#b-${p.bed}`)).toBeInViewport();
  expect(await jardin.openDialogs()).toBe(0);
});

test('flow 2 garden: cold deep link lands in the right bed with the project open, back is valid', async ({ page, jardin }) => {
  const p = projectsInDifferentBeds()[1] ?? PROJECTS[0];
  if (p === undefined) return;
  await jardin.visit({ mode: 'garden' }); // an earlier garden document to go back to
  await jardin.settled();
  await jardin.visit({ mode: 'garden', hash: `#/p/${p.id}`, query: { cold: p.id } }); // full document load, not a hash change
  await jardin.settled();
  const s = await jardin.withApi((api) => api.state());
  expect(s.bed).toBe(p.bed);
  expect(s.project).toBe(p.id);
  expect(s.phase).toBe('inspect');
  await jardin.expectOpen(p);
  await page.goBack();
  await jardin.settled();
  const after = await jardin.withApi((api) => api.state());
  expect(['overview', 'bed']).toContain(after.phase);
  expect(await jardin.openDialogs()).toBe(0);
});
