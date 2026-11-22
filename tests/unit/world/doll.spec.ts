import { expect, test } from '@playwright/test';
import { Vector3 } from 'three';
import { createDoll, FIGURE, KIND, type Doll } from '../../../src/world/doll.ts';
import { HEAD, headPoint } from '../../../src/world/doll.head.ts';
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

/** The doll's largest turn (rad) from its resting heading over a nudge: `walkS` at `speed` m/s toward +x, then standing. */
function turnOnNudge(walkS: number, speed: number): number {
  const d = createDoll();
  const g = createGait();
  let x = 0;
  for (let t = 1; t < 2; t += 1 / 60) {
    stepGait(g, t, 1 / 60, 0, 0, false, false, 0);
    d.pose(g, x, 0, 1, -1, 0, 0, false);
  }
  const rest = d.root.heading;
  let most = 0;
  for (let t = 2; t < 3.5; t += 1 / 60) {
    const v = t < 2 + walkS ? speed : 0;
    x += v / 60;
    stepGait(g, t, 1 / 60, v, 0, false, false, 0);
    d.pose(g, x, 0, 1, -1, 0, 0, false);
    most = Math.max(most, Math.abs(Math.atan2(Math.sin(d.root.heading - rest), Math.cos(d.root.heading - rest))));
  }
  return most;
}

test('a nudge shorter than a step turns the doll by nothing; a real walk turns it to where it goes', () => {
  expect(turnOnNudge(0.04, 1.6), 'a 40 ms key tap').toBeLessThan(0.05);
  expect(turnOnNudge(0.1, 1.6), 'a tenth of a second').toBeLessThan(0.05);
  expect(turnOnNudge(0.6, 1.6), 'a walk east turns it east').toBeGreaterThan(0.8);
  expect(FIGURE.turnAfterM).toBeGreaterThan(0.15);
});

/** The head's outline seen along an axis: its widest half width across (`across` x or z) and that near the crown. */
function outline(across: 'x' | 'z'): { widest: number; crown: number; cheek: number; brow: number } {
  const p = new Vector3();
  const pts: [number, number][] = [];
  for (let i = 0; i < 180; i++) {
    for (let j = 0; j <= 90; j++) {
      headPoint((i * Math.PI) / 90, -Math.PI / 2 + (j * Math.PI) / 90, p);
      pts.push([Math.abs(p[across]), p.y - HEAD.y]);
    }
  }
  const top = Math.max(...pts.map(([, y]) => y));
  const band = (lo: number, hi: number): number => Math.max(...pts.filter(([, y]) => y >= lo && y <= hi).map(([w]) => w));
  return { widest: band(-1, 1), crown: band(0.85 * top, top), cheek: band(-0.12, 0), brow: band(0.05, 0.15) };
}

test('the head is a stuffed sack, not a ball: a flat crown from the front and the side, cheeks full low', () => {
  // An ellipse is 0.53 of its width at 85% of its height: the sack's crown stays far wider.
  for (const across of ['x', 'z'] as const) {
    const o = outline(across);
    expect(o.crown / o.widest, `crown seen across ${across}`).toBeGreaterThan(0.7);
  }
  const front = outline('x');
  expect(front.cheek).toBeGreaterThan(front.brow);
  expect(front.widest).toBeGreaterThan(HEAD.top * 1.2);
});

test('the sewn detail stays within the doll\'s triangle budget', () => {
  const d = createDoll();
  expect(d.index.length / 3).toBeLessThan(6500);
  expect(d.lanternFrom).toBeLessThan(d.position.length / 3);
});
