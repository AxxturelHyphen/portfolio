import { expect, test } from '@playwright/test';
import type { BedId, SpriteRect } from '../../../src/types.ts';
import { ROAM } from '../../../src/core/motion.ts';
import type { BedScene3, Placement3 } from '../../../src/world/layout.ts';
import { builtIn } from '../../../src/world/mode.ts';
import { occluderBlocks, PROP_STANDOFF, propBlocks } from '../../../src/world/occluders.ts';
import { pathDistance } from '../../../src/world/ground.ts';
import { createVisitor, pathZ, type WalkArea } from '../../../src/world/roam.ts';
import puerta from '../../../content/beds/puerta.json' with { type: 'json' };
import rosaleda from '../../../content/beds/rosaleda.json' with { type: 'json' };
import estanque from '../../../content/beds/estanque.json' with { type: 'json' };
import semillero from '../../../content/beds/semillero.json' with { type: 'json' };
import gruta from '../../../content/beds/gruta.json' with { type: 'json' };
import salida from '../../../content/beds/salida.json' with { type: 'json' };
import shared from '../../../public/atlas/shared.json' with { type: 'json' };
import estanqueAtlas from '../../../public/atlas/estanque.json' with { type: 'json' };
import semilleroAtlas from '../../../public/atlas/semillero.json' with { type: 'json' };
import { traceLayout } from './rig.trace.ts';

// The prop audit under free roam: every solid prop standing in the garden is a box the visitor walks round (so the
// figure never stands inside a bench or a barrow and the depth test never cuts it in two), each box lies under its
// drawn plate, and none lies across the garden path the assisted walks follow.

const SCENES = { puerta, rosaleda, estanque, semillero, gruta, salida } as unknown as Record<BedId, BedScene3>;
const SPRITES = { ...shared.sprites, ...estanqueAtlas.sprites, ...semilleroAtlas.sprites } as unknown as Record<string, SpriteRect>;
/** Solid things, not plants: garden furniture and tools, standing lanterns, pots, the armillary's drum, seed packets. */
const SOLID = /^(v\/(?!cat|shears)|sh\/(lantern|pot)-|es\/drum-base|se\/packet-)/;
/** Below this height an item stands on the ground (higher ones sit on a prop: the cat on the bench). */
const ON_GROUND = 0.05;
const ground = traceLayout.ground;
const r = ROAM.radius;

function roamProps(): { bed: BedId; it: Placement3 }[] {
  const out: { bed: BedId; it: Placement3 }[] = [];
  for (const [bed, scene] of Object.entries(SCENES) as [BedId, BedScene3][]) {
    for (const l of scene.layers) {
      for (const it of l.items) {
        if (SOLID.test(it.sprite) && builtIn(it, 'roam') && it.flat !== true && it.y < ON_GROUND) out.push({ bed, it });
      }
    }
  }
  return out;
}

test('every solid prop planted under free roam has a collider', () => {
  const props = roamProps();
  expect(props.length).toBeGreaterThan(10);
  const bare = props.filter(({ it }) => it.block === undefined).map(({ bed, it }) => `${bed} ${it.sprite} at ${it.x}, ${it.z}`);
  expect(bare).toEqual([]);
});

test('each collider lies under its drawn plate', () => {
  const off: string[] = [];
  for (const { bed, it } of roamProps()) {
    const rect = SPRITES[it.sprite];
    if (rect === undefined || it.block === undefined) continue;
    const width = (it.w ?? (it.h ?? 0) * (rect.size[0] / rect.size[1])) * it.scale;
    const px = it.flip === true ? 1 - rect.pivot[0] : rect.pivot[0];
    const [left, right] = it.block;
    const fits = (reach: number, drawn: number): boolean => reach <= drawn + 1e-6 && reach >= 0.7 * drawn;
    if (!fits(left, px * width) || !fits(right, (1 - px) * width)) off.push(`${bed} ${it.sprite}`);
  }
  expect(off).toEqual([]);
});

test('no prop collider lies across the middle of the garden path', () => {
  const b = propBlocks(SCENES);
  const points = ground.path.points;
  const x0 = points[0]?.[0] ?? 0;
  const x1 = points[points.length - 1]?.[0] ?? 0;
  const crossed: string[] = [];
  for (let x = x0; x <= x1; x += 0.05) {
    const z = pathZ(points, x);
    for (let i = 0; i + 3 < b.length; i += 4) {
      if (x > b[i]! - r && x < b[i + 2]! + r && z > b[i + 1]! - r && z < b[i + 3]! + r) crossed.push(`${x.toFixed(2)}, ${z.toFixed(2)}`);
    }
  }
  expect(crossed).toEqual([]);
});

