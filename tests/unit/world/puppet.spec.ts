import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { AtlasManifest, QuadParams } from '../../../src/types.ts';
import { createGait, createPuppet, DIAG, FIGURE, mirrorOf, PINS, poseOf, SLOT, stepGait, type FigureRects, type Gait } from '../../../src/world/puppet.ts';
import { DIP, face, LIFE } from '../../../src/world/puppet.gait.ts';
import { ANTICIPATE, BACK_POSES, IDLE, REST, SETTLE, SIDE_POSES, type Pose } from '../../../src/world/puppet.poses.ts';

// The visitor's paper figure (cook/FIGURE_BUILD.md 4): pins, ground contact, the stepped gait and its views.

const manifest = JSON.parse(readFileSync(new URL('../../../public/atlas/roam.json', import.meta.url), 'utf8')) as AtlasManifest;
const rects = manifest.sprites as unknown as FigureRects;
/** One pixel of the figure at 1080 (1.35 m is about 197 px tall). */
const PX = FIGURE.topM / 197;
const DT = 1 / 60;
const DEG = Math.PI / 180;

/** World x, y of a sprite fraction on a written quad (the shader's corner, pivot, flip and turn). */
function at(q: QuadParams, f: readonly number[]): [number, number] {
  const flip = (q.uv[2] ?? 0) < (q.uv[0] ?? 0);
  const lx = ((flip ? 1 - f[0]! : f[0]!) - q.px) * q.w;
  const ly = (f[1]! - q.py) * q.h;
  const c = Math.cos(q.rot);
  const s = Math.sin(q.rot);
  return [q.x + c * lx - s * ly, q.y + s * lx + c * ly];
}
function expectAt(q: QuadParams, x: number, y: number): void {
  expect(Math.hypot(q.x - x, q.y - y)).toBeLessThan(PX);
}
const soleOf = (q: QuadParams, rectH: number): number => {
  const pad = 8 / (rectH * FIGURE.pagePx);
  return Math.min(at(q, [pad, pad])[1], at(q, [1 - pad, pad])[1]);
};

type Q11 = [QuadParams, QuadParams, QuadParams, QuadParams, QuadParams, QuadParams, QuadParams, QuadParams, QuadParams, QuadParams, QuadParams];

/** A gait drawing octant `oct` (0 back, 2 right, 4 front, 6 left), in a pose. */
function gaitOf(oct: number, pose: number, idle: boolean): Gait {
  const g = { ...createGait(), pose, idle };
  face(g, oct);
  return g;
}
const BACK = 0;
const SIDE = 2;

const STATES: Gait[] = [];
for (let oct = 0; oct < 8; oct++) {
  STATES.push(gaitOf(oct, 0, true));
  for (let p = 0; p < 4; p++) STATES.push(gaitOf(oct, p, false));
  STATES.push({ ...gaitOf(oct, 0, false), cue: 1, lean: 6, bank: -4 });
}

