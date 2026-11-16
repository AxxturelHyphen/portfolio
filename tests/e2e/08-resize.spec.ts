import { expect, PROJECTS, test } from '../helpers/jardin.ts';

// Flow 8: resize and rotate during a transition: no broken layout, no stuck state.

const SIZES = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
];

test('flow 8 herbario: resize and rotate while the panel opens', async ({ page, jardin }) => {
  const p = PROJECTS[0];
  if (p === undefined) return;
  const home = page.viewportSize();
  await jardin.visit();
  await jardin.open(p.id);
  for (const s of SIZES) {
    await page.setViewportSize(s);
    await page.waitForTimeout(30);
    expect(await jardin.openDialogs()).toBeLessThanOrEqual(1);
  }
  await jardin.expectOpen(p);
  const fit = await page.evaluate(() => {
    const d = document.getElementById('panel')?.getBoundingClientRect();
    return { overflowX: document.documentElement.scrollWidth - innerWidth, right: d?.right ?? 0, left: d?.left ?? 0, w: innerWidth };
  });
  expect(fit.overflowX, 'no horizontal page overflow').toBeLessThanOrEqual(1);
  expect(fit.right, 'panel inside the viewport').toBeLessThanOrEqual(fit.w + 1);
  expect(fit.left, 'panel inside the viewport').toBeGreaterThanOrEqual(-1);
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  if (home) await page.setViewportSize(home);
});

test('flow 8 herbario: resize while the panel closes leaves nothing stuck', async ({ page, jardin }) => {
  const p = PROJECTS[0];
  if (p === undefined) return;
  const home = page.viewportSize();
  await jardin.visit();
  await jardin.open(p.id);
  await jardin.expectOpen(p);
  await page.keyboard.press('Escape');
  for (const s of SIZES) {
    await page.setViewportSize(s);
    await page.waitForTimeout(20);
  }
  await jardin.expectClosed();
  const stuck = await page.evaluate(() => ({
    inert: document.querySelectorAll('#herbario[inert], body[inert], main[inert]').length,
    locked: getComputedStyle(document.body).overflow === 'hidden',
  }));
  expect(stuck.inert, 'nothing left inert').toBe(0);
  expect(stuck.locked, 'page scroll not locked').toBe(false);
  await jardin.open(p.id);
  await jardin.expectOpen(p);
  if (home) await page.setViewportSize(home);
});

test.fixme('flow 8 garden: resize and rotate during travel and during the iris', async ({ page, jardin }) => {
  const p = PROJECTS[0];
  if (p === undefined) return;
  await jardin.visit({ mode: 'garden' });
  await jardin.goto('#/', true);
  const run = async (kick: () => Promise<unknown>): Promise<void> => {
    await kick();
    for (const s of SIZES) {
      await page.setViewportSize(s);
      await page.waitForTimeout(40);
    }
    await jardin.settled();
    const view = await page.evaluate(() => {
      const c = document.getElementById('garden') as HTMLCanvasElement;
      return { overflowX: document.documentElement.scrollWidth - innerWidth, cw: c.clientWidth, w: innerWidth };
    });
    expect(view.overflowX).toBeLessThanOrEqual(1);
    expect(view.cw, 'canvas follows the viewport').toBe(view.w);
    expect(await jardin.openDialogs()).toBeLessThanOrEqual(1);
  };
  await run(() => jardin.withApi((api) => void api.goto('#/b/rosaleda')));
  await run(() => jardin.withApi((api, id: string) => void api.goto(`#/p/${id}`), p.id));
  await run(() => page.keyboard.press('Escape'));
  const s = await jardin.withApi((api) => api.state());
  expect(['bed', 'overview']).toContain(s.phase);
});
