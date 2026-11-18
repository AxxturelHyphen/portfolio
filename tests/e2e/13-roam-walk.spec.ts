import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { checkBudget, recordFrames } from '../helpers/frames.ts';
import { expect, isLow, PROJECTS, test, type Jardin } from '../helpers/jardin.ts';

// Free roam entered with ?roam=1, which still works now that roam is the default (cook/ROAM_PLAN.md P1): keys walk,
// the pond and the walkable rectangle stop the visitor, a click or tap on the ground walks there, a flower still opens,
// and walking through two beds keeps the frame budget.

const garden = JSON.parse(readFileSync('content/garden.json', 'utf8')) as { ground: { pond: { x: number; z: number; rx: number; rz: number } } };
const pond = garden.ground.pond;
const AREA = { minX: -2.8, maxX: 46, minZ: -5.5, maxZ: 3 } as const;
const RADIUS = 0.3;
const first = PROJECTS.find((p) => p.bed === 'rosaleda');
if (first === undefined) throw new Error('content/projects.json has no Rosaleda project');

type At = { x: number; z: number };
const roamAt = (j: Jardin): Promise<At> => j.withApi((api) => api.roam() as At);
const inArea = (p: At): boolean => p.x >= AREA.minX && p.x <= AREA.maxX && p.z >= AREA.minZ && p.z <= AREA.maxZ;
const pondMetric = (p: At, grow = 0): number => Math.hypot((p.x - pond.x) / (pond.rx + grow), (p.z - pond.z) / (pond.rz + grow));

async function enter(j: Jardin, hash = '#/'): Promise<void> {
  await j.visit({ mode: 'garden', hash, query: { roam: '1' } });
  await j.withApi((api) => api.ready);
  await expect.poll(() => j.withApi((api) => api.state().phase), { timeout: 15000 }).toBe('bed');
  await j.settled();
}

/** The ground point (y 0) under a CSS pixel for the current camera pose (yaw 0, as the follow camera keeps it). */
async function groundUnder(page: Page, j: Jardin, sx: number, sy: number): Promise<At> {
  const pose = await j.withApi((api) => api.camera());
  const vp = page.viewportSize() ?? { width: 1, height: 1 };
  const t = Math.tan((pose.fov * Math.PI) / 360);
  const nx = (2 * sx) / vp.width - 1;
  const ny = 1 - (2 * sy) / vp.height;
  const wy = ny * t * Math.cos(pose.pitch) + Math.sin(pose.pitch);
  const wz = ny * t * Math.sin(pose.pitch) - Math.cos(pose.pitch);
  const k = -pose.y / wy;
  return { x: pose.x + k * nx * t * (vp.width / vp.height), z: pose.z + k * wz };
}

