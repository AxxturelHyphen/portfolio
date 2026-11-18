import { checkBudget, recordFrames } from '../helpers/frames.ts';
import { expect, isLow, test } from '../helpers/jardin.ts';

// Flow 4: travel through every bed and back to the overview: textures stream, memory returns to baseline after
// leaving, no new shader program after ready (ARCH section 6, risk 1). Garden only. In free roam (the default) each
// travel is an assisted walk with the same budgets; the rail's own legs run in 19-rail-fallback.

const BEDS = ['puerta', 'rosaleda', 'estanque', 'semillero', 'gruta', 'salida'] as const;

test('flow 4 garden: travel through every bed and back, streaming and memory return to baseline', async ({ page, jardin, tierOpt }) => {
  await jardin.visit({ mode: 'garden' });
  await jardin.goto('#/', true);
  await jardin.longTasksAfterReady(); // stamps the end of load
  const base = await jardin.withApi((api) => ({ tex: api.info().texBytes, programs: api.info().programs, heap: api.heapMB() }));
  const texBudgetMB = isLow(tierOpt) ? 48 : 128;
  const worst = { over25: 0, over50: 0, max: 0 };
  for (const bed of BEDS) {
    const stats = await recordFrames(page, `travel to ${bed}`, () => jardin.goto(`#/b/${bed}`));
    expect(checkBudget(stats, 'travel', isLow(tierOpt)), `${bed}: ${JSON.stringify(stats)}`).toBeNull();
    worst.over25 += stats.over25;
    worst.over50 += stats.over50;
    worst.max = Math.max(worst.max, stats.max);
    const now = await jardin.withApi((api, b: string) => ({ res: api.residency()[b as 'puerta'], info: api.info() }), bed);
    expect(now.res, `${bed} is active after travel`).toBe('active');
    expect(now.info.texBytes / 2 ** 20, 'resident texture MB').toBeLessThanOrEqual(texBudgetMB);
    expect(now.info.programs, 'programs after ready').toBe(base.programs);
  }
  await jardin.goto('#/');
  await page.waitForTimeout(2500); // dispose of neighbours is lazy
  const end = await jardin.withApi((api) => ({ tex: api.info().texBytes, res: api.residency() }));
  expect(Object.values(end.res).filter((s) => s === 'active')).toHaveLength(0);
  expect(await jardin.longTasksAfterReady(), 'long tasks over 100 ms while streaming beds').toEqual([]);
  expect(end.tex, 'texture bytes back to baseline after leaving').toBeLessThanOrEqual(base.tex * 1.1 + 2 ** 20);
});
