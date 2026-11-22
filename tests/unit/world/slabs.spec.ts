import { expect, test } from '@playwright/test';
import { TERRAIN } from '../../../src/core/terrain.ts';
import { bakePathField, type GroundLayout } from '../../../src/gl/ground.layout.ts';
import { SolidBuilder } from '../../../src/gl/masonry.ts';
import { slabStones } from '../../../src/gl/slabs.ts';
import { pathSlabs } from '../../../src/world/slabs.ts';
import { traceLayout } from './rig.trace.ts';

// The path's slabs as real stones (world/slabs.ts, gl/slabs.ts): traced from the painted flagstones over the baked
// path field, closed outlines that never overlap, standing a few centimetres proud with their tops at the walk height.

const g = traceLayout.ground;
const e = g.enclosure;
const layout: GroundLayout = { x0: e.x[0] - 0.6, x1: e.x[1] + 0.6, z0: g.wall.z - 1.2, z1: 2, wallZ: g.wall.z, path: g.path.points.flat(), puddles: g.puddles.flat() };
const slabs = pathSlabs(bakePathField(layout), layout);

test('the slabs pave the path: hundreds of stones, each a closed outline round its own seed', () => {
  expect(slabs.length).toBeGreaterThan(150);
  const bad: string[] = [];
  for (const s of slabs) {
    let area = 0;
    let far = 0;
    for (let i = 0; i < s.outline.length; i += 2) {
      const j = (i + 2) % s.outline.length;
      area += s.outline[i + 1]! * s.outline[j]! - s.outline[i]! * s.outline[j + 1]!;
      far = Math.max(far, Math.hypot(s.outline[i]! - s.x, s.outline[i + 1]! - s.z));
    }
    if (s.outline.length !== 28 || far >= 0.46 || area / 2 <= 0.02) bad.push(`${s.id}: ${s.outline.length} ${far.toFixed(2)} ${(area / 2).toFixed(3)}`);
  }
  expect(bad).toEqual([]);
});

test('neighbouring slabs keep a joint: no seed lies inside another stone', () => {
  const inside = (o: readonly number[], x: number, z: number): boolean => {
    let hit = false;
    for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) {
      if (o[i + 1]! > z !== o[j + 1]! > z && x < ((o[j]! - o[i]!) * (z - o[i + 1]!)) / (o[j + 1]! - o[i + 1]!) + o[i]!) hit = !hit;
    }
    return hit;
  };
  const overlaps = slabs.filter((a) => slabs.some((b) => a !== b && Math.hypot(a.x - b.x, a.z - b.z) < 0.9 && inside(b.outline, a.x, a.z)));
  expect(overlaps).toEqual([]);
});

test('the stones face outward, stand on the soil and top out within a centimetre and a half over the walk height', () => {
  const b = new SolidBuilder();
  slabStones(b, slabs);
  const geo = b.geometry();
  const p = geo.getAttribute('position');
  const n = geo.getAttribute('normal');
  const idx = geo.getIndex()!;
  let inverted = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const [i, j, k] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    const ux = p.getX(j) - p.getX(i), uy = p.getY(j) - p.getY(i), uz = p.getZ(j) - p.getZ(i);
    const vx = p.getX(k) - p.getX(i), vy = p.getY(k) - p.getY(i), vz = p.getZ(k) - p.getZ(i);
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (Math.hypot(cx, cy, cz) > 1e-9 && cx * n.getX(i) + cy * n.getY(i) + cz * n.getZ(i) <= 0) inverted++;
  }
  expect(inverted).toBe(0);
  let low = Infinity;
  let rise = [Infinity, -Infinity];
  for (let i = 0; i < p.count; i++) {
    low = Math.min(low, p.getY(i));
    if (n.getY(i) < 0.99) continue;
    rise = [Math.min(rise[0]!, p.getY(i) - TERRAIN.slab), Math.max(rise[1]!, p.getY(i) - TERRAIN.slab)];
  }
  expect(low).toBe(0);
  expect(rise[0], 'the feet on the slab tops').toBeGreaterThan(-0.004);
  expect(rise[1]).toBeLessThan(0.016);
});
