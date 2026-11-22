import { expect, test } from '@playwright/test';
import { createGait, DIP, GAIT, poseOf, stepGait, type Gait } from '../../../src/world/puppet.gait.ts';
import { ANTICIPATE, BACK_POSES, IDLE, SETTLE, SIDE_POSES, type Pose } from '../../../src/world/puppet.poses.ts';

const DT = 1 / 60;
const DEG = Math.PI / 180;

const mirrored = (p: Pose, back: boolean): Pose => ({
  ...p, hipA: back ? -p.hipB : p.hipB, hipB: back ? -p.hipA : p.hipA, footA: p.footB, footB: p.footA, kneeA: p.kneeB, kneeB: p.kneeA,
  torso: back ? -p.torso : p.torso, head: back ? -p.head : p.head,
});
const legs = (p: Pose): number[] => [p.hipA, p.hipB, p.footA, p.footB, p.kneeA, p.kneeB, p.torso, p.head, p.drop].map((v) => v + 0);

/** Walks at (vx, vz) m/s for `s` seconds from time t0; returns each frame's tick and the drawn state. */
interface Frame { tick: number; key: string; oct: number; view: string }
function walk(g: Gait, t0: number, s: number, vx: number, vz: number, o: { frozen?: boolean; reduced?: boolean; yaw?: number } = {}): Frame[] {
  const out: Frame[] = [];
  for (let t = t0; t < t0 + s; t += DT) {
    stepGait(g, t, DT, vx, vz, o.frozen ?? false, o.reduced ?? false, o.yaw ?? 0);
    out.push({ tick: Math.floor(t * GAIT.fps), key: `${g.oct} ${g.pose} ${g.idle} ${g.shift}`, oct: g.oct, view: g.view });
  }
  return out;
}
/** Ground velocity (m/s) walking at 1.5 m/s on a heading `deg` degrees from north, positive toward +x. */
const heading = (deg: number): [number, number] => [Math.sin(deg * DEG) * 1.5, -Math.cos(deg * DEG) * 1.5];

const octs = (frames: Frame[]): number[] => frames.map((f) => f.oct).filter((o, i, a) => i === 0 || o !== a[i - 1]);

test('the third and fourth poses are the first and second mirrored', () => {
  expect(legs(BACK_POSES[2]!)).toEqual(legs(mirrored(BACK_POSES[0]!, true)));
  expect(legs(BACK_POSES[3]!)).toEqual(legs(mirrored(BACK_POSES[1]!, true)));
  expect(legs(SIDE_POSES[2]!)).toEqual(legs(mirrored(SIDE_POSES[0]!, false)));
  expect(legs(SIDE_POSES[3]!)).toEqual(legs(mirrored(SIDE_POSES[1]!, false)));
  expect(SIDE_POSES[2]!.free).toBe(-SIDE_POSES[0]!.free);
});

test('the walk advances only on twos of 12 fps, at most one pose a tick, one pose per stride share', () => {
  const g = createGait();
  const frames = walk(g, 0, 3, 1.6, -0.1);
  let changes = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i]!.key === frames[i - 1]!.key) continue;
    changes++;
    expect(frames[i]!.tick).not.toBe(frames[i - 1]!.tick);
  }
  const poses = new Set<number>();
  const h = createGait();
  let steps = 0;
  let last = h.pose;
  for (let t = 0; t < 3; t += DT) {
    stepGait(h, t, DT, 0.1, -1.6, false, false);
    if (!h.idle && h.pose !== last) steps++;
    last = h.pose;
    poses.add(h.pose);
  }
  expect(poses.size).toBe(4);
  expect(steps).toBeGreaterThan((1.6 * 2.9) / GAIT.strideM - 3);
  expect(steps).toBeLessThan((1.6 * 3) / GAIT.strideM + 2);
  expect(changes).toBeGreaterThan(0);
  const fast = createGait();
  walk(fast, 0, 0.5, 0, -3.2);
  const ticks = walk(fast, 0.5, 1, 0, -3.2);
  const fastChanges = ticks.filter((f, i) => i > 0 && f.key !== ticks[i - 1]!.key).length;
  expect(fastChanges).toBeLessThanOrEqual(GAIT.fps);
});

test('eight directions of 45 degrees against the camera, each kept 10 degrees past its edge so it never flickers', () => {
  const g = createGait();
  for (const [deg, oct] of [[20, 0], [30, 0], [34, 1], [15, 1], [12, 0], [90, 2], [-90, 6], [-135, 5], [180, 4], [-45, 7]] as const) {
    walk(g, 0, 1, ...heading(deg));
    expect(g.oct, `${deg} degrees`).toBe(oct);
  }
  /** Swinging either side of a boundary changes nothing. */
  const edge = walk(g, 1, 2, ...heading(-22.5));
  for (let t = 3; t < 5; t += 0.1) edge.push(...walk(g, t, 0.1, ...heading(Math.sin(t * 40) > 0 ? -30 : -15)));
  expect(new Set(edge.slice(30).map((f) => f.oct)).size).toBe(1);
  /** The camera's yaw turns the sector: north seen from 35 degrees either side is a back diagonal, standing too. */
  for (const [yaw, oct] of [[35, 7], [-35, 1], [20, 0]] as const) {
    const h = createGait();
    walk(h, 0, 1, ...heading(0), { yaw: yaw * DEG });
    expect(h.oct, `walking north, yaw ${yaw}`).toBe(oct);
    walk(h, 1, 2, 0, 0, { yaw: yaw * DEG });
    expect([h.oct, h.idle], `standing, yaw ${yaw}`).toEqual([oct, true]);
  }
});

