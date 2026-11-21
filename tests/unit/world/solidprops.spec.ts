import { expect, test } from '@playwright/test';
import type { BedId } from '../../../src/types.ts';
import { SolidBuilder } from '../../../src/gl/masonry.ts';
import { buildProps, type PropBuilders } from '../../../src/gl/props.ts';
import { signWood } from '../../../src/gl/signwood.ts';
import type { BedScene3 } from '../../../src/world/layout.ts';
import { builtIn } from '../../../src/world/mode.ts';
import { BENCH_SEAT, isSolidProp, lanternRest, solidProps } from '../../../src/world/props.solid.ts';
import puerta from '../../../content/beds/puerta.json' with { type: 'json' };
import rosaleda from '../../../content/beds/rosaleda.json' with { type: 'json' };
import estanque from '../../../content/beds/estanque.json' with { type: 'json' };
import semillero from '../../../content/beds/semillero.json' with { type: 'json' };
import salida from '../../../content/beds/salida.json' with { type: 'json' };

// Free roam's solid props (world/props.solid.ts, gl/props.ts, gl/signwood.ts): every lantern, the pot and the bench
// become geometry that faces outward, the bench fills its collision box at the cat's seat, and a lantern resting by
// the bench stands on its seat.

const scenes = { puerta, rosaleda, estanque, semillero, salida } as unknown as Record<BedId, BedScene3>;

function builders(): PropBuilders {
  return { iron: new SolidBuilder(), glass: new SolidBuilder(), clay: new SolidBuilder(), wood: new SolidBuilder() };
}

/** Share of triangles whose winding disagrees with their normals (culled from the side they face). */
function invertedShare(b: SolidBuilder): number {
  const g = b.geometry();
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const idx = g.getIndex()!;
  let bad = 0;
  let all = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const [a, c, d] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    const ux = p.getX(c) - p.getX(a), uy = p.getY(c) - p.getY(a), uz = p.getZ(c) - p.getZ(a);
    const vx = p.getX(d) - p.getX(a), vy = p.getY(d) - p.getY(a), vz = p.getZ(d) - p.getZ(a);
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (Math.hypot(cx, cy, cz) < 1e-9) continue;
    const nx = n.getX(a) + n.getX(c) + n.getX(d), ny = n.getY(a) + n.getY(c) + n.getY(d), nz = n.getZ(a) + n.getZ(c) + n.getZ(d);
    all++;
    if (cx * nx + cy * ny + cz * nz <= 0) bad++;
  }
  return bad / Math.max(1, all);
}

test('every lantern, the pot, the bench and the sign timber are built and face outward', () => {
  const props = solidProps(scenes);
  const roamLanterns = Object.values(scenes).flatMap((s) => s.layers.flatMap((l) => l.items)).filter((it) => it.sprite.startsWith('sh/lantern') && builtIn(it, 'roam'));
  expect(props.lanterns.length).toBe(roamLanterns.length);
  expect(props.pots.length).toBe(1);
  expect(props.benches.length).toBe(1);
  const b = builders();
  buildProps(props, b);
  signWood(b.wood, [{ x: 3, z: -1, dir: 1 }, { x: 8, z: -1, dir: -1 }]);
  for (const [kind, builder] of Object.entries(b)) {
    expect(builder.empty, kind).toBe(false);
    expect(invertedShare(builder), kind).toBe(0);
  }
});

test('the bench fills its collision box at the cat\'s seat; the tin lantern stands on the ground beside it, one resting by it on its seat', () => {
  const items = (rosaleda as unknown as BedScene3).layers.flatMap((l) => l.items);
  const bench = items.find((it) => it.sprite === 'v/bench' && builtIn(it, 'roam'))!;
  const cat = items.find((it) => it.sprite === 'v/cat' && builtIn(it, 'roam'))!;
  expect(cat.y).toBeCloseTo(BENCH_SEAT, 6);
  const [spot] = solidProps(scenes).benches;
  expect(spot!.x0).toBeCloseTo(bench.x - bench.block![0], 6);
  expect(spot!.x1).toBeCloseTo(bench.x + bench.block![1], 6);
  const b = builders();
  buildProps({ lanterns: [], pots: [], benches: [spot!] }, b);
  const box = b.wood.geometry();
  box.computeBoundingBox();
  const bb = box.boundingBox!;
  expect(bb.min.x).toBeGreaterThanOrEqual(spot!.x0 - 0.03);
  expect(bb.max.x).toBeLessThanOrEqual(spot!.x1 + 0.03);
  expect(bb.max.z - bb.min.z).toBeLessThanOrEqual(spot!.depth);
  expect(bb.max.y).toBeCloseTo(BENCH_SEAT, 1);
  const tin = items.find((it) => it.sprite === 'sh/lantern-tin' && builtIn(it, 'roam'))!;
  expect(lanternRest(tin, items)).toEqual({ x: tin.x, y: 0 });
  expect(tin.x - tin.block![0], 'clear of the bench and the cat').toBeGreaterThan(spot!.x1);
  const rest = lanternRest({ ...tin, x: spot!.x1 + 0.2, y: BENCH_SEAT, z: bench.z }, items);
  expect(rest.y).toBe(BENCH_SEAT);
  expect(rest.x).toBeLessThanOrEqual(spot!.x1);
  expect(rest.x).toBeGreaterThanOrEqual(spot!.x0);
});

test('free roam leaves the solid props\' cards out; the plants and the cat stay cards', () => {
  for (const s of ['sh/lantern-cage', 'sh/lantern-tin', 'sh/pot-a', 'v/bench']) expect(isSolidProp(s), s).toBe(true);
  for (const s of ['ro/hero-a', 'v/cat', 'v/can', 'sh/board']) expect(isSolidProp(s), s).toBe(false);
});
