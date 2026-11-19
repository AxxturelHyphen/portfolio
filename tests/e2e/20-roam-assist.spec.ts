import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/jardin.ts';
import { enterRoam, roamAt, untilStill } from '../helpers/roam.ts';
import semillero from '../../content/beds/semillero.json' with { type: 'json' };

// Assisted walking in free roam (cook/ROAM_PLAN.md P6): a signpost walks the visitor along the path to the next bed's
// stand point at up to about 6 m/s and the arrival is said once; any steering cancels a walk at once; frozen time lands
// it in the first frame; Tab walks the visitor to a flower out of reach; the plan's moth follows the visitor.

const POD = semillero.slots.find((s) => s.id === 'pod-a') ?? { x: 0, z: 0 };
const POD_STAND: [number, number] = [POD.x, POD.z + 1.2];

type Sample = { t: number; x: number; z: number; strip: number; phase: string };

/** Records the visitor every frame until `stop()` in the page. */
async function track(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __trk: { on: boolean; s: Sample[] } };
    w.__trk = { on: true, s: [] };
    const tick = (now: number): void => {
      const api = window.__jardin;
      const p = api?.roam();
      if (api && p) w.__trk.s.push({ t: now, x: p.x, z: p.z, strip: api.strip(), phase: api.state().phase });
      if (w.__trk.on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const stop = (page: Page): Promise<Sample[]> => page.evaluate(() => {
  const w = window as unknown as { __trk: { on: boolean; s: Sample[] } };
  w.__trk.on = false;
  return w.__trk.s;
});

test('assisted walk: a signpost walks the visitor along the path to the next bed, about 6 m/s at most, arrival said once', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  await page.evaluate(() => {
    const w = window as unknown as { __said: string[] };
    w.__said = [];
    const live = document.querySelector('#proxies .px-live');
    if (live) new MutationObserver(() => void (live.textContent && w.__said.push(live.textContent))).observe(live, { childList: true, characterData: true, subtree: true });
  });
  await track(page);
  const sign = page.locator('#proxies .px-sign[data-dir="next"]');
  await expect(sign).toHaveAttribute('data-bed', 'estanque');
  await sign.focus();
  await page.keyboard.press('Enter');
  await jardin.settled();
  const s = await stop(page);
  await expect(page.locator('#proxies .px-live'), 'the arrival is said').toContainText('Estanque');
  await page.waitForTimeout(500);
  const end = s.at(-1) as Sample;
  expect(end.x, 'at the Estanque stand point').toBeCloseTo(20, 2);
  let top = 0;
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1] as Sample;
    const b = s[i] as Sample;
    const dt = Math.max(1, b.t - a.t) / 1000;
    if (b.x !== a.x) top = Math.max(top, Math.hypot(b.x - a.x, b.z - a.z) / Math.max(dt, 1 / 60));
  }
  expect(top, 'top speed along the path, m/s').toBeLessThan(6.6);
  expect(top, 'a brisk walk, not a cut').toBeGreaterThan(3);
  expect(s.some((x) => x.strip > 0), 'a neighbour walk runs no film strip').toBe(false);
  expect(s.filter((x) => x.phase === 'travel').length, 'travel lasts the walk').toBeGreaterThan(20);
  const said = await page.evaluate(() => (window as unknown as { __said: string[] }).__said);
  expect(said.filter((t) => /Estanque/.test(t)), `arrival said once (${JSON.stringify(said)})`).toHaveLength(1);
});

test('assisted walk: any steering cancels it at once and gives control back', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/puerta');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await jardin.withApi((api) => api.send({ type: 'GOTO', place: { k: 'bed', bed: 'salida' } }));
  await expect.poll(() => jardin.withApi((api) => api.strip()), { timeout: 8000, message: 'the long walk reached its strip' }).toBe(1);
  await page.keyboard.down('ArrowDown');
  const after = await jardin.withApi(async (api) => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { strip: api.strip(), at: api.roam() };
  });
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowDown');
  expect(after.strip, 'the strip stops with the walk').toBe(0);
  await jardin.settled();
  const at = await roamAt(jardin);
  expect(at.x, 'not carried on to the Salida stand point (42)').toBeLessThan(40.5);
  expect(at.z - (after.at?.z ?? 0), 'and walked where the key said').toBeGreaterThan(0.3);
  expect((await jardin.withApi((api) => api.state())).phase).toBe('bed');
});

test('assisted walk: in frozen time it lands in the first frame', async ({ jardin }) => {
  await enterRoam(jardin, '#/b/puerta', { t: '12.5' });
  const x = await jardin.withApi(async (api) => {
    api.send({ type: 'GOTO', place: { k: 'bed', bed: 'salida' } });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return api.roam()?.x ?? 0;
  });
  expect(x, 'at the Salida stand point').toBeCloseTo(42, 3);
});

test('Tab onto a flower out of reach walks the visitor there, it is focused on arrival and said once, Enter opens', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/semillero');
  await jardin.withApi((api) => api.walkTo(27.5, 1.2));
  await untilStill(page);
  const start = await roamAt(jardin);
  expect(Math.hypot(start.x - POD.x, start.z - POD.z), 'the pod is out of reach').toBeGreaterThan(2.5);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let slot: string | null = null;
  for (let i = 0; i < 12 && slot === null; i++) {
    await page.keyboard.press('Tab');
    slot = await page.evaluate(() => {
      const n = document.activeElement as HTMLElement | null;
      return n?.dataset.slot === 'semillero/pod-a' ? n.dataset.slot : null;
    });
  }
  expect(slot, 'the Semillero pod is a Tab stop').toBe('semillero/pod-a');
  await expect.poll(() => jardin.withApi((api) => api.state().slot), { timeout: 10000, message: 'focused on arrival' }).toBe('semillero/pod-a');
  const at = await roamAt(jardin);
  expect(Math.hypot(at.x - start.x, at.z - start.z), 'the visitor walked').toBeGreaterThan(1);
  expect(Math.hypot(at.x - POD_STAND[0], at.z - POD_STAND[1]), 'in front of the pod').toBeLessThan(0.3);
  const name = await page.locator('#proxies [data-slot="semillero/pod-a"]').textContent();
  await expect(page.locator('#proxies .px-live')).toHaveText(name ?? '');
  await page.keyboard.press('Enter');
  await expect.poll(() => jardin.isPanelOpen()).toBe(true);
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
});

test('the plan\'s moth follows the visitor along the strip', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('m');
  await expect(page.locator('#proxies .pl[data-open]')).toBeAttached();
  const mothX = (): Promise<number> => page.evaluate(() => {
    const m = document.querySelector('.pl-moth');
    return m ? new DOMMatrix(getComputedStyle(m).transform).m41 : Number.NaN;
  });
  await page.waitForTimeout(400);
  const before = await mothX();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1200);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(500);
  const after = await mothX();
  expect(after - before, 'the moth moved east with the visitor').toBeGreaterThan(5);
});
