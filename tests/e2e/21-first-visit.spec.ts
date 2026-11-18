import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, PROJECTS, test, type Jardin } from '../helpers/jardin.ts';
import { enterRoam, roamAt } from '../helpers/roam.ts';

// The first visit (ui/welcome.ts, ui/plan.ts): once the cold start settles a plate names the owner, says where and what
// they do (gap-free sentences only) and how to move for the input at hand, clear of the visitor, the signposts, the top
// tags and the plan corner; the hint goes after a few steps; the plate comes up once per session and never in a still.
// The plan lists every project, and a project walks the visitor to its flower and hands it keyboard focus.

type Box = { x: number; y: number; width: number; height: number };

const profile = JSON.parse(readFileSync('content/profile.json', 'utf8')) as { name: string; headline: Record<'en' | 'es', string> };
const LINE = {
  en: 'Studying ML math, heading toward AI engineering. Music producer.',
  es: 'Estudiando matemáticas de ML, en camino hacia la ingeniería de IA. Productor musical.',
} as const;
/** Half the figure's width and its height with the hat and the raised lantern (m), a little generous. */
const FIGURE_HALF_W = 0.5;
const FIGURE_H = 1.5;

const meets = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const isPhone = (name: string): boolean => name.startsWith('mobile');

/** The visitor's screen box: its feet and hat projected through the follow camera (yaw 0). */
async function figureBox(page: Page, j: Jardin): Promise<Box> {
  const pose = await j.withApi((api) => api.camera());
  const at = await roamAt(j);
  const vp = page.viewportSize() ?? { width: 1, height: 1 };
  const t = Math.tan((pose.fov * Math.PI) / 360);
  const aspect = vp.width / vp.height;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const dx of [-FIGURE_HALF_W, FIGURE_HALF_W]) {
    for (const y of [0, FIGURE_H]) {
      const ry = y - pose.y;
      const rz = at.z - pose.z;
      const f = ry * Math.sin(pose.pitch) - rz * Math.cos(pose.pitch);
      const u = ry * Math.cos(pose.pitch) + rz * Math.sin(pose.pitch);
      xs.push(((at.x + dx - pose.x) / (f * t * aspect) + 1) * 0.5 * vp.width);
      ys.push((1 - u / (f * t)) * 0.5 * vp.height);
    }
  }
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

async function boxesOf(page: Page, selector: string): Promise<Box[]> {
  const out: Box[] = [];
  for (const n of await page.locator(selector).all()) {
    const b = (await n.isVisible()) ? await n.boundingBox() : null;
    if (b !== null) out.push(b);
  }
  return out;
}

/** The shown plate (card and hint) meets none of: the visitor, a signpost, a top tag, the plan corner. */
async function expectClear(page: Page, j: Jardin): Promise<void> {
  const plate = await boxesOf(page, '.wl-card, .wl-hint:not([hidden])');
  expect(plate.length, 'card and hint are on screen').toBe(2);
  const others: Array<[string, Box]> = [['visitor', await figureBox(page, j)]];
  for (const [what, sel] of [['signpost', '#proxies .px-sign'], ['top tag', '#toggles :is(.tg-plate, .tg-cv, .tg-exit)'], ['plan corner', '#proxies .pl-tag']] as const) {
    for (const b of await boxesOf(page, sel)) others.push([what, b]);
  }
  for (const p of plate) for (const [what, b] of others) expect(meets(p, b), `the plate covers the ${what} (${JSON.stringify(p)} over ${JSON.stringify(b)})`).toBe(false);
}

async function expectPlate(page: Page): Promise<void> {
  await expect(page.locator('.wl'), 'the plate comes up once the cold start settles').toHaveAttribute('data-state', 'shown', { timeout: 15000 });
}

