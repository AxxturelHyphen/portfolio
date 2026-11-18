import type { BedId } from '../../../src/types.ts';
import { expect, test } from '@playwright/test';
import { ROAM } from '../../../src/core/motion.ts';
import puerta from '../../../content/beds/puerta.json' with { type: 'json' };
import rosaleda from '../../../content/beds/rosaleda.json' with { type: 'json' };
import estanque from '../../../content/beds/estanque.json' with { type: 'json' };
import semillero from '../../../content/beds/semillero.json' with { type: 'json' };
import gruta from '../../../content/beds/gruta.json' with { type: 'json' };
import salida from '../../../content/beds/salida.json' with { type: 'json' };
import type { BedScene3 } from '../../../src/world/layout.ts';
import { occluderBlocks } from '../../../src/world/occluders.ts';
import { pathZ } from '../../../src/world/roam.ts';
import { traceLayout } from './rig.trace.ts';

const SCENES = { puerta, rosaleda, estanque, semillero, gruta, salida } as unknown as Record<BedId, BedScene3>;
const ground = traceLayout.ground;
const enc = ground.enclosure;
const walk = enc.walk;
const r = ROAM.radius;
const CELL = 0.25;
/** A flower is within reach when the visitor can stand this close to it, or to the rim in front of it on the pond (m). */
const SLOT_REACH = 1.5;

const blocks = occluderBlocks(enc, SCENES);
const nx = Math.floor((walk.maxX - walk.minX - 2 * r) / CELL) + 1;
const nz = Math.floor((walk.maxZ - walk.minZ - 2 * r) / CELL) + 1;
const xAt = (i: number): number => walk.minX + r + i * CELL;
const zAt = (j: number): number => walk.minZ + r + j * CELL;

/** Where the body's centre may stand: outside the body-inflated pond and every body-inflated walk block. */
function free(x: number, z: number): boolean {
  const p = ground.pond;
  const ex = (x - p.x) / (p.rx + r);
  const ez = (z - p.z) / (p.rz + r);
  if (ex * ex + ez * ez <= 1) return false;
  for (let k = 0; k < blocks.length; k += 4) {
    if (x > blocks[k]! - r && x < blocks[k + 2]! + r && z > blocks[k + 1]! - r && z < blocks[k + 3]! + r) return false;
  }
  return true;
}

const cellOf = (x: number, z: number): [number, number] => [
  Math.min(nx - 1, Math.max(0, Math.round((x - walk.minX - r) / CELL))),
  Math.min(nz - 1, Math.max(0, Math.round((z - walk.minZ - r) / CELL))),
];

/** Flood fill of the walk grid from (x, z), four-connected. */
function reachFrom(x: number, z: number): Uint8Array {
  const seen = new Uint8Array(nx * nz);
  const [i0, j0] = cellOf(x, z);
  const queue = [i0 + j0 * nx];
  seen[queue[0]!] = 1;
  while (queue.length > 0) {
    const c = queue.pop()!;
    const i = c % nx;
    const j = (c - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const n = a + b * nx;
      if (seen[n] === 1 || !free(xAt(a), zAt(b))) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

/** Where the visitor reaches a slot from: the slot, or for a flower on the water the body-inflated rim behind it. */
function approachOf(x: number, z: number): [number, number] {
  const p = ground.pond;
  const ex = (x - p.x) / (p.rx + r);
  const ez = (z - p.z) / (p.rz + r);
  const q = Math.hypot(ex, ez);
  if (q > 1) return [x, z];
  return [p.x + (ex / Math.max(q, 1e-6)) * (p.rx + r), p.z + (ez / Math.max(q, 1e-6)) * (p.rz + r)];
}

const beds = traceLayout.rail.keys.flatMap((k) => (k.bed === undefined ? [] : [k.bed]));
const standOf = (b: BedId): [number, number] => [traceLayout.anchors[b], pathZ(ground.path.points, traceLayout.anchors[b])];

test('from the start every bed stand point and every flower slot stays reachable past the walk blocks', () => {
  const [sx, sz] = standOf(beds[0]!);
  expect(free(sx, sz), 'start point').toBe(true);
  const seen = reachFrom(sx, sz);
  const reached = (x: number, z: number): boolean => {
    const [i, j] = cellOf(x, z);
    return seen[i + j * nx] === 1;
  };
  for (const b of beds) expect(reached(...standOf(b)), `stand point of ${b}`).toBe(true);
  const missed: string[] = [];
  for (const b of beds) {
    for (const sl of SCENES[b].slots) {
      const [ax, az] = approachOf(sl.x, sl.z);
      let near = false;
      for (let j = 0; j < nz && !near; j++) {
        for (let i = 0; i < nx && !near; i++) near = seen[i + j * nx] === 1 && Math.hypot(xAt(i) - ax, zAt(j) - az) <= SLOT_REACH;
      }
      if (!near) missed.push(`${b}/${sl.id}`);
    }
  }
  expect(missed, missed.join(', ')).toEqual([]);
});

test('the whole path, the Salida door and both north corners are reachable from the start', () => {
  const [sx, sz] = standOf(beds[0]!);
  const seen = reachFrom(sx, sz);
  const reached = (x: number, z: number): boolean => {
    const [i, j] = cellOf(x, z);
    return seen[i + j * nx] === 1;
  };
  const inside = (x: number, z: number): [number, number] => [
    Math.min(walk.maxX - r, Math.max(walk.minX + r, x)),
    Math.min(walk.maxZ - r, Math.max(walk.minZ + r, z)),
  ];
  const pts = ground.path.points;
  const door = inside(...(pts[pts.length - 1] as [number, number]));
  expect(reached(...door), `the door at ${door.join(', ')}`).toBe(true);
  // The corners where the north wall meets the end walls: the body's edge 0.5 m from both walls.
  for (const x of [walk.minX + r, walk.maxX - r]) {
    expect(enc.x.some((wx) => Math.abs(Math.abs(x - wx) - r - 0.5) < 1e-6), 'corner 0.5 m from the end wall').toBe(true);
    expect(reached(x, walk.minZ + r), `north corner at ${x}`).toBe(true);
  }
  const off: string[] = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k] as [number, number];
    const [bx, bz] = pts[k + 1] as [number, number];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / CELL);
    for (let i = 0; i <= n; i++) {
      const [x, z] = inside(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n);
      if (!free(x, z) || !reached(x, z)) off.push(`${x.toFixed(2)},${z.toFixed(2)}`);
    }
  }
  expect(off, off.join(' ')).toEqual([]);
});