test('a change of direction steps through the directions between on the ticks, at most two poses between', () => {
  const g = createGait();
  walk(g, 0, 1, ...heading(0));
  expect(g.oct).toBe(0);
  const quarter = walk(g, 1, 1, ...heading(90));
  expect(octs(quarter)).toEqual([1, 2]);
  const ticks = quarter.filter((f, i) => i > 0 && f.oct !== quarter[i - 1]!.oct).map((f) => f.tick);
  expect([ticks.length, ticks[0]! - quarter[0]!.tick]).toEqual([1, 1]);
  /** A half turn goes round by the side the heading lies on: two poses between. */
  expect(octs(walk(g, 2, 1, ...heading(-179)))).toEqual([3, 4]);
  expect(octs(walk(g, 3, 1, ...heading(1)))).toEqual([2, 1, 0]);
  /** Reduced motion switches at once. */
  const r = createGait();
  walk(r, 0, 1, ...heading(0), { reduced: true });
  expect(octs(walk(r, 1, 1, ...heading(90), { reduced: true }))).toEqual([2]);
});

test('standing: the idle pose, the back view after a stepped turn from a profile, and the idle shift held for seconds', () => {
  const g = createGait();
  walk(g, 0, 1, 1.5, 0);
  expect(g.view).toBe('side');
  const stand = walk(g, 1, 12, 0, 0);
  expect(octs(stand)).toEqual([2, 1, 0]);
  expect(stand[Math.ceil((GAIT.idleAfterS + 0.35) / DT)]!.view).toBe('back');
  expect(g.idle).toBe(true);
  expect(g.view).toBe('back');
  const shifts = stand.filter((f, i) => i > 0 && f.key !== stand[i - 1]!.key && f.key.startsWith('0 ')).length;
  expect(shifts).toBeGreaterThanOrEqual(2);
  expect(shifts).toBeLessThanOrEqual(6);
});

test('stopping takes a short settling step in the walking view before the turn and the standing pose', () => {
  for (const [vx, vz, view] of [[1.5, 0, 'side'], [0, -1.5, 'back']] as const) {
    const g = createGait();
    walk(g, 0, 1, vx, vz);
    const seen: string[] = [];
    for (let t = 1; t < 2.5; t += DT) {
      stepGait(g, t, DT, 0, 0, false, false);
      const p = poseOf(g);
      const k = p === SETTLE[view] ? `settle ${g.view}` : p === IDLE ? 'idle' : 'walk';
      if (seen[seen.length - 1] !== k) seen.push(k);
    }
    expect(seen).toEqual(['walk', `settle ${view}`, 'idle']);
  }
});

test('reduced motion keeps one standing pose: no cycle, no stepped turn, no shift', () => {
  const g = createGait();
  const frames = walk(g, 0, 3, 1.5, -0.2, { reduced: true });
  expect(frames.every((f) => f.key.endsWith(' 0 true 0'))).toBe(true);
  expect(octs(frames)).toEqual([2]);
  walk(g, 3, 12, 0, 0, { reduced: true });
  expect([g.idle, g.oct, g.shift, g.pose]).toEqual([true, 0, 0, 0]);
  expect([g.cue, g.dip, g.lean, g.bank, g.breath, g.look, g.lift]).toEqual([0, 0, 0, 0, 0, 0, 0]);
});

test('setting off: one tick of crouch before the first stride, then the walk leans into the push and eases to the speed lean', () => {
  const g = createGait();
  const seen: string[] = [];
  const leans: number[] = [];
  for (let t = 0; t < 2; t += DT) {
    stepGait(g, t, DT, 2.4, 0, false, false);
    const p = poseOf(g);
    const k = p === ANTICIPATE.back || p === ANTICIPATE.side ? 'cue' : p === IDLE ? 'idle' : 'walk';
    if (seen[seen.length - 1] !== k) seen.push(k);
    leans.push(g.lean);
  }
  expect(seen).toEqual(['cue', 'walk']);
  const steady = leans[leans.length - 1]!;
  expect(Math.max(...leans)).toBeGreaterThan(steady + 2);
  expect(steady).toBeGreaterThan(1);
  expect(steady).toBeLessThan(3);
});

test('stopping: the body carries on past the stop, then the landing dip sinks and comes up before the idle', () => {
  const g = createGait();
  walk(g, 0, 1, 0, -2.4);
  const drops: number[] = [];
  let leanAtSettle = 0;
  for (let t = 1; t < 2; t += DT) {
    stepGait(g, t, DT, 0, 0, false, false);
    if (g.settle > 0) leanAtSettle = Math.max(leanAtSettle, g.lean);
    if (g.idle && drops[drops.length - 1] !== DIP[g.dip]) drops.push(DIP[g.dip]!);
  }
  expect(leanAtSettle).toBeGreaterThan(1);
  expect(drops).toEqual([DIP[3], DIP[2], DIP[1], DIP[0]]);
});