test('first visit: the plate names the owner, place and gap-free line, and how to move, clear of everything it must not cover', async ({ page, jardin }, info) => {
  await enterRoam(jardin);
  await expectPlate(page);
  await expect(page.locator('.wl-name')).toHaveText(profile.name);
  await expect(page.locator('.wl-place')).toHaveText('Vigo, Spain');
  await expect(page.locator('.wl-line')).toHaveText(LINE.en);
  await expect(page.locator('.wl')).not.toContainText('[FILL');
  await expect(page.locator('.wl-hint')).toContainText(isPhone(info.project.name) ? 'Tap the ground' : 'arrow keys');
  await expect(page.locator('.wl-hint')).toContainText('Projects, bottom left');
  const before = await page.evaluate(() => {
    const plate = document.querySelector('.wl');
    const proxies = document.getElementById('proxies');
    return plate !== null && proxies !== null && (plate.compareDocumentPosition(proxies) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
  expect(before, 'the plate is text before the garden controls in the DOM order').toBe(true);
  await expectClear(page, jardin);
  if (isPhone(info.project.name)) {
    await page.setViewportSize({ width: 360, height: 800 });
    await jardin.settled();
    await expectClear(page, jardin);
  }
});

test('first visit: the hint goes after a few steps, the card folds into the plan, and a reload in the session keeps it folded', async ({ page, jardin }) => {
  await enterRoam(jardin);
  await expectPlate(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowDown');
  await expect(page.locator('.wl-hint'), 'the hint goes once the visitor walked a little').toBeHidden({ timeout: 3000 });
  await page.locator('#proxies .pl-tag').click();
  await expect(page.locator('.wl'), 'opening the plan folds the card').toHaveAttribute('data-state', 'folded');
  await expect(page.locator('#proxies .pl-name'), 'the name stays in the plan').toHaveText(profile.name);
  await expect(page.locator('.wl-name'), 'and as text for screen readers').toHaveText(profile.name);
  await page.reload();
  await jardin.withApi((api) => api.ready);
  await expect.poll(() => jardin.withApi((api) => api.state().phase), { timeout: 15000 }).toBe('bed');
  await jardin.settled();
  await page.waitForTimeout(300);
  await expect(page.locator('.wl'), 'once per session').toHaveAttribute('data-state', 'folded');
  await expect(page.locator('.wl-hint')).toBeHidden();
});

test('first visit: never in a still (?t, ?shot)', async ({ page, jardin }, info) => {
  test.skip(info.project.name !== 'desktop', 'one profile is enough: the switch is a URL rule');
  for (const query of [{ t: '6' }, { shot: 'S13' }]) {
    await jardin.visit({ mode: 'garden', query });
    await jardin.withApi((api) => api.ready);
    await jardin.settled();
    await expect(page.locator('.wl'), JSON.stringify(query)).toHaveCount(0);
  }
});

test('first visit: the rail (?roam=0) shows no name at the gate, so the plate comes up over its overview', async ({ page, jardin }, info) => {
  test.skip(info.project.name.endsWith('-low'), 'the rail is covered on the two main profiles');
  await jardin.visit({ mode: 'garden', rail: true });
  await jardin.withApi((api) => api.ready);
  await expectPlate(page);
  await expect(page.locator('.wl-hint')).toContainText(isPhone(info.project.name) ? 'Swipe along the garden' : 'click a bed');
});

test('first visit in Spanish: the line, the hint, the plan and the way-out tag', async ({ page, jardin }, info) => {
  await jardin.visit({ mode: 'garden', lang: 'es' });
  await jardin.withApi((api) => api.ready);
  await expectPlate(page);
  await expect(page.locator('.wl-place')).toHaveText('Vigo, España');
  await expect(page.locator('.wl-line')).toHaveText(LINE.es);
  await expect(page.locator('.wl-hint')).toContainText(isPhone(info.project.name) ? 'Toca el suelo' : 'flechas');
  await expect(page.locator('#proxies .pl-tag')).toHaveText('Proyectos');
  await expect(page.locator('#toggles .tg-exit')).toHaveText('Álbum');
});

test('the way-out tag says where it leads: "Album", named "Exit to the CV album"', async ({ page, jardin }) => {
  await enterRoam(jardin);
  const exit = page.getByRole('button', { name: 'Exit to the CV album' });
  await expect(exit).toHaveText('Album');
  await expect(exit).toHaveAttribute('data-mode', 'herbario');
});

test('the plan is the index of the work: every project, a real button of thumb size that walks to its flower', async ({ page, jardin }, info) => {
  await enterRoam(jardin);
  const tag = page.locator('#proxies .pl-tag');
  await expect(tag).toHaveText('Projects');
  await expect(tag).toHaveAttribute('aria-label', 'Projects and plan of the garden');
  await tag.click();
  const list = page.getByRole('list', { name: 'Projects' });
  for (const p of PROJECTS) {
    const btn = list.getByRole('button', { name: p.title, exact: true });
    await expect(btn).toBeVisible();
    await expect.poll(async () => {
      const b = await btn.boundingBox();
      return Math.min(b?.width ?? 0, b?.height ?? 0);
    }, { message: `${p.title} is a 44 px target once the sheet has unfolded` }).toBeGreaterThanOrEqual(44);
  }
  const far = PROJECTS.find((p) => p.bed === 'semillero') ?? PROJECTS[PROJECTS.length - 1]!;
  const btn = list.getByRole('button', { name: far.title, exact: true });
  if (isPhone(info.project.name)) {
    await btn.tap();
    await expect.poll(() => jardin.withApi((api) => api.state().phase === 'focus' && api.state().bed), { timeout: 20000 }).toBe(far.bed);
    return;
  }
  await btn.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(`#proxies .px-slot[data-project="${far.id}"]`), 'keyboard focus lands on the flower').toBeFocused({ timeout: 20000 });
  await expect.poll(() => jardin.withApi((api) => api.state().bed)).toBe(far.bed);
  await jardin.settled();
  await page.keyboard.press('Enter');
  await jardin.expectOpen(far);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('first visit under reduced motion: shown and removed without animation', async ({ page, jardin }, info) => {
    test.skip(info.project.name.endsWith('-low'), 'covered on the two main profiles');
    await enterRoam(jardin);
    await expectPlate(page);
    const moving = await page.evaluate(() => [...document.querySelectorAll('.wl-card, .wl-hint')].map((n) => getComputedStyle(n).transitionProperty));
    expect(moving, 'no transition on the plate').toEqual(['none', 'none']);
    await jardin.withApi((api) => {
      const p = api.roam();
      if (p !== null) api.walkTo(p.x + 2, p.z);
    });
    await expect(page.locator('.wl-hint')).toBeHidden({ timeout: 3000 });
  });
});