/** Samples the visitor every frame for `ms` while `keys` are held. */
async function holdAndTrack(page: Page, keys: string[], ms: number): Promise<At[]> {
  await page.evaluate((dur) => {
    const w = window as unknown as { __track: At[] };
    w.__track = [];
    const end = performance.now() + dur;
    const tick = (now: number): void => {
      const p = window.__jardin?.roam();
      if (p) w.__track.push(p);
      if (now < end + 300) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ms);
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
  await page.waitForTimeout(400);
  return page.evaluate(() => (window as unknown as { __track: At[] }).__track);
}

test('roam: holding ArrowRight from the gate walks along x inside the limits', async ({ page, jardin }) => {
  await enter(jardin);
  const start = await roamAt(jardin);
  const track = await holdAndTrack(page, ['ArrowRight'], 1500);
  const end = track.at(-1) as At;
  expect(end.x - start.x, 'walked east').toBeGreaterThan(3);
  expect(track.every(inArea), 'inside the walkable rectangle').toBe(true);
});

test('roam: walking into the pond stops at its edge', async ({ page, jardin }) => {
  await enter(jardin, '#/b/estanque');
  const track = await holdAndTrack(page, ['ArrowUp'], 1500);
  const end = track.at(-1) as At;
  expect(Math.min(...track.map((p) => pondMetric(p))), 'never in the water').toBeGreaterThan(1);
  expect(Math.min(...track.map((p) => pondMetric(p, RADIUS))), 'the body never overlaps the pond').toBeGreaterThan(0.999);
  expect(pondMetric(end, RADIUS), 'came to rest at the edge').toBeLessThan(1.05);
});

test('roam: a click or tap on the ground walks the visitor there', async ({ page, jardin, isMobile }) => {
  await enter(jardin, '#/b/rosaleda');
  const vp = page.viewportSize() ?? { width: 1, height: 1 };
  const candidates = [[0.7, 0.62], [0.3, 0.62], [0.7, 0.8], [0.3, 0.8], [0.5, 0.85]];
  let point: [number, number] | null = null;
  for (const [fx, fy] of candidates) {
    const x = Math.round((fx as number) * vp.width);
    const y = Math.round((fy as number) * vp.height);
    const onCanvas = await page.evaluate(([px, py]) => document.elementFromPoint(px as number, py as number)?.tagName === 'CANVAS', [x, y]);
    if (onCanvas) {
      point = [x, y];
      break;
    }
  }
  expect(point, 'an open patch of ground on screen').not.toBeNull();
  const [x, y] = point as [number, number];
  const target = await groundUnder(page, jardin, x, y);
  expect(inArea(target) && pondMetric(target, RADIUS) > 1, `target ${JSON.stringify(target)} is walkable`).toBe(true);
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect.poll(async () => {
    const p = await roamAt(jardin);
    return Math.hypot(p.x - target.x, p.z - target.z);
  }, { timeout: 8000, message: 'the visitor arrives' }).toBeLessThan(0.15);
});

test('roam: a flower still focuses and opens, Esc closes back onto the follow pose', async ({ page, jardin }) => {
  await enter(jardin, '#/b/rosaleda');
  const before = await jardin.withApi((api) => ({ pose: api.camera(), at: api.roam() }));
  const flower = page.locator(`#proxies [data-slot$="${first.id}"], #proxies [data-project="${first.id}"]`).first();
  await flower.click();
  if (!(await jardin.isPanelOpen())) {
    await expect.poll(() => jardin.withApi((api) => api.state().phase)).toBe('focus');
    await flower.click();
  }
  await jardin.expectOpen(first);
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  await jardin.settled();
  const after = await jardin.withApi((api) => api.roam());
  expect(after, 'the visitor did not move').toEqual(before.at);
  // Closing rests on the flower that opened the panel (phase 'focus'); one more Esc steps back to the bed, as in flow 1.
  await page.mouse.move(2, 2);
  if ((await jardin.withApi((api) => api.state().phase)) === 'focus') {
    await page.keyboard.press('Escape');
    await jardin.settled();
  }
  expect(await jardin.withApi((api) => api.state().phase)).toBe('bed');
  const drift = (): Promise<number> =>
    jardin.withApi((api, p0: Record<string, number>) => {
      const pose = api.camera() as unknown as Record<string, number>;
      return Math.max(...['x', 'y', 'z', 'pitch', 'fov'].map((k) => Math.abs((pose[k] as number) - (p0[k] as number))));
    }, before.pose as unknown as Record<string, number>);
  await expect.poll(drift, { timeout: 4000, message: 'camera back on the follow pose' }).toBeLessThan(0.0005);
});

test('transition budget roam: an 8 s walk through two beds', async ({ page, jardin, tierOpt }) => {
  await enter(jardin);
  const stats = await recordFrames(page, 'roam walk', async () => {
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(8000);
    await page.keyboard.up('ArrowRight');
  });
  const end = await roamAt(jardin);
  test.info().annotations.push({ type: 'frames', description: JSON.stringify(stats) });
  mkdirSync('test-results', { recursive: true });
  appendFileSync('test-results/roam-frames.txt', `${test.info().project.name} frames ${stats.frames} over25 ${stats.over25} over50 ${stats.over50} max ${stats.max.toFixed(1)} ms\n`);
  expect(end.x, 'walked through the Rosaleda into the Estanque').toBeGreaterThan(17);
  expect(await jardin.withApi((api) => api.state().bed)).toBe('estanque');
  expect(stats.frames, 'frames recorded').toBeGreaterThan(60);
  expect(checkBudget(stats, 'travel', isLow(tierOpt)), JSON.stringify(stats)).toBeNull();
});