test('every part hangs from its parent pin within a pixel, in every pose, direction, carrying side and scale', () => {
  const puppet = createPuppet(rects);
  for (const g of STATES.flatMap((s) => [[s, 1], [s, -1]] as const)) {
    for (const k of [1, FIGURE.portraitK]) {
      const [gait, hand] = g;
      const m = mirrorOf(gait, hand);
      puppet.place(gait, 3, -2, k, m);
      const q = puppet.quads;
      const side = gait.view === 'side';
      const diag = gait.oct % 2 === 1;
      /** Slots of torso, head, neckerchief, free arm and hand, carrying arm and hand, shin A, thigh A, shin B, thigh B. */
      const slots = side ? [8, 7, 9, 2, 1, 11, 10, 3, 4, 5, 6] : [10, 9, 11, 7, 5, 8, 6, 3, 4, 1, 2];
      const [torso, head, scarf, freeArm, freeHand, crookArm, crookHand, shinA, thighA, shinB, thighB] = slots.map((i) => q[i]!) as Q11;
      const neck = at(torso, PINS.neck);
      const headX = side ? m * FIGURE.headFwdM * (diag ? DIAG.headFwd : 1) : diag ? gait.dir * DIAG.headM : 0;
      expectAt(head, neck[0] + headX * k, neck[1] + FIGURE.headLiftM * k);
      expectAt(scarf, ...neck);
      const shoulderFree = at(torso, side ? PINS.sideShoulder : PINS.shoulderL);
      const shoulderCrook = at(torso, side ? PINS.sideShoulder : PINS.shoulderR);
      /** In the back view each sleeve hangs out from its shoulder pin by a share of its drawn width; both sit a little under it. */
      const out = (q: QuadParams): number => (side ? 0 : FIGURE.armOut * q.w);
      const drop = FIGURE.armDropM * k;
      expectAt(freeArm, shoulderFree[0] - m * out(freeArm), shoulderFree[1] - drop);
      expectAt(crookArm, shoulderCrook[0] + m * out(crookArm), shoulderCrook[1] - drop);
      expectAt(freeHand, ...at(freeArm, PINS.cuff));
      expectAt(crookHand, ...at(crookArm, PINS.cuffBent));
      if (!side) {
        const hipL = at(torso, PINS.hipL);
        const hipR = at(torso, PINS.hipR);
        expectAt(thighA, hipL[0] + m * FIGURE.hipInM * k, hipL[1]);
        expectAt(thighB, hipR[0] - m * FIGURE.hipInM * k, hipR[1]);
      } else {
        const hip = FIGURE.hipM * k * (diag ? DIAG.hipK : 1);
        expectAt(thighA, torso.x - m * hip, torso.y);
        expectAt(thighB, torso.x + m * hip, torso.y);
      }
      expectAt(shinA, ...at(thighA, side ? PINS.kneeR : PINS.kneeL));
      expectAt(shinB, ...at(thighB, PINS.kneeR));
      const grip = at(crookHand, PINS.grip);
      expect(Math.hypot(grip[0] - puppet.grip[0]!, grip[1] - puppet.grip[1]!)).toBeLessThan(1e-4);
      const hA = side ? rects['fg/shin-r'].uv[3] - rects['fg/shin-r'].uv[1] : rects['fg/shin-l'].uv[3] - rects['fg/shin-l'].uv[1];
      const hB = rects['fg/shin-r'].uv[3] - rects['fg/shin-r'].uv[1];
      const soles = [soleOf(shinA, hA), soleOf(shinB, hB)];
      const p = poseOf(gait);
      const want = [p.footA, p.footB];
      const planted = Math.min(...want);
      for (let i = 0; i < 2; i++) {
        if (want[i] === planted) expect(Math.abs(soles[i]!), `${gait.oct} ${gait.pose} planted sole on the ground line`).toBeLessThan(PX);
        else expect(soles[i]!).toBeGreaterThan(PX);
      }
      expect(Math.max(...soles)).toBeLessThan(0.2 * k);
      expect(at(head, [0.5, 1])[1]).toBeLessThan((FIGURE.topM + 0.05) * k);
      expect(at(head, [0.5, 1])[1]).toBeGreaterThan((FIGURE.topM - 0.06) * k);
    }
  }
});

test('the contact shadow lies at the ground point and its paper, the halo, is centred on the flame', () => {
  const puppet = createPuppet(rects);
  puppet.place(gaitOf(BACK, 0, true), 3, -2, 1, 1);
  const shadow = puppet.quads[SLOT.shadow]!;
  expect([shadow.y, shadow.z, shadow.py]).toEqual([0, -2, 0]);
  expect(Math.abs(shadow.x - 3)).toBeLessThan(0.02);
  expect(Array.from(shadow.uv)).toEqual(rects['fg/glow'].uv);
  puppet.halo(2.8, 0.45);
  /** The decal stays at the quad's x and z (under the soles); the paper's centre moves to the flame. */
  expect(Math.abs(shadow.x - 3)).toBeLessThan(0.02);
  const centre = at(shadow, [0.5, 0.5]);
  expect(centre[0]).toBeCloseTo(2.8, 6);
  expect(centre[1]).toBeCloseTo(0.45, 6);
});

const mirrored = (p: Pose, back: boolean): Pose => ({
  ...p, hipA: back ? -p.hipB : p.hipB, hipB: back ? -p.hipA : p.hipA, footA: p.footB, footB: p.footA, kneeA: p.kneeB, kneeB: p.kneeA,
  torso: back ? -p.torso : p.torso, head: back ? -p.head : p.head,
});
const legs = (p: Pose): number[] => [p.hipA, p.hipB, p.footA, p.footB, p.kneeA, p.kneeB, p.torso, p.head, p.drop].map((v) => v + 0);

