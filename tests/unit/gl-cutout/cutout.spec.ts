import { expect, test } from '@playwright/test';

// 200 instanced cutouts in 5 layers, relit by a moving light: counters for the budgets and two frozen-time screenshots.
interface GlProbe { info(): { calls: number; programs: number; texBytes: number; targetBytes: number; textures: number }; frame(): number; programsAfterWarm(): number; programs(): number }

for (const t of [0, 2.6]) {
  test(`cutouts relit at t=${t}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`./?t=${t}`);
    await page.waitForFunction(() => {
      const gl = (window as unknown as { __gl?: GlProbe }).__gl;
      return gl !== undefined && gl.frame() > 10;
    });
    const stats = await page.evaluate(() => {
      const gl = (window as unknown as { __gl: GlProbe }).__gl;
      return { ...gl.info(), warm: gl.programsAfterWarm(), now: gl.programs() };
    });
    console.log(JSON.stringify(stats));
    expect(errors).toEqual([]);
    expect(stats.calls).toBeLessThanOrEqual(12); // sky + 5 layer batches + the film chain
    expect(stats.now).toBe(stats.warm);
    expect(stats.texBytes).toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath(`cutouts-t${t}.png`) });
  });
}
