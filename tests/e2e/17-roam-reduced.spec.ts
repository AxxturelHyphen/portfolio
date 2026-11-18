import { expect, test } from '../helpers/jardin.ts';
import { enterRoam, focusIn, projectOfSlot, roamAt, untilStill } from '../helpers/roam.ts';

// Free roam under reduced motion (cook/ROAM_PLAN.md section 3): walking stays, the camera follows without lag, an
// assisted walk (signpost, plan) is a cut, and opening and closing a flower still work.

test.use({ reducedMotion: 'reduce' });

type Sample = { px: number; pz: number; cx: number; cz: number };

test('roam reduced: no camera lag, assisted walks cut, open and close still work', async ({ page, jardin }) => {
  await enterRoam(jardin);
  expect(await jardin.withApi((api) => api.state().reduced)).toBe(true);
  await page.evaluate(() => {
    const w = window as unknown as { __cam: Sample[] };
    w.__cam = [];
    const tick = (): void => {
      const api = window.__jardin;
      const p = api?.roam();
      if (api && p) {
        const c = api.camera();
        w.__cam.push({ px: p.x, pz: p.z, cx: c.x, cz: c.z });
      }
      if (w.__cam.length < 2000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // South from the gate: nothing in reach, so no focus nudge moves the camera; it must stop when the visitor stops.
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowDown');
  await untilStill(page);
  const samples = await page.evaluate(() => (window as unknown as { __cam: Sample[] }).__cam);
  let last = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i]?.px !== samples[i - 1]?.px || samples[i]?.pz !== samples[i - 1]?.pz) last = i;
  const rest = samples.slice(last);
  expect(last > 0 && rest.length > 5, 'the visitor walked and came to a stop while recorded').toBe(true);
  const drift = Math.max(...rest.map((s) => Math.hypot(s.cx - (rest[0]?.cx ?? 0), s.cz - (rest[0]?.cz ?? 0))));
  expect(drift, 'the camera stops on the frame the visitor stops').toBeLessThan(1e-4);
  expect(await jardin.withApi((api) => api.state().phase), 'nothing was in reach').toBe('bed');

  await page.keyboard.down('ArrowRight');
  const slot = await focusIn(page, 'rosaleda');
  await page.keyboard.up('ArrowRight');
  await untilStill(page);

  const project = await projectOfSlot(page, slot);
  const at = await roamAt(jardin);
  await page.keyboard.press('Enter');
  await jardin.expectOpen(project);
  await page.keyboard.press('Escape');
  await jardin.expectClosed();
  await jardin.settled();
  expect(await roamAt(jardin), 'the visitor did not move').toEqual(at);

  const x = await jardin.withApi(async (api) => {
    api.send({ type: 'GOTO', place: { k: 'bed', bed: 'estanque' } });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return api.roam()?.x ?? 0;
  });
  expect(x, 'an assisted walk under reduced motion is a cut to the stand point').toBeCloseTo(20, 3);
  await expect.poll(() => jardin.withApi((api) => api.state().phase)).toBe('bed');
});
