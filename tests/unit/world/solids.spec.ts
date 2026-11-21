import { expect, test } from '@playwright/test';
import { SolidBuilder } from '../../../src/gl/masonry.ts';
import { BLOCK, enclosureRuns, masonryOf } from '../../../src/world/enclosure.ts';
import { bankKerbs, KERB_SHAPE, pondRim } from '../../../src/world/solids.ts';
import { traceLayout } from './rig.trace.ts';

const ground = traceLayout.ground;

/** Triangles whose winding disagrees with their vertex normals (they would be culled from the side they face). */
function inverted(b: SolidBuilder): number {
  const g = b.geometry();
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const idx = g.getIndex()!;
  let bad = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const [a, c, d] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    const ux = p.getX(c) - p.getX(a), uy = p.getY(c) - p.getY(a), uz = p.getZ(c) - p.getZ(a);
    const vx = p.getX(d) - p.getX(a), vy = p.getY(d) - p.getY(a), vz = p.getZ(d) - p.getZ(a);
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (Math.hypot(cx, cy, cz) < 1e-9) continue;
    if (cx * n.getX(a) + cy * n.getY(a) + cz * n.getZ(a) <= 0) bad++;
  }
  return bad;
}

test('every solid faces outward: blocks, rim stones and kerbs wind with their normals', () => {
  const m = masonryOf(enclosureRuns(ground.enclosure, ground.wall.z, ground.wall.h), ground.enclosure.baseH);
  const walls = new SolidBuilder().blocks(m.stone).blocks(m.base).blocks(m.coping);
  expect(m.stone.length % BLOCK).toBe(0);
  expect(inverted(walls)).toBe(0);
  const rim = new SolidBuilder();
  for (const s of pondRim(ground.pond)) rim.prism(s.outline, s.y0, s.y1);
  expect(rim.empty).toBe(false);
  expect(inverted(rim)).toBe(0);
  const kerbs = bankKerbs(ground.path.points, ground.pond);
  expect(kerbs.length).toBeGreaterThan(0);
  const kerb = new SolidBuilder();
  for (const line of kerbs) kerb.ribbon(line, KERB_SHAPE.width, KERB_SHAPE.bottom, KERB_SHAPE.top);
  expect(inverted(kerb)).toBe(0);
});

test('the pond rim rings the shore and every stone stands in the ground', () => {
  const p = ground.pond;
  for (const s of pondRim(p)) {
    expect(s.y0).toBeLessThan(0);
    expect(s.y1).toBeGreaterThan(0.05);
    for (let i = 0; i < s.outline.length; i += 2) {
      const r = Math.hypot((s.outline[i]! - p.x) / p.rx, (s.outline[i + 1]! - p.z) / p.rz);
      expect(r).toBeGreaterThan(0.9);
      expect(r).toBeLessThan(1.12);
    }
  }
});
