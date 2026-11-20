import type { Page } from '@playwright/test';
import { expect, test, type Jardin } from '../helpers/jardin.ts';
import { enterRoam, roamAt, untilStill } from '../helpers/roam.ts';

// The archive boss of the Estanque (src/world/boss.ts): the peacock plays once per visit when the visitor settles in
// its bed, with a camera moment; a key lands the end pose; walking out and back in does not replay it; reduced motion
// shows the end pose with no camera moment. Console errors fail every test (helpers/jardin.ts).

const phase = (j: Jardin): Promise<string> => j.withApi((api) => api.boss());
const cameraY = (j: Jardin): Promise<number> => j.withApi((api) => api.camera().y);

/** Records the boss phase on every frame from now on. */
async function recordPhases(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const w = window as unknown as { __boss: string[] };
    w.__boss = [];
    const tick = (): void => {
      const p = window.__jardin?.boss();
      if (p !== undefined && w.__boss.at(-1) !== p) w.__boss.push(p);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () => page.evaluate(() => (window as unknown as { __boss: string[] }).__boss);
}

test('roam boss: the peacock plays once with a camera moment, a key skips it, re-entering does not replay', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/estanque');
  const rest = await cameraY(jardin);
  const start = await roamAt(jardin);
  await expect.poll(() => phase(jardin), { timeout: 5000, message: 'the show starts once the visitor settles' }).toBe('play');
  await expect.poll(() => cameraY(jardin), { message: 'the camera eases back and up' }).toBeGreaterThan(rest + 0.3);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Shift');
  await expect.poll(() => phase(jardin), { timeout: 1000, message: 'a key lands the end pose' }).toBe('idle');
  // The key also eases the follow camera from near framing to walking framing (about 0.3 m higher): the moment's 1.1 m is gone.
  await expect.poll(async () => (await cameraY(jardin)) - rest, { timeout: 3000, message: 'the camera returns' }).toBeLessThan(0.45);

  const phases = await recordPhases(page);
  await jardin.withApi((api, x: number) => api.walkTo(x, 1), start.x - 9);
  await expect.poll(() => jardin.withApi((api) => api.state().bed), { timeout: 15000 }).toBe('rosaleda');
  await jardin.withApi((api, at: { x: number; z: number }) => api.walkTo(at.x, at.z), start);
  await expect.poll(() => jardin.withApi((api) => api.state().bed), { timeout: 15000 }).toBe('estanque');
  await untilStill(page);
  await page.waitForTimeout(1500);
  expect(await phases(), 'no second show in the same visit').not.toContain('play');
  expect(await phase(jardin)).toBe('idle');
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('roam boss reduced: the end pose at once, no show and no camera moment', async ({ page, jardin }) => {
    await enterRoam(jardin, '#/b/estanque');
    const rest = await cameraY(jardin);
    const phases = await recordPhases(page);
    await expect.poll(() => phase(jardin), { timeout: 5000 }).toBe('idle');
    await page.waitForTimeout(1500);
    expect(await phases()).not.toContain('play');
    expect(Math.abs((await cameraY(jardin)) - rest), 'no camera moment').toBeLessThan(0.01);
  });
});
