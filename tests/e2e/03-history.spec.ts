import { expect, projectsInDifferentBeds, test } from '../helpers/jardin.ts';

// Flow 3: back and forward through projects in different beds: URL, panel and camera stay in sync. In free roam (the
// default) each back or forward to another bed is an assisted walk along the path; the waits cover it.

test('flow 3 herbario: back and forward across beds keep URL and panel in sync', async ({ page, jardin }) => {
  const [a, b] = projectsInDifferentBeds();
  if (a === undefined || b === undefined) throw new Error('need projects in two beds');
  await jardin.visit();
  await jardin.open(a.id);
  await jardin.expectOpen(a);
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  await jardin.open(b.id);
  await jardin.expectOpen(b);

  await page.goBack(); // b -> overview
  await jardin.expectClosed();
  await page.goForward(); // overview -> b
  await jardin.expectOpen(b);
  await page.goBack();
  await jardin.expectClosed();
  await page.goForward();
  await jardin.expectOpen(b);
  expect(await jardin.openDialogs()).toBe(1);
});

test('flow 3 herbario: rapid back and forward bursts end in one valid state', async ({ page, jardin }) => {
  const [a, b] = projectsInDifferentBeds();
  if (a === undefined || b === undefined) throw new Error('need projects in two beds');
  await jardin.visit();
  await jardin.open(a.id);
  await jardin.expectOpen(a);
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  await jardin.open(b.id);
  await jardin.expectOpen(b);
  for (let i = 0; i < 6; i++) {
    await page.goBack().catch(() => undefined);
    await page.goForward().catch(() => undefined);
  }
  await page.waitForTimeout(500);
  expect(await jardin.openDialogs()).toBeLessThanOrEqual(1);
  const h = await jardin.hash();
  const open = await jardin.isPanelOpen();
  expect(open, `panel ${open ? 'open' : 'closed'} with hash ${h}`).toBe(h.startsWith('#/p/'));
});

test('flow 3 garden: back and forward through projects in different beds, URL, panel, camera in sync', async ({ page, jardin }) => {
  const [a, b] = projectsInDifferentBeds();
  if (a === undefined || b === undefined) throw new Error('need projects in two beds');
  await jardin.visit({ mode: 'garden' });
  const at = async (): Promise<{ bed: string | null; project: string | null; phase: string; x: number }> => {
    await jardin.settled();
    return jardin.withApi((api) => {
      const s = api.state();
      return { bed: s.bed, project: s.project, phase: s.phase, x: api.camera().x };
    });
  };
  await jardin.goto(`#/p/${a.id}`);
  const sa = await at();
  await jardin.goto(`#/p/${b.id}`);
  const sb = await at();
  expect(sb.bed).toBe(b.bed);
  expect(sb.x).not.toBeCloseTo(sa.x, 1);
  await page.goBack();
  expect(await at()).toMatchObject({ bed: a.bed, project: a.id });
  await jardin.expectOpen(a);
  await page.goForward();
  expect(await at()).toMatchObject({ bed: b.bed, project: b.id });
  await jardin.expectOpen(b);
  expect(await jardin.hash()).toBe(`#/p/${b.id}`);
});
