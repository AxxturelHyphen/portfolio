import { expect, test } from '@playwright/test';
import { createDoll, FIGURE, KIND, type Doll } from '../../../src/world/doll.ts';
import { createGait, stepGait, type Gait } from '../../../src/world/puppet.gait.ts';

// The burlap doll (world/doll.ts): real geometry posed by the gait on the 12 fps tick.

/** World y range and the mean world xz of the vertices of `kind` (or all), by the root. */
function measure(d: Doll, kind?: number): { lo: number; hi: number; x: number; z: number } {
  const { x: rx, z: rz, lift, heading, k } = d.root;
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  let lo = Infinity, hi = -Infinity, x = 0, z = 0, n = 0;
  for (let i = 0; i < d.position.length / 3; i++) {
    if (kind !== undefined && d.paint[i * 4 + 3] !== kind) continue;
    if (kind === undefined && d.paint[i * 4 + 3] === KIND.shadow) continue;
    const [px, py, pz] = [d.position[i * 3]!, d.position[i * 3 + 1]!, d.position[i * 3 + 2]!];
    const y = k * (py + lift);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
    x += rx + k * (px * c + pz * s);
    z += rz + k * (pz * c - px * s);
    n++;
  }
  return { lo, hi, x: x / n, z: z / n };
}
function walked(vx: number, vz: number, s: number): Gait {
  const g = createGait();
  for (let t = 1; t < 1 + s; t += 1 / 60) stepGait(g, t, 1 / 60, vx, vz, false, false, 0);
  return g;
}

test('the doll stands on the ground, a short figure with a big head, in every walking pose', () => {
  const d = createDoll();
  expect(d.position.length / 3).toBeLessThan(65536);
  const g = createGait();
  for (let t = 1; t < 3; t += 1 / 60) {
    stepGait(g, t, 1 / 60, 0, -1.4, false, false, 0);
    d.pose(g, 0, 0, 1, -1, 0, 0, false);
    d.hang(0, 0);
    const m = measure(d);
    expect(m.lo).toBeGreaterThan(-0.004);
    expect(m.lo).toBeLessThan(0.035);
    expect(m.hi).toBeLessThan(FIGURE.topM + 0.06);
  }
});

test('walking away from the lens shows its back; standing it turns three quarters to the lens, its button eyes toward it', () => {
  const d = createDoll();
  const away = walked(0, -1.4, 1.5);
  for (let i = 0; i < 20; i++) d.pose(away, 0, 0, 1, -1, 0, 0, true);
  expect(measure(d, KIND.button).z).toBeLessThan(-0.1);
  const g = createGait();
  stepGait(g, 1, 1 / 60, 0, 0, true, false, 0);
  d.pose(g, 0, 0, 1, -1, 0, 0, true);
  const eyes = measure(d, KIND.button);
  expect(eyes.z).toBeGreaterThan(0.12);
  expect(Math.abs(eyes.x)).toBeGreaterThan(0.02);
});

test('the body re-poses only on the ticks; the lantern swings every frame from the grip', () => {
  const d = createDoll();
  const g = walked(1, 0, 1);
  expect(d.pose(g, 0, 0, 1, -1, 0, 0, false)).toBe(true);
  expect(d.pose(g, 0.01, 0, 1, -1, 0, 0, false)).toBe(false);
  d.hang(0, 0);
  const still = d.flame[0]!;
  d.hang(0.3, 0);
  expect(d.flame[0]).toBeGreaterThan(still + 0.02);
  expect(d.flame[1]).toBeLessThan(d.grip[1]!);
});
