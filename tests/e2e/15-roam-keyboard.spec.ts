import { expect, test } from '../helpers/jardin.ts';
import { enterRoam, focusIn, poseDrift, projectOfSlot, roamAt, untilCameraStill, untilStill } from '../helpers/roam.ts';

// Free roam by keyboard (cook/ROAM_PLAN.md P4): arrows walk from the gate to the Rosaleda, walking up to a rose focuses
// it (plant tag, live region, DOM focus untouched), Enter opens it, Esc closes onto the same visitor and follow pose.

test('roam keyboard: walk up to a rose, its tag shows, Enter opens, Esc closes where the visitor stood', async ({ page, jardin }) => {
  await enterRoam(jardin);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down('ArrowRight');
  const slot = await focusIn(page, 'rosaleda');
  await page.keyboard.up('ArrowRight');
  await untilStill(page);
  expect(await jardin.withApi((api) => api.state().slot), 'still focused once stopped').toBe(slot);
  const project = await projectOfSlot(page, slot);
  await expect(page.locator('#label[data-shown]'), 'the plant tag shows').toBeAttached();
  await expect(page.locator('#label-card')).toContainText(project.title);
  const name = await page.locator(`#proxies [data-slot="${slot}"]`).textContent();
  await expect(page.locator('#proxies .px-live'), 'the live region says the flower once').toHaveText(name ?? '');
  expect(await page.evaluate(() => document.activeElement === document.body), 'DOM focus not moved').toBe(true);

  await untilCameraStill(page);
  const before = await jardin.withApi((api) => ({ pose: api.camera(), at: api.roam() }));
  await page.keyboard.press('Enter');
  await jardin.expectOpen(project);
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  await jardin.settled();
  expect(await roamAt(jardin), 'the visitor did not move').toEqual(before.at);
  expect(await jardin.withApi((api) => api.state().slot), 'closing rests on the flower').toBe(slot);
  await expect.poll(() => poseDrift(jardin, before.pose as unknown as Record<string, number>), { timeout: 4000, message: 'back on the follow pose' }).toBeLessThan(0.0005);
});

test('roam keyboard: Esc on a flower in reach blurs it until the visitor walks on; Tab reaches and focuses every slot', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down('ArrowLeft');
  await focusIn(page, 'rosaleda');
  await page.keyboard.up('ArrowLeft');
  await untilStill(page);
  await page.keyboard.press('Escape');
  await expect.poll(() => jardin.withApi((api) => api.state().phase)).toBe('bed');
  await page.waitForTimeout(400);
  expect(await jardin.withApi((api) => api.state().phase), 'proximity waits for the visitor to walk on').toBe('bed');

  const slots = await page.locator('#proxies .px-slot').evaluateAll((ns) => ns.map((n) => (n as HTMLElement).dataset.slot ?? ''));
  const order: string[] = [];
  for (let i = 0; i < 40 && !order.includes('sign'); i++) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => {
      const n = document.activeElement as HTMLElement | null;
      return n?.dataset.slot ?? (n?.closest('.px-sign') ? 'sign' : 'other');
    });
    if (id !== 'other') order.push(id);
    if (id === 'sign' || id === 'other') continue;
    // In reach and on screen it is focused at once; otherwise the visitor walks to it and it is focused on arrival.
    await expect.poll(() => jardin.withApi((api) => api.state().slot), { timeout: 10000, message: `${id} reached by Tab is focused` }).toBe(id);
  }
  expect(order, 'Tab reaches every slot of the bed in slot order, then the signposts').toEqual([...slots, 'sign']);
});
