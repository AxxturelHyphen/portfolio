import { checkBudget, recordFrames } from '../helpers/frames.ts';
import { expect, isLow, openTarget, PROJECTS, test } from '../helpers/jardin.ts';

// Flow 1 (spec 11): open and close a project 20 times fast, including Esc mid-transition: one panel at most,
// back where we started, no console errors (the guard fixture asserts that last part at the end of every test).

const first = PROJECTS[0];
if (first === undefined) throw new Error('content/projects.json has no project');

test('flow 1 herbario: open and close 20 times fast, Esc mid-transition', async ({ page, jardin }) => {
  await jardin.visit();
  const ids = PROJECTS.map((p) => p.id);
  for (let i = 0; i < 20; i++) {
    const id = ids[i % ids.length] as string;
    await jardin.open(id);
    // Esc after 0, 16, 32 .. ms so it lands before, during and after the panel transition.
    await page.waitForTimeout((i % 6) * 16);
    await page.keyboard.press('Escape');
    expect(await jardin.openDialogs(), `dialogs open after round ${i}`).toBeLessThanOrEqual(1);
  }
  await jardin.expectClosed();
  expect(await jardin.hash()).not.toMatch(/^#\/p\//);
});

test('flow 1 herbario: closing returns to the scroll position the visitor left', async ({ page, jardin }) => {
  await jardin.visit();
  await page.locator(openTarget(first.id)).scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await jardin.open(first.id);
  await jardin.expectOpen(first);
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  expect(Math.abs((await page.evaluate(() => scrollY)) - before), 'scroll position restored').toBeLessThanOrEqual(2);
});

test('flow 1 herbario: double open is idempotent, double Esc closes once', async ({ page, jardin }) => {
  await jardin.visit();
  await jardin.open(first.id);
  await jardin.open(first.id, 800).catch(() => undefined); // a modal may cover the target: both outcomes are fine
  expect(await jardin.openDialogs()).toBeLessThanOrEqual(1);
  await jardin.expectOpen(first);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  expect(await jardin.openDialogs()).toBe(0);
});

test('transition budget herbario: panel open and close', async ({ page, jardin, tierOpt }) => {
  await jardin.visit();
  // Warm up: first open pays one-off style and decode costs that the garden hides behind the iris.
  await jardin.open(first.id);
  await jardin.expectOpen(first);
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  const stats = await recordFrames(page, 'panel open and close', async () => {
    await jardin.open(first.id);
    await jardin.expectOpen(first);
    await page.keyboard.press('Escape');
    await jardin.expectClosed();
  });
  test.info().annotations.push({ type: 'frames', description: JSON.stringify(stats) });
  expect(stats.frames, 'frames recorded').toBeGreaterThan(5);
  expect(checkBudget(stats, 'panel', isLow(tierOpt)), JSON.stringify(stats)).toBeNull();
});

test.fixme('flow 1 garden: open and close 20 times fast, Esc mid-iris, camera back at its pose', async ({ page, jardin }) => {
  await jardin.visit({ mode: 'garden', hash: '#/b/rosaleda' });
  await jardin.goto('#/b/rosaleda', true);
  const pose0 = await jardin.withApi((api) => api.camera());
  const id = first.id;
  for (let i = 0; i < 20; i++) {
    await page.locator(`#proxies [data-slot$="${id}"], #proxies [data-project="${id}"]`).first().click();
    await page.waitForTimeout((i % 7) * 40); // 0 to 240 ms: before, inside and after the iris
    await page.keyboard.press('Escape');
    expect(await jardin.openDialogs()).toBeLessThanOrEqual(1);
  }
  await jardin.settled();
  const end = await jardin.withApi((api) => ({ pose: api.camera(), state: api.state() }));
  expect(end.state.phase).toBe('bed');
  expect(end.state.project).toBeNull();
  for (const k of ['x', 'y', 'z', 'pitch', 'fov'] as const) expect(end.pose[k]).toBeCloseTo(pose0[k], 3);
  expect(await jardin.openDialogs()).toBe(0);
});

test.fixme('transition budget garden: panel open and close (camera and iris)', async ({ page, jardin, tierOpt }) => {
  await jardin.visit({ mode: 'garden', hash: '#/b/rosaleda' });
  await jardin.goto('#/b/rosaleda', true);
  const stats = await recordFrames(page, 'panel open and close', async () => {
    await jardin.goto(`#/p/${first.id}`);
    await page.keyboard.press('Escape');
    await jardin.settled();
  });
  expect(checkBudget(stats, 'panel', isLow(tierOpt)), JSON.stringify(stats)).toBeNull();
});
