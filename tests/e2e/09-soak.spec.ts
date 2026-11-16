import { expect, PROJECTS, test } from '../helpers/jardin.ts';

// Flow 9: 5 minutes of scripted wandering: JS heap and GPU memory flat. Garden only, fixme until P1.

const BEDS = ['puerta', 'rosaleda', 'estanque', 'semillero', 'gruta', 'salida'] as const;
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

test.fixme('flow 9 garden: five minutes of wandering keeps heap and GPU memory flat', async ({ page, jardin }) => {
  test.setTimeout(8 * 60_000);
  await jardin.visit({ mode: 'garden' });
  await jardin.goto('#/', true);
  const heap: number[] = [];
  const tex: number[] = [];
  const end = Date.now() + 5 * 60_000;
  let i = 0;
  while (Date.now() < end) {
    const bed = BEDS[i % BEDS.length] as string;
    await jardin.goto(`#/b/${bed}`);
    const p = PROJECTS.find((x) => x.bed === bed);
    if (p !== undefined) {
      await jardin.goto(`#/p/${p.id}`);
      await page.keyboard.press('Escape');
      await jardin.settled();
    }
    await jardin.goto('#/');
    const m = await jardin.withApi((api) => ({ heap: api.heapMB(), tex: api.info().texBytes / 2 ** 20 }));
    if (m.heap !== null) heap.push(m.heap);
    tex.push(m.tex);
    i++;
  }
  const third = Math.max(1, Math.floor(heap.length / 3));
  expect(heap.length, 'heap samples').toBeGreaterThan(5);
  expect(mean(heap.slice(-third)), 'JS heap MB, last third vs first third').toBeLessThanOrEqual(mean(heap.slice(0, third)) * 1.1 + 2);
  const tthird = Math.max(1, Math.floor(tex.length / 3));
  expect(mean(tex.slice(-tthird)), 'texture MB, last third vs first third').toBeLessThanOrEqual(mean(tex.slice(0, tthird)) * 1.05 + 1);
  const longTasks = await page.evaluate(() => performance.getEntriesByType('longtask').filter((e) => e.duration > 100).length);
  expect(longTasks, 'long tasks over 100 ms').toBe(0);
});
