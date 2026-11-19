import { expect, test } from '../helpers/jardin.ts';
import { enterRoam, roamAt } from '../helpers/roam.ts';
import type { BedScene3 } from '../../src/world/layout.ts';
import { builtIn } from '../../src/world/mode.ts';
import rosaledaJson from '../../content/beds/rosaleda.json' with { type: 'json' };

// What looked broken while walking (cook/look/r16broken): the visitor could stand inside the Rosaleda bench, and the
// bed being walked out of gave way to its flat overview card (a rail picture with a black framing mask) while the
// visitor was still in it.

const rosaleda = rosaledaJson as unknown as BedScene3;
const bench = rosaleda.layers.flatMap((l) => l.items).find((it) => it.sprite === 'v/bench' && builtIn(it, 'roam'));
if (bench?.block === undefined) throw new Error('content/beds/rosaleda.json: the bench has no block');
const [left, right, depth] = bench.block;
const RADIUS = 0.3;

test('the visitor cannot walk into the Rosaleda bench from in front or behind', async ({ jardin }) => {
  await enterRoam(jardin, '#/b/rosaleda');
  const walk = async (x: number, z: number): Promise<void> => {
    await jardin.withApi((api, a) => api.walkTo(a.x, a.z), { x, z });
    await jardin.page.waitForTimeout(2500);
  };
  const outside = (p: { x: number; z: number }): boolean => p.x <= bench.x - left - RADIUS + 0.01 || p.x >= bench.x + right + RADIUS - 0.01
    || Math.abs(p.z - bench.z) >= depth / 2 + RADIUS - 0.01;
  const west = bench.x - left - RADIUS - 0.5;
  const legs: [number, number][][] = [[[bench.x - 0.3, bench.z + 1.2]], [[west, bench.z + 1.2], [west, bench.z - 1.2], [bench.x - 0.3, bench.z - 1.2]]];
  for (const leg of legs) {
    for (const [x, z] of leg) await walk(x, z);
    const [x0, z0] = leg[leg.length - 1]!;
    const at = await roamAt(jardin);
    expect(Math.hypot(at.x - x0, at.z - z0), `reached ${x0}, ${z0}`).toBeLessThan(0.2);
    await walk(bench.x - 0.3, bench.z);
    const p = await roamAt(jardin);
    expect(outside(p), `visitor at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`).toBe(true);
  }
});

test('walking out of La Puerta keeps its cutouts until the visitor has left it', async ({ jardin }) => {
  await enterRoam(jardin, '#/b/puerta');
  await jardin.withApi((api) => { void api.goto('#/b/estanque'); });
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    const s = await jardin.withApi((api) => ({ x: api.roam()?.x ?? 0, puerta: api.residency().puerta }));
    if (s.x < 4) seen.push(s.puerta);
    else break;
    await jardin.page.waitForTimeout(50);
  }
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter((st) => st !== 'ready' && st !== 'active')).toEqual([]);
});