test('the third and fourth poses are the first and second mirrored', () => {
  expect(legs(BACK_POSES[2]!)).toEqual(legs(mirrored(BACK_POSES[0]!, true)));
  expect(legs(BACK_POSES[3]!)).toEqual(legs(mirrored(BACK_POSES[1]!, true)));
  expect(legs(SIDE_POSES[2]!)).toEqual(legs(mirrored(SIDE_POSES[0]!, false)));
  expect(legs(SIDE_POSES[3]!)).toEqual(legs(mirrored(SIDE_POSES[1]!, false)));
  expect(SIDE_POSES[2]!.free).toBe(-SIDE_POSES[0]!.free);
});

test('the carrying arm turns at most a degree between poses, so the lantern bobs on the steps without jitter', () => {
  const puppet = createPuppet(rects);
  for (const view of ['back', 'side'] as const) {
    const poses = view === 'back' ? BACK_POSES : SIDE_POSES;
    let prev: [number, number, number] | null = null;
    for (let i = 0; i <= poses.length; i++) {
      puppet.place(gaitOf(view === 'back' ? BACK : SIDE, i % poses.length, false), 0, 0, 1, 1);
      const now: [number, number, number] = [puppet.grip[0]!, puppet.grip[1]!, puppet.quads[view === 'back' ? 8 : 11]!.rot];
      if (prev !== null) {
        expect(Math.abs(now[2] - prev[2])).toBeLessThanOrEqual(1 * DEG + 1e-9);
        /** The grip follows the body over the planted foot and its rise and fall (readable from behind): a step, not a jump. */
        expect(Math.hypot(now[0] - prev[0], now[1] - prev[1])).toBeLessThan(0.06);
      }
      prev = now;
    }
  }
});

/** Walks at (vx, vz) m/s for `s` seconds from time t0; returns each frame's tick and the drawn state. */
interface Frame { tick: number; key: string; oct: number; view: string }
function walk(g: Gait, t0: number, s: number, vx: number, vz: number, o: { frozen?: boolean; reduced?: boolean; yaw?: number } = {}): Frame[] {
  const out: Frame[] = [];
  for (let t = t0; t < t0 + s; t += DT) {
    stepGait(g, t, DT, vx, vz, o.frozen ?? false, o.reduced ?? false, o.yaw ?? 0);
    out.push({ tick: Math.floor(t * FIGURE.fps), key: `${g.oct} ${g.pose} ${g.idle} ${g.shift}`, oct: g.oct, view: g.view });
  }
  return out;
}
/** Ground velocity (m/s) walking at 1.5 m/s on a heading `deg` degrees from north, positive toward +x. */
const heading = (deg: number): [number, number] => [Math.sin(deg * DEG) * 1.5, -Math.cos(deg * DEG) * 1.5];
/** The distinct octants a run of frames passes through, in order. */
const octs = (frames: Frame[]): number[] => frames.map((f) => f.oct).filter((o, i, a) => i === 0 || o !== a[i - 1]);

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
  expect(steps).toBeGreaterThan((1.6 * 2.9) / FIGURE.strideM - 3);
  expect(steps).toBeLessThan((1.6 * 3) / FIGURE.strideM + 2);
  expect(changes).toBeGreaterThan(0);
  const fast = createGait();
  walk(fast, 0, 0.5, 0, -3.2);
  const ticks = walk(fast, 0.5, 1, 0, -3.2);
  const fastChanges = ticks.filter((f, i) => i > 0 && f.key !== ticks[i - 1]!.key).length;
  expect(fastChanges).toBeLessThanOrEqual(FIGURE.fps);
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

test('the lantern stays in the carrying hand: beside it from behind and on the back diagonals, across the body from the front', () => {
  const puppet = createPuppet(rects);
  for (const hand of [1, -1]) {
    for (const [oct, side] of [[0, hand], [1, hand], [7, hand], [4, -hand]] as const) {
      const g = gaitOf(oct, 0, true);
      puppet.place(g, 3, -2, 1, mirrorOf(g, hand));
      expect(Math.sign(puppet.grip[0]! - 3), `octant ${oct}, hand ${hand}`).toBe(side);
    }
  }
  /** The diagonals are the views squashed toward the heading: narrower from behind, wider than the profile in front. */
  const torsoW = (oct: number): number => {
    puppet.place(gaitOf(oct, 0, true), 0, 0, 1, 1);
    return puppet.quads[gaitOf(oct, 0, true).view === 'back' ? 10 : 8]!.w;
  };
  expect(torsoW(1)).toBeLessThan(torsoW(0));
  expect(torsoW(3)).toBeGreaterThan(torsoW(2));
});

