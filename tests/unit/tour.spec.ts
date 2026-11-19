import { expect, test } from '@playwright/test';
import { runTour, TOUR_BEDS, type TourDeps } from '../../src/bench/tour.ts';
import type { FrameReport } from '../../src/types.ts';

test('bench tour visits every bed, opens and closes projects, and aggregates conservatively', async () => {
  const visited: string[] = [];
  let label = '';
  let n = 0;
  const report = (): FrameReport => {
    n++;
    return { label, frames: 10, avg: n, p95: n * 2, max: 30, over25: 0, over50: 0, over100: 0, longTasks: 1, callsP95: 10 + n };
  };
  const deps: TourDeps = {
    tier: 'high',
    goto: async (h) => void visited.push(h),
    rec: { start: (l) => void (label = l), stop: report },
    info: () => ({ calls: 0, triangles: 0, textures: 0, geometries: 0, programs: 0, texBytes: 2 ** 20 * 40, targetBytes: 2 ** 20 * 10 }),
    heapMB: () => 12.345,
    projects: { rosaleda: 'garagic', semillero: 'ml-math' },
  };
  const line = await runTour(deps);
  for (const bed of TOUR_BEDS) expect(visited).toContain(`#/b/${bed}`);
  expect(visited).toContain('#/p/garagic');
  expect(visited.slice(-1)).toEqual(['#/']);
  const legs = TOUR_BEDS.length + 2 * 2 + 1;
  expect(line).toMatchObject({ tier: 'high', textureMB: 50, heapMB: 12.35, longTasks: legs, drawCallsP95: 10 + legs, frameP95: legs * 2 });
});
