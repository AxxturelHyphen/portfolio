import { expect, test, type Jardin } from '../helpers/jardin.ts';
import { enterRoam, roamAt, untilStill } from '../helpers/roam.ts';

// The free roam orbit (cook/PLAN_3D.md F1): Q and E turn the camera about the visitor up to ±35°, it springs back to the
// rest angle once left alone, walk keys stay screen directions, ?orbit holds an angle, a right drag (mouse) or two
// fingers (touch) turn it too.

const MAX = (35 * Math.PI) / 180;
const yawOf = (j: Jardin): Promise<number> => j.withApi((api) => (api.camera() as unknown as { yaw: number }).yaw);

test('roam orbit: E and Q turn up to the arc, the yaw springs back to rest after release', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  expect(await yawOf(jardin), 'rests square on').toBe(0);
  await page.keyboard.down('KeyE');
  await expect.poll(() => yawOf(jardin), { message: 'E turns the view right' }).toBeGreaterThan(0.2);
  await page.waitForTimeout(900);
  expect(await yawOf(jardin), 'clamped to the arc').toBeCloseTo(MAX, 4);
  await page.keyboard.up('KeyE');
  await page.waitForTimeout(600);
  expect(await yawOf(jardin), 'held for a moment after release').toBeGreaterThan(MAX * 0.9);
  await expect.poll(() => yawOf(jardin), { timeout: 6000, message: 'springs back to rest' }).toBe(0);

  await page.keyboard.down('KeyQ');
  await expect.poll(() => yawOf(jardin), { message: 'Q turns the view left' }).toBeLessThan(-0.2);
  await page.keyboard.up('KeyQ');
  await expect.poll(() => yawOf(jardin), { timeout: 6000 }).toBe(0);
});

test('roam orbit: ?orbit holds the angle and up walks away from the orbited camera', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/rosaleda', { orbit: '25' });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  expect(await yawOf(jardin)).toBeCloseTo((25 * Math.PI) / 180, 5);
  await page.keyboard.press('KeyQ');
  const from = await roamAt(jardin);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(350);
  await page.keyboard.up('ArrowUp');
  await untilStill(page);
  const to = await roamAt(jardin);
  expect(to.x - from.x, 'up drifts toward +x under a positive yaw').toBeGreaterThan(0.1);
  expect(to.z - from.z, 'and away from the camera').toBeLessThan(-0.1);
  expect(await yawOf(jardin), 'the held angle ignores the keys').toBeCloseTo((25 * Math.PI) / 180, 5);
});

test('roam orbit: a right drag (mouse) or two fingers (touch) turn the camera; one finger still walks', async ({ page, jardin, isMobile }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  const vp = page.viewportSize() ?? { width: 1, height: 1 };
  const y = Math.round(vp.height * 0.7);
  const x = Math.round(vp.width / 2);
  const from = await roamAt(jardin);
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', dx: number) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: type === 'touchEnd' ? [] : [{ x: x - 60 + dx, y, id: 1 }, { x: x + 60 + dx, y, id: 2 }],
    });
    await touch('touchStart', 0);
    for (let i = 1; i <= 8; i++) await touch('touchMove', i * 15);
    expect(await yawOf(jardin), 'two fingers dragged right turn the view left').toBeLessThan(-0.05);
    await touch('touchEnd', 0);
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= 8; i++) await page.mouse.move(x + i * 15, y);
    expect(await yawOf(jardin), 'a right drag to the right turns the view left').toBeLessThan(-0.05);
    await page.mouse.up({ button: 'right' });
  }
  await untilStill(page);
  const to = await roamAt(jardin);
  expect(Math.hypot(to.x - from.x, to.z - from.z), 'orbiting never walks').toBeLessThan(0.6);
  await expect.poll(() => yawOf(jardin), { timeout: 6000, message: 'springs back to rest' }).toBe(0);
});