test('the figure lies on a card facing the camera: turned by its yaw about the ground point, the drawing unchanged', () => {
  const puppet = createPuppet(rects);
  const g = gaitOf(SIDE, 1, false);
  puppet.place(g, 3, -2, 1, 1);
  const flat = puppet.quads.slice(0, SLOT.handle).map((q) => [q.x, q.y, q.rot, q.w, q.h] as const);
  const grip = Array.from(puppet.grip);
  const yaw = 30 * DEG;
  puppet.place(g, 3, -2, 1, 1, 0, yaw);
  expect(Array.from(puppet.grip)).toEqual(grip);
  flat.forEach(([x, y, rot, w, h], i) => {
    const q = puppet.quads[i]!;
    expect(q.facing).toBeCloseTo(-yaw, 9);
    expect([q.y, q.rot, q.w, q.h]).toEqual([y, rot, w, h]);
    expect(q.x).toBeCloseTo(3 + Math.cos(yaw) * (x - 3), 9);
    expect(q.z).toBeCloseTo(-2 + Math.sin(yaw) * (x - 3), 9);
  });
});

test('the free arm swings opposite the legs within a few degrees of hanging, never held out from the body', () => {
  for (const [poses, rest] of [[BACK_POSES, REST.freeArm], [SIDE_POSES, REST.sideFree]] as const) {
    for (const p of [...poses, IDLE]) expect(Math.abs(rest - p.free)).toBeLessThanOrEqual(18);
  }
  expect(Math.abs(REST.freeArm)).toBeLessThanOrEqual(4);
  const backSwing = BACK_POSES.map((p) => p.free);
  expect(Math.sign(backSwing[0]!)).toBe(-Math.sign(backSwing[2]!));
  /** The swing reads at 120 px: over twenty-five degrees from one step to the next, from behind and in profile. */
  expect(Math.abs(backSwing[0]! - backSwing[2]!)).toBeGreaterThanOrEqual(25);
  expect(Math.abs(SIDE_POSES[0]!.free - SIDE_POSES[2]!.free)).toBeGreaterThanOrEqual(25);
  /** The profile step stays calm: the legs within 15 degrees of upright, the passing knee folded well past 30. */
  for (const p of SIDE_POSES) expect(Math.max(Math.abs(p.hipA), Math.abs(p.hipB))).toBeLessThanOrEqual(15);
  expect(Math.max(SIDE_POSES[1]!.kneeA, SIDE_POSES[3]!.kneeB)).toBeGreaterThanOrEqual(30);
  expect(BACK_POSES[0]!.freeH).not.toBe(BACK_POSES[2]!.freeH);
  const puppet = createPuppet(rects);
  for (const view of ['back', 'side'] as const) {
    for (let i = 0; i < 4; i++) {
      puppet.place(gaitOf(view === 'back' ? BACK : SIDE, i, false), 0, 0, 1, 1);
      const arm = puppet.quads[view === 'back' ? 7 : 2]!;
      const fromHanging = Math.abs(arm.rot) / DEG;
      expect(fromHanging, `${view} ${i} free arm`).toBeLessThanOrEqual(18);
    }
  }
});

test('the back-view stride lifts the stepping foot clearly, alternates feet and rises and falls on the steps', () => {
  const lift = BACK_POSES.map((p) => Math.max(p.footA, p.footB));
  expect(Math.max(...lift)).toBeGreaterThanOrEqual(0.12);
  expect(Math.min(...lift)).toBeGreaterThan(0.03);
  expect(BACK_POSES[1]!.footA).toBeGreaterThan(0.1);
  expect(BACK_POSES[3]!.footB).toBeGreaterThan(0.1);
  expect(BACK_POSES[1]!.footB).toBe(0);
  expect(BACK_POSES[3]!.footA).toBe(0);
  const drops = BACK_POSES.map((p) => p.drop);
  expect(Math.max(...drops) - Math.min(...drops)).toBeGreaterThanOrEqual(0.02);
  const puppet = createPuppet(rects);
  const lifted: number[] = [];
  for (let i = 0; i < 4; i++) {
    puppet.place(gaitOf(BACK, i, false), 0, 0, 1, 1);
    const h = (id: 'fg/shin-l' | 'fg/shin-r'): number => rects[id].uv[3] - rects[id].uv[1];
    lifted.push(Math.max(soleOf(puppet.quads[3]!, h('fg/shin-l')), soleOf(puppet.quads[1]!, h('fg/shin-r'))));
  }
  expect(lifted[1]!).toBeGreaterThan(0.1);
  expect(lifted[3]!).toBeGreaterThan(0.1);
});