test('the visitor walking at a prop from any side stops outside it', () => {
  const blocks = propBlocks(SCENES);
  const area: WalkArea = { ...ground.enclosure.walk, pond: ground.pond, path: ground.path.points, props: blocks };
  const inside: string[] = [];
  for (let i = 0; i + 3 < blocks.length; i += 4) {
    const cx = (blocks[i]! + blocks[i + 2]!) / 2;
    const cz = (blocks[i + 1]! + blocks[i + 3]!) / 2;
    for (const [dx, dz] of [[0, 1.5], [0, -1.5], [1.5, 0], [-1.5, 0]] as const) {
      const sx = Math.min(Math.max(cx + dx, area.minX + r), area.maxX - r);
      const sz = Math.min(Math.max(cz + dz, area.minZ + r), area.maxZ - r);
      const v = createVisitor(area, sx, sz);
      v.walkTo(cx, cz);
      for (let f = 0; f < 240; f++) v.step(1 / 60);
      const x = v.pos[0]!;
      const z = v.pos[1]!;
      if (x > blocks[i]! - r + 1e-3 && x < blocks[i + 2]! + r - 1e-3 && z > blocks[i + 1]! - r + 1e-3 && z < blocks[i + 3]! + r - 1e-3) {
        inside.push(`box ${i / 4} from ${dx}, ${dz}`);
      }
    }
  }
  expect(inside).toEqual([]);
});

test('low props keep the visitor half a metre off their lens side, so the soles never stop on their feet row', () => {
  const blocks = propBlocks(SCENES);
  const area: WalkArea = { ...ground.enclosure.walk, pond: ground.pond, path: ground.path.points, props: blocks };
  const bench = roamProps().find(({ it }) => it.sprite === 'v/bench')?.it;
  expect(bench?.block).toBeDefined();
  const front = bench!.z + bench!.block![2] / 2;
  const v = createVisitor(area, bench!.x, front + 2);
  v.walkTo(bench!.x, bench!.z);
  for (let f = 0; f < 240; f++) v.step(1 / 60);
  expect(v.pos[1]! - front).toBeGreaterThanOrEqual(PROP_STANDOFF.m + r - 1e-3);
});

test('the Rosaleda lanterns stand clear of the path and every stand point, never beside the carried one', () => {
  const near: string[] = [];
  const stand = traceLayout.anchors.rosaleda;
  for (const { bed, it } of roamProps()) {
    if (bed !== 'rosaleda' || !it.sprite.startsWith('sh/lantern-')) continue;
    if (pathDistance(ground.path.points, it.x, it.z) < 1.5) near.push(`${it.sprite} at ${it.x}, ${it.z}`);
    if (Math.hypot(it.x - stand, it.z - pathZ(ground.path.points, stand)) < 1.5) near.push(`${it.sprite} by the stand`);
  }
  expect(near).toEqual([]);
});

/** Half the figure's width on the ground (m), with its lantern held out to the side. */
const FIGURE_HALF_M = 0.35;

test('a stand point never puts the figure between the follow camera and its flower', () => {
  const hidden: string[] = [];
  for (const [bed, scene] of Object.entries(SCENES) as [BedId, BedScene3][]) {
    for (const s of scene.slots) {
      if (s.stand === undefined) continue;
      const [x, z] = s.stand;
      if (z > s.z && Math.abs(x - s.x) < FIGURE_HALF_M + (s.hit[0] * s.scale) / 2) hidden.push(`${bed}/${s.id}`);
    }
  }
  expect(hidden).toEqual([]);
});

test('the sundial stands tall with its armillary, so its box is the drum\'s drawn footprint with no standoff', () => {
  const drum = roamProps().find(({ it }) => it.sprite === 'es/drum-base')?.it;
  expect(drum?.block).toBeDefined();
  const [left, right, depth] = drum!.block!;
  const blocks = propBlocks(SCENES);
  const box: number[] = [];
  for (let i = 0; i + 3 < blocks.length; i += 4) if (Math.abs(blocks[i]! - (drum!.x - left)) < 1e-4) box.push(...blocks.subarray(i, i + 4));
  expect(box.map((v) => Number(v.toFixed(3)))).toEqual([drum!.x - left, drum!.z - depth / 2, drum!.x + right, drum!.z + depth / 2].map((v) => Number(v.toFixed(3))));
});

test('a click walk far left past the skep or the sundial goes round it and arrives (cook/look/r20qa bugs 7 and 8)', () => {
  const area: WalkArea = {
    ...ground.enclosure.walk, pond: ground.pond, path: ground.path.points,
    blocks: occluderBlocks(ground.enclosure, SCENES), props: propBlocks(SCENES),
  };
  const missed: string[] = [];
  for (const [x0, z0, x1, z1] of [[37.5, 0.5, 31, 0.5], [19.7, 0.75, 14, 0.75], [37.5, 0.5, 33, 0.3], [34, 0.4, 37.6, 0.6]] as const) {
    const v = createVisitor(area, x0, z0);
    v.walkTo(x1, z1);
    let t = 0;
    for (; t < 8 && v.busy; t += 1 / 60) v.step(1 / 60);
    const off = Math.hypot(v.pos[0]! - x1, v.pos[1]! - z1);
    if (off > 0.1) missed.push(`${x0}, ${z0} to ${x1}, ${z1}: stopped at ${v.pos[0]!.toFixed(2)}, ${v.pos[1]!.toFixed(2)}`);
  }
  expect(missed).toEqual([]);
});
