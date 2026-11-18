import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { checkBudget, recordFrames } from '../helpers/frames.ts';
import { expect, isLow, test } from '../helpers/jardin.ts';
import { enterRoam } from '../helpers/roam.ts';

// Free roam frame budget (cook/ROAM_PLAN.md section 5): a walk from the gate to the Salida along the garden path, beds
// streaming in by where the visitor is and is heading, flowers focusing as the visitor passes. High: 0 frames over
// 25 ms; low: at most 2 over 50 ms; draw calls p95 within 80 and 40; no long task over 100 ms.

const garden = JSON.parse(readFileSync('content/garden.json', 'utf8')) as { ground: { path: { points: [number, number][] } } };
/** The path knots from the gate to the Salida, without the grotto spur and the door at the end. */
const ROUTE = garden.ground.path.points.filter(([x, z]) => x > 1 && x < 45 && z > -4);

type Residency = Record<string, string>;

test('transition budget roam: a walk from the gate to the Salida with streaming', async ({ page, jardin, tierOpt }) => {
  test.setTimeout(150_000);
  await enterRoam(jardin);
  const stats = await recordFrames(page, 'roam gate to salida', () => jardin.withApi(async (api, route: [number, number][]) => {
    const log: { x: number; bed: string | null; resident: string[] }[] = [];
    const frame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));
    for (const [x, z] of route) {
      api.walkTo(x, z);
      let still = 0;
      let prev = api.roam();
      for (let f = 0; f < 900 && still < 10; f++) {
        await frame();
        const p = api.roam();
        if (p === null || prev === null) break;
        const d = Math.hypot(p.x - x, p.z - z);
        still = d < 0.3 || (p.x === prev.x && p.z === prev.z) ? still + 1 : 0;
        if (d < 0.3) break;
        prev = p;
        if (f % 30 === 0) {
          const r = api.residency() as Residency;
          log.push({ x: Math.round(p.x * 10) / 10, bed: api.state().bed, resident: Object.keys(r).filter((b) => r[b] === 'ready' || r[b] === 'active') });
        }
      }
    }
    (window as unknown as { __streamLog: unknown }).__streamLog = log;
  }, ROUTE));
  const end = await jardin.withApi((api) => ({ at: api.roam(), bed: api.state().bed }));
  const log = await page.evaluate(() => (window as unknown as { __streamLog: { x: number; bed: string | null; resident: string[] }[] }).__streamLog);
  const longTasks = await jardin.longTasksAfterReady();
  const name = test.info().project.name;
  mkdirSync('test-results', { recursive: true });
  appendFileSync('test-results/roam-budget.txt', `${name} frames ${stats.frames} over25 ${stats.over25} over50 ${stats.over50} max ${stats.max.toFixed(1)} ms callsP95 ${stats.app?.callsP95 ?? -1} longTasks ${longTasks.length}\n`);
  let seen = '';
  for (const row of log) {
    const key = `${row.bed}: ${row.resident.join(',')}`;
    if (key === seen) continue;
    seen = key;
    appendFileSync('test-results/roam-budget.txt', `${name}   x ${row.x} ${key}\n`);
  }
  expect(end.at?.x ?? 0, 'walked into the Salida').toBeGreaterThan(38.5);
  expect(end.bed).toBe('salida');
  expect(stats.frames, 'frames recorded').toBeGreaterThan(300);
  expect(checkBudget(stats, 'travel', isLow(tierOpt)), JSON.stringify(stats)).toBeNull();
  expect(stats.app?.callsP95 ?? 0, 'draw calls p95').toBeLessThanOrEqual(isLow(tierOpt) ? 40 : 80);
  expect(longTasks, 'no long task over 100 ms').toEqual([]);
});