test('standing: the idle pose, the back view after a stepped turn from a profile, and the idle shift held for seconds', () => {
  const g = createGait();
  walk(g, 0, 1, 1.5, 0);
  expect(g.view).toBe('side');
  const stand = walk(g, 1, 12, 0, 0);
  expect(octs(stand)).toEqual([2, 1, 0]);
  expect(stand[Math.ceil((FIGURE.idleAfterS + 0.35) / DT)]!.view).toBe('back');
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

test('seen from behind the walk banks toward the side it swings to', () => {
  const g = createGait();
  walk(g, 0, 1, 0, -2.4);
  walk(g, 1, 0.3, 1.2, -2);
  expect(g.view).toBe('back');
  expect(g.bank).toBeGreaterThan(1);
  const puppet = createPuppet(rects);
  for (const mirror of [1, -1]) {
    puppet.place(g, 0, 0, 1, mirror);
    const torso = puppet.quads[10]!;
    /** The smock's top leans toward world +x whichever hand carries the lantern. */
    expect(at(torso, [0.5, 1])[0] - at(torso, [0.5, 0])[0]).toBeGreaterThan(0.01);
  }
});

test('standing still breathes, glances about and, after six seconds, lifts the lantern with the head turned to it', () => {
  const g = createGait();
  const puppet = createPuppet(rects);
  walk(g, 0, 1, 0, -1.5);
  let breathMin = 0;
  let breathMax = 0;
  let lookFree = 0;
  let firstLift = NaN;
  let gripRise = 0;
  puppet.place(gaitOf(BACK, 0, true), 0, 0, 1, 1);
  const restGrip = puppet.grip[1]!;
  for (let t = 1; t < 16; t += DT) {
    stepGait(g, t, DT, 0, 0, false, false);
    breathMin = Math.min(breathMin, g.breath);
    breathMax = Math.max(breathMax, g.breath);
    lookFree = Math.min(lookFree, g.look);
    if (g.lift > 0 && Number.isNaN(firstLift)) firstLift = g.idleS;
    if (g.lift === 1) {
      expect(g.look).toBeCloseTo(LIFE.liftLook, 6);
      puppet.place(g, 0, 0, 1, 1);
      gripRise = Math.max(gripRise, puppet.grip[1]! - restGrip);
    }
  }
  expect(breathMax - breathMin).toBeGreaterThan(1.9);
  expect(lookFree).toBeLessThan(-0.99);
  expect(firstLift).toBeGreaterThan(5.9);
  expect(firstLift).toBeLessThan(6.2);
  expect(gripRise).toBeGreaterThan(0.08);
  expect(g.lift).toBe(0);
});

test('frozen time gives the pose for heading and speed at once, the same on every run', () => {
  const run = (vx: number, vz: number): string => {
    const g = createGait();
    const puppet = createPuppet(rects);
    walk(g, 12.5, 0.2, vx, vz, { frozen: true });
    puppet.place(g, 1, 1, 1, mirrorOf(g, 1));
    return JSON.stringify(puppet.quads.map((q) => [q.x, q.y, q.rot, q.w, q.h, Array.from(q.uv)]));
  };
  expect(run(2, 0)).toBe(run(2, 0));
  const g = createGait();
  walk(g, 12.5, 0.2, 2, 0, { frozen: true });
  expect([g.view, g.dir, g.oct, g.pose, g.idle]).toEqual(['side', 1, 2, 0, false]);
  walk(g, 12.5, 0.2, 0, 0, { frozen: true });
  expect(g.idle).toBe(true);
  const still = createGait();
  walk(still, 12.5, 0.2, 0, 0, { frozen: true });
  expect([still.view, still.idle]).toEqual(['back', true]);
});
