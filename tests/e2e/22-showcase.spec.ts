import type { Page } from '@playwright/test';
import { expect, test, type Jardin } from '../helpers/jardin.ts';
import { enterRoam, focusIn, projectOfSlot, untilStill } from '../helpers/roam.ts';

// The project film and the flower (src/ui/reel.ts, src/world/flower.ts): entering a project from its flower unfurls
// that flower in the garden and folds it again on close; the panel shows a strip of frames (an archive plate for
// every owner gap) with the project's flower lit behind it. The strip moves on by key, click, tap and swipe, rests while
// pointed at, and holds still under reduced motion and frozen time.

const film = (page: Page) => page.locator('#panel .rl');
const at = (page: Page): Promise<string | null> => film(page).getAttribute('data-at');
const unfurl = (j: Jardin): Promise<number> => j.withApi((api) => api.unfurl());

async function expectFilm(page: Page): Promise<void> {
  await expect(film(page)).toBeVisible();
  expect(await page.locator('#panel .rl-frame').count()).toBeGreaterThanOrEqual(2);
  const plate = page.locator('#panel .rl-frame').first().locator('.rl-plate');
  await expect(plate.locator('img.rl-media'), 'a gap shows an archive plate under its real title').toHaveAttribute('alt', /\S/);
  await expect(plate.locator('.rl-cap'), 'the plate is named on its frame').toBeVisible();
  await expect.poll(() => plate.locator('img.rl-media').evaluate((n) => (n as HTMLImageElement).naturalWidth), { message: 'the plate loads with the film' }).toBeGreaterThan(0);
  expect(await page.locator('#panel .rl-frame > img, #panel .rl video, #panel .rl-blank').count(), 'no project picture invented for a gap').toBe(0);
  await expect.poll(() => page.locator('#panel .rl-bloom').evaluate((n) => (n as HTMLImageElement).naturalWidth), { message: 'the flower cutout loads with the panel' }).toBeGreaterThan(0);
  const box = await film(page).boundingBox();
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  expect(box !== null && box.x >= 0 && box.x + box.width <= width + 0.5, 'the film fits the page width').toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no horizontal scroll').toBe(true);
  for (const b of await page.locator('#panel .rl-btn').all()) {
    const r = await b.boundingBox();
    expect(r !== null && r.width >= 44 && r.height >= 44, 'controls are 44 px targets').toBe(true);
  }
}

test('showcase: a click on a flower opens the film, the flower unfurls and folds again on close', async ({ page, jardin, isMobile }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  const flower = page.locator('#proxies .px-project:not([data-off])').last();
  const project = await projectOfSlot(page, (await flower.getAttribute('data-slot')) ?? '');
  expect(await unfurl(jardin), 'shut before entering').toBe(0);
  if (isMobile) await flower.tap();
  await (isMobile ? flower.tap() : flower.click());
  await jardin.expectOpen(project);
  await expect.poll(() => unfurl(jardin), { message: 'the flower unfurls' }).toBe(1);
  await expectFilm(page);

  await page.locator('#panel .rl-next').click();
  await expect.poll(() => at(page), { message: 'Next pulls the strip on' }).toBe('1');
  await expect(page.locator('#panel .rl [role="status"]')).toContainText('2 of');
  await page.locator('#panel .rl-prev').click();
  await expect.poll(() => at(page)).toBe('0');
  await (isMobile ? page.locator('#panel .rl-gate').tap() : page.locator('#panel .rl-gate').click());
  await expect.poll(() => at(page), { message: 'a click or tap on the picture moves on' }).toBe('1');
  const gate = await page.locator('#panel .rl-gate').boundingBox();
  if (gate !== null) {
    const y = gate.y + gate.height / 2;
    await page.locator('#panel .rl-gate').dispatchEvent('pointerdown', { clientX: gate.x + gate.width * 0.3, clientY: y, pointerType: 'touch', isPrimary: true });
    await page.locator('#panel .rl-gate').dispatchEvent('pointerup', { clientX: gate.x + gate.width * 0.8, clientY: y, pointerType: 'touch', isPrimary: true });
  }
  await expect.poll(() => at(page), { message: 'a swipe right goes back' }).toBe('0');

  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  await expect.poll(() => unfurl(jardin), { message: 'the flower folds again' }).toBe(0);
});

test('showcase: Enter on a flower in reach opens it; the arrow keys pull the strip; pointing at it holds it', async ({ page, jardin, isMobile }) => {
  test.skip(isMobile, 'keyboard and hover: desktop profiles');
  await enterRoam(jardin);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down('ArrowRight');
  const slot = await focusIn(page, 'rosaleda');
  await page.keyboard.up('ArrowRight');
  await untilStill(page);
  const project = await projectOfSlot(page, slot);
  await page.keyboard.press('Enter');
  await jardin.expectOpen(project);
  await expect.poll(() => unfurl(jardin)).toBe(1);
  await expectFilm(page);

  await page.locator('#panel .rl-gate').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => at(page)).toBe('1');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => at(page)).toBe('0');

  await page.locator('#panel .rl-gate').hover();
  await page.waitForTimeout(7500);
  expect(await at(page), 'held while pointed at and focused').toBe('0');
  await page.locator('#panel .c-title').focus();
  await page.mouse.move(4, 4);
  await expect.poll(() => at(page), { timeout: 9000, message: 'it moves on by itself once left alone' }).toBe('1');
  await page.locator('#panel .rl-stop').click();
  await expect(page.locator('#panel .rl-stop')).toHaveAccessibleName('Run the film');
});

test('showcase: reduced motion opens the flower at once and changes frames without a slide or a stop button', async ({ page, jardin }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterRoam(jardin, '#/b/semillero');
  await jardin.goto('#/p/ml-math');
  expect(await unfurl(jardin)).toBe(1);
  await expectFilm(page);
  await expect(page.locator('#panel .rl-stop')).toHaveCount(0);
  await page.locator('#panel .rl-next').click();
  expect(await at(page)).toBe('1');
  expect(await page.locator('#panel .rl-strip').evaluate((n) => n.getAnimations().length), 'no slide').toBe(0);
  expect(await page.locator('#panel .rl-flower').evaluate((n) => getComputedStyle(n).animationName), 'the flower is still').toBe('none');
});

test('showcase: frozen time holds the first frame and the open flower', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/rosaleda', { t: '4' });
  await jardin.goto('#/p/garagic');
  expect(await unfurl(jardin)).toBe(1);
  await expect(film(page)).toHaveAttribute('data-still', '');
  await expect(page.locator('#panel .rl-stop')).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(await at(page)).toBe('0');
  expect(await page.locator('#panel .rl-light').first().evaluate((n) => getComputedStyle(n).animationName)).toBe('none');
});

test('showcase: the rail panel carries the film too', async ({ page, jardin }) => {
  await jardin.visit({ mode: 'garden', rail: true, hash: '#/b/rosaleda' });
  await jardin.withApi((api) => api.ready);
  await jardin.goto('#/p/garagic');
  await expectFilm(page);
  expect(await unfurl(jardin)).toBe(1);
});
