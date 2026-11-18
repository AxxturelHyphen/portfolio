import { expect, test } from '../helpers/jardin.ts';
import { clearOfProps, enterRoam, groundUnder, openGround, projectOfSlot, roamAt } from '../helpers/roam.ts';

// Free roam by touch (cook/ROAM_PLAN.md P4, mobile profiles): a tap on a flower focuses it, a second tap opens it, Esc
// closes it, and a tap on the ground walks the visitor there.

test('roam tap: tap a flower focuses, a second tap opens; a tap on the ground walks there', async ({ page, jardin, isMobile }) => {
  test.skip(!isMobile, 'touch profiles only');
  await enterRoam(jardin, '#/b/rosaleda');
  const flower = page.locator('#proxies .px-project:not([data-off])').last();
  const slot = (await flower.getAttribute('data-slot')) ?? '';
  const project = await projectOfSlot(page, slot);
  await flower.tap();
  await expect.poll(() => jardin.withApi((api) => api.state().slot), { message: 'the first tap focuses' }).toBe(slot);
  expect(await jardin.isPanelOpen()).toBe(false);
  await flower.tap();
  await jardin.expectOpen(project);
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  await jardin.settled();

  const from = await roamAt(jardin);
  const [x, y] = await openGround(page, async (sx, sy) => clearOfProps(from, await groundUnder(page, jardin, sx, sy)));
  const target = await groundUnder(page, jardin, x, y);
  await page.touchscreen.tap(x, y);
  await expect.poll(async () => {
    const p = await roamAt(jardin);
    return Math.hypot(p.x - target.x, p.z - target.z);
  }, { timeout: 8000, message: 'the visitor arrives where the ground was tapped' }).toBeLessThan(0.15);
});
