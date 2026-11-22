import { expect, test } from '@playwright/test';
import type { BedId } from '../../../src/types.ts';
import { grassInto } from '../../../src/gl/grass.ts';
import { SolidBuilder } from '../../../src/gl/masonry.ts';
import { THICK } from '../../../src/world/enclosure.ts';
import { grassTufts, PATH_CLEAR, TUFT, TUFT_SPREAD } from '../../../src/world/grass.ts';
import { pathDistance } from '../../../src/world/groundplan.ts';
import type { BedScene3 } from '../../../src/world/layout.ts';
import { propBlocks } from '../../../src/world/occluders.ts';
import { traceLayout } from './rig.trace.ts';
import puerta from '../../../content/beds/puerta.json' with { type: 'json' };
import rosaleda from '../../../content/beds/rosaleda.json' with { type: 'json' };
import estanque from '../../../content/beds/estanque.json' with { type: 'json' };
import semillero from '../../../content/beds/semillero.json' with { type: 'json' };
import gruta from '../../../content/beds/gruta.json' with { type: 'json' };
import salida from '../../../content/beds/salida.json' with { type: 'json' };

// The lawn's nap of grass (world/grass.ts, gl/grass.ts): no tuft on the path or its stones, in the pond or on its rim,
// in a solid prop or outside the walls; the low tier keeps about a third of the high tier's tufts, and the high tier's
// blades stay inside the triangle budget.

const ground = traceLayout.ground;
const scenes = { puerta, rosaleda, estanque, semillero, gruta, salida } as unknown as Record<BedId, BedScene3>;
const props = propBlocks(scenes);
const RIM_OUTER = 0.2;

test('grass stands only on the lawn, a third of it on the low tier, inside the triangle budget', () => {
  const high = grassTufts(ground, props, 'high');
  const low = grassTufts(ground, props, 'low');
  const e = ground.enclosure;
  const p = ground.pond;
  for (let t = 0; t < high.length; t += TUFT) {
    const x = high[t]!;
    const z = high[t + 1]!;
    expect(pathDistance(ground.path.points, x, z)).toBeGreaterThan(PATH_CLEAR.clear);
    expect(Math.hypot((x - p.x) / (p.rx + RIM_OUTER + TUFT_SPREAD), (z - p.z) / (p.rz + RIM_OUTER + TUFT_SPREAD))).toBeGreaterThan(1);
    expect(x - TUFT_SPREAD).toBeGreaterThan(e.x[0]);
    expect(x + TUFT_SPREAD).toBeLessThan(e.x[1]);
    expect(z - TUFT_SPREAD).toBeGreaterThan(ground.wall.z);
    expect(z + TUFT_SPREAD).toBeLessThan(e.front - THICK);
    for (let i = 0; i < props.length; i += 4) {
      expect(x > props[i]! && x < props[i + 2]! && z > props[i + 1]! && z < props[i + 3]!).toBe(false);
    }
  }
  const tufts = high.length / TUFT;
  expect(tufts).toBeGreaterThan(1500);
  expect(low.length / TUFT / tufts).toBeGreaterThan(0.25);
  expect(low.length / TUFT / tufts).toBeLessThan(0.42);
  const b = new SolidBuilder();
  grassInto(b, high);
  const triangles = b.geometry().getIndex()!.count / 3;
  expect(triangles).toBeGreaterThan(22_000);
  expect(triangles).toBeLessThan(32_000);
});
