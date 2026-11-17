import { checkBudget, recordFrames } from '../helpers/frames.ts';
import { expect, isLow, projectsInDifferentBeds, SEL, test } from '../helpers/jardin.ts';

// Flow 5: Garden -> Herbario -> garden with a project open: the project stays open, the position is restored.

test('flow 5 herbario: the toggle offers the garden while a project is open', async ({ page, jardin }) => {
  const p = projectsInDifferentBeds()[0];
  if (p === undefined) return;
  await jardin.visit({ hash: `#/p/${p.id}` });
  await jardin.expectOpen(p);
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  await expect(page.locator(SEL.gardenToggle).first(), 'Enter the garden stays offered').toBeVisible();
});

test('flow 5 garden: garden to herbario to garden with a project open keeps project and position', async ({ page, jardin, tierOpt }) => {
  const p = projectsInDifferentBeds()[1] ?? projectsInDifferentBeds()[0];
  if (p === undefined) return;
  await jardin.visit({ mode: 'garden', hash: `#/p/${p.id}` });
  await jardin.settled();
  await jardin.expectOpen(p);
  const before = await jardin.withApi((api) => ({ pose: api.camera(), state: api.state() }));

  const toHerbario = await recordFrames(page, 'garden to herbario', async () => {
    await jardin.withApi((api) => api.send({ type: 'SET_MODE', mode: 'herbario' }));
    await jardin.settled();
  });
  expect(checkBudget(toHerbario, 'switch', isLow(tierOpt)), JSON.stringify(toHerbario)).toBeNull();
  expect(await jardin.mode()).toBe('herbario');
  await jardin.expectOpen(p);

  const toGarden = await recordFrames(page, 'herbario to garden', async () => {
    await jardin.withApi((api) => api.send({ type: 'SET_MODE', mode: 'garden' }));
    await jardin.settled();
  });
  expect(checkBudget(toGarden, 'switch', isLow(tierOpt)), JSON.stringify(toGarden)).toBeNull();
  expect(await jardin.mode()).toBe('garden');
  await jardin.expectOpen(p);
  const after = await jardin.withApi((api) => ({ pose: api.camera(), state: api.state() }));
  expect(after.state.project).toBe(before.state.project);
  for (const k of ['x', 'y', 'z', 'pitch', 'fov'] as const) expect(after.pose[k]).toBeCloseTo(before.pose[k], 3);
});
