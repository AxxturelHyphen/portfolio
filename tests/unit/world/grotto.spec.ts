import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ORBIT, ROAM } from '../../../src/core/motion.ts';
import { THICK } from '../../../src/world/enclosure.ts';
import { createGrottoCamera, GROTTO_EYE } from '../../../src/world/grotto.camera.ts';
import { ceilingY, DOME, GROTTO, GROTTO_ANNEX, grottoRocks, inGrotto } from '../../../src/world/grotto.ts';
import type { WorldLayout } from '../../../src/world/layout.ts';
import { createVisitor, HOLD, type WalkArea } from '../../../src/world/roam.ts';

// The grotto as a rock chamber behind the back wall (world/grotto.ts): the mouth cut in the wall, the walk in and out
// through it, the walls of the chamber holding the visitor, the camera in the mouth framing the visitor at every orbit
// and zoom without entering the rock, and the low tier's lighter room.

const garden = JSON.parse(readFileSync(new URL('../../../content/garden.json', import.meta.url), 'utf8')) as WorldLayout;
const g = garden.ground;
const DEG = Math.PI / 180;
const r = ROAM.radius;

const area = (): WalkArea => ({ ...g.enclosure.walk, pond: g.pond, path: g.path.points, annex: GROTTO_ANNEX });

function walk(v: ReturnType<typeof createVisitor>, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) v.step(1 / 60);
}

test('the back wall has a gap at the mouth and the dome is buried in the wall either side', () => {
  expect(g.wall.z).toBe(GROTTO.wallZ);
  expect(THICK).toBe(GROTTO.thick);
  expect(g.enclosure.low).toContainEqual([GROTTO.mouth[0], GROTTO.mouth[1], 0]);
  expect(DOME.front).toBeLessThan(GROTTO.wallZ);
  expect(DOME.front).toBeGreaterThan(GROTTO.wallZ - GROTTO.thick);
  expect(ceilingY(GROTTO_EYE.x, GROTTO_EYE.z)).toBeGreaterThan(GROTTO_EYE.y + 0.3);
});

test('the visitor walks in through the mouth, is in the grotto, and walks back out', () => {
  const v = createVisitor(area(), 30, -2);
  v.walkTo(...GROTTO.stand);
  walk(v, 8);
  expect(v.pos[0]).toBeCloseTo(GROTTO.stand[0], 1);
  expect(v.pos[1]).toBeCloseTo(GROTTO.stand[1], 1);
  expect(inGrotto(v.pos[0]!, v.pos[1]!, false)).toBe(true);
  v.walkTo(30, -2);
  walk(v, 8);
  expect(v.pos[0]).toBeCloseTo(30, 1);
  expect(v.pos[1]).toBeCloseTo(-2, 1);
  expect(inGrotto(v.pos[0]!, v.pos[1]!, true)).toBe(false);
});

test('the wall beside the mouth and the chamber walls hold the visitor', () => {
  const v = createVisitor(area(), 31.2, -4);
  v.setHeld(HOLD.up);
  walk(v, 3);
  expect(v.pos[1]).toBeCloseTo(g.enclosure.walk.minZ + r, 3);
  const inside = createVisitor(area(), ...GROTTO.stand);
  for (const bits of [HOLD.up, HOLD.left, HOLD.right, HOLD.up | HOLD.left, HOLD.up | HOLD.right]) {
    inside.place(...GROTTO.stand);
    inside.setHeld(bits);
    walk(inside, 3);
    const [x, z] = [inside.pos[0]!, inside.pos[1]!];
    // The body's edge stays under the dome, its head under the ceiling.
    const u = (Math.abs(x - DOME.x) + r) / DOME.rx;
    const w = (Math.abs(z - DOME.z) + r) / DOME.rz;
    expect(u * u + w * w, `held ${bits}`).toBeLessThan(1);
    expect(ceilingY(x, z), `held ${bits}`).toBeGreaterThan(1.25);
  }
});

test('the grotto camera stays in the mouth and frames the visitor at every orbit and zoom', () => {
  const cam = createGrottoCamera();
  const rooms = GROTTO_ANNEX.rooms;
  const [jambL, jambR] = [rooms[0]!, rooms[2]!];
  for (const aspect of [16 / 9, 390 / 844]) {
    for (let x = rooms[4]! + r; x <= rooms[6]! - r; x += 0.4) {
      for (let z = rooms[5]! + r; z <= GROTTO.enter; z += 0.4) {
        for (let deg = -ORBIT.maxDeg; deg <= ORBIT.maxDeg; deg += 17.5) {
          for (const zoom of [ORBIT.zoomMin, 1, ORBIT.zoomMax]) {
            cam.step(x, z, deg * DEG, zoom, aspect, 0, true);
            const p = cam.pose;
            const at = `${x.toFixed(1)},${z.toFixed(1)} ${deg} ${zoom} ${aspect.toFixed(2)}`;
            expect(p.x - 0.1, at).toBeGreaterThan(jambL);
            expect(p.x + 0.1, at).toBeLessThan(jambR);
            expect(p.y, at).toBeLessThan(ceilingY(p.x, p.z) - 0.25);
            expect(p.z, at).toBeLessThan(GROTTO.wallZ);
            // The frame never looks back past the mouth.
            const halfWide = Math.atan(Math.tan((p.fov / 2) * DEG) * aspect);
            expect(Math.abs(p.yaw) + halfWide, at).toBeLessThanOrEqual(GROTTO_EYE.edgeDeg * DEG + 1e-9);
            // The visitor's middle (0.6 m up) lies inside the frustum.
            const dx = x - p.x;
            const dz = p.z - z;
            const side = Math.atan2(dx, dz) - p.yaw;
            const up = -Math.atan2(p.y - 0.6, Math.hypot(dx, dz)) - p.pitch;
            const half = (p.fov / 2) * DEG;
            expect(Math.abs(up), at).toBeLessThan(half);
            expect(Math.abs(Math.tan(side)), at).toBeLessThan(Math.tan(half) * aspect);
          }
        }
      }
    }
  }
});

test('the low tier keeps the room with fewer rocks, and no stalactite reaches a head in the chamber', () => {
  const high = grottoRocks(false);
  const low = grottoRocks(true);
  expect(low.length).toBeLessThan(high.length);
  const rooms = GROTTO_ANNEX.rooms;
  for (const s of high.filter((k) => k.kind === 'stalactite')) {
    const over = s.x > rooms[4]! && s.x < rooms[6]! && s.z > rooms[5]! && s.z < rooms[7]!;
    if (over) expect(s.y - s.sy, `${s.x},${s.z}`).toBeGreaterThan(1.3);
  }
});
