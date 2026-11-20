import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { BOSS, createBoss, createBossRun, createChain, type BossDef } from '../../../src/world/boss.ts';
import { MOTIONS, createPose } from '../../../src/world/boss.motions.ts';
import { validateBoss } from '../../../src/world/boss.schema.ts';
import type { Clock, CutoutBatch, InstanceWriter, Machine, QuadParams, SpriteRect } from '../../../src/types.ts';

// The archive bosses (src/world/boss.ts, cook/PLAN_3D.md F5): content files pass the build-time schema, the hinge chain
// carries children with their parents, a boss plays once per visit after the visitor settles, any input lands the end
// pose, reduced motion and the low tier show the end pose with no camera moment, and a missing sprite leaves it out.

const dir = new URL('../../../content/bosses/', import.meta.url);
const rect = (w: number, h: number, page = 0): SpriteRect => ({ page, uv: [0, 0, 1, 1], size: [w, h], pivot: [0.5, 0], pad: 0, sources: [] });
const SPRITES: Record<string, SpriteRect> = { 'fx/stem': rect(0.2, 1), 'fx/lobe': rect(0.5, 0.3), 'fx/leaf': rect(0.4, 0.2) };
const part = (role: string, sprite: string, parent: string | null, offset: [number, number], rest = 0, z = 0) => ({ role, sprite, parent, pivot: [0.5, 1] as [number, number], offset, z, rest });
const FIXTURE: BossDef = {
  id: 'fixture-trap', bed: 'gruta', at: [33, 0, -2], scale: 2, motion: 'flytrap',
  parts: [
    part('lobeTop', 'fx/lobe', 'lobeBottom', [0, 0.1], 0, 3),
    part('stem', 'fx/stem', null, [0, 0], 0, 0),
    part('lobeBottom', 'fx/lobe', 'stem', [0, 1], 90, 2),
    part('leaf1', 'fx/leaf', 'stem', [0, 0.3], 0, 1),
    part('leaf2', 'fx/leaf', 'stem', [0, 0.5], 0, 1),
    part('leaf3', 'fx/leaf', 'stem', [0, 0.7], 0, 1),
  ],
};

function recorder() {
  const quads: QuadParams[] = [];
  const writer: InstanceWriter = { capacity: 8, count: 0, set: (i, q) => { quads[i] = { ...q }; }, commit: () => undefined };
  return { quads, writer };
}
const clock = (t: number, frozen = false): Clock => ({ now: t * 1000, dt: 1 / 60, t, frame: Math.round(t * 60), frozen });
const trap = MOTIONS['flytrap']!;

test('every content/bosses file passes the schema and names its file; broken files list their errors', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  expect(files).toContain('peacock.json');
  for (const f of files) validateBoss(JSON.parse(readFileSync(new URL(f, dir), 'utf8')), f.replace(/\.json$/, ''));
  validateBoss(FIXTURE, 'fixture-trap');
  const broken = { ...FIXTURE, motion: 'flytrap', parts: FIXTURE.parts.slice(0, 2).map((p) => ({ ...p, parent: p.role === 'stem' ? null : 'ghost' })) };
  expect(() => validateBoss(broken, 'fixture-trap')).toThrow(/needs role lobeBottom[\s\S]*no part has role ghost/);
  expect(() => validateBoss({ ...FIXTURE, motion: 'dragon' }, 'fixture-trap')).toThrow(/motion/);
});

test('the hinge chain: a child hangs from its parent pivot, turns with it and rides its seen length', () => {
  const chain = createChain(FIXTURE, SPRITES)!;
  const { quads, writer } = recorder();
  const pose = createPose(trap.roles);
  chain.write(pose, writer);
  expect(writer.count).toBe(6);
  expect(quads.map((q) => q.z)).toEqual([...quads.map((q) => q.z)].sort((a, b) => a - b));
  const metres = FIXTURE.scale / 1;
  const stem = quads[0]!;
  expect(stem.h).toBeCloseTo(2);
  expect(stem.py).toBe(0);
  const bottom = quads[4]!;
  expect(bottom.x).toBeCloseTo(33);
  expect(bottom.y).toBeCloseTo(1);
  expect(bottom.rot).toBeCloseTo(Math.PI / 2);
  expect(bottom.w).toBeCloseTo(0.5 * metres);
  // The top lobe hangs 0.1 m up the bottom lobe's frame, which is turned 90 degrees: 0.1 m toward -x.
  const top = quads[5]!;
  expect(top.x).toBeCloseTo(33 - 0.1);
  expect(top.y).toBeCloseTo(1);
  expect(top.rot).toBeCloseTo(Math.PI / 2);
  pose.parts['stem']!.sy = 0.5;
  pose.parts['lobeBottom']!.angle = -90;
  chain.write(pose, writer);
  expect(quads[0]!.h).toBeCloseTo(1);
  expect(quads[4]!.y).toBeCloseTo(0.5);
  expect(quads[5]!.rot).toBeCloseTo(0);
  expect(quads[5]!.y).toBeCloseTo(0.6);
});

test('a missing sprite or a split page leaves the boss out, quietly', () => {
  const noLeaf = Object.fromEntries(Object.entries(SPRITES).filter(([id]) => id !== 'fx/leaf'));
  expect(createChain(FIXTURE, noLeaf)).toBeNull();
  expect(createChain(FIXTURE, { ...SPRITES, 'fx/leaf': rect(0.4, 0.2, 1) })).toBeNull();
  const machine = { state: {}, ch: {} } as unknown as Machine;
  let batches = 0;
  const kit = { def: FIXTURE, sprites: noLeaf, machine, visitor: null, low: false, own: () => undefined, batch: () => { batches++; return {} as CutoutBatch; } };
  expect(createBoss(kit)).toBeNull();
  expect(batches).toBe(0);
});

test('plays once per visit, after the visitor has settled in the bed, then rests in its idle loop', () => {
  const played = new Set<string>();
  const run = createBossRun({ id: 'fixture-trap', motion: trap, fixed: false, played });
  let t = 0;
  const frame = (here: boolean): void => {
    t += 1 / 60;
    run.step(clock(t), here, false);
  };
  for (let i = 0; i < 120; i++) frame(false);
  expect(run.phase).toBe('wait');
  for (let i = 0; i < Math.ceil(BOSS.settleS * 60) - 2; i++) frame(true);
  expect(run.phase, 'not before the camera settles').toBe('wait');
  for (let i = 0; i < 4; i++) frame(true);
  expect(run.phase).toBe('play');
  const versions = new Set<number>();
  let peak = 0;
  for (let i = 0; i < trap.seconds * 60 + 10; i++) {
    frame(true);
    versions.add(run.version);
    peak = Math.max(peak, run.moment);
  }
  expect(run.phase).toBe('idle');
  expect(peak, 'camera moment').toBeGreaterThan(0.9);
  expect(versions.size, 'stepped on the 12 fps clock').toBeLessThanOrEqual(trap.seconds * 12 + 3);
  for (let i = 0; i < 60; i++) frame(true);
  expect(run.moment).toBe(0);
  const again = createBossRun({ id: 'fixture-trap', motion: trap, fixed: false, played });
  again.step(clock(t), true, false);
  expect(again.phase, 'streamed back in: no second display').toBe('idle');
  expect(again.busy).toBe(false);
});

test('any input lands the end pose; reduced motion and the low tier show it with no camera moment', () => {
  const end = createPose(trap.roles);
  trap.idle(end, 0);
  const run = createBossRun({ id: 'a', motion: trap, fixed: false, played: new Set() });
  let t = 0;
  for (let i = 0; i < 90; i++) run.step(clock((t += 1 / 60)), true, false);
  expect(run.phase).toBe('play');
  run.skip();
  run.step(clock((t += 1 / 60)), true, false);
  expect(run.phase).toBe('idle');
  expect(run.pose.parts['lobeTop']!.angle).toBeCloseTo(end.parts['lobeTop']!.angle);
  expect(run.moment, 'the camera eases back, it does not jump').toBeGreaterThan(0);

  const reduced = createBossRun({ id: 'b', motion: trap, fixed: false, played: new Set() });
  reduced.step(clock(1), true, true);
  expect(reduced.phase).toBe('idle');
  expect(reduced.moment).toBe(0);
  expect(reduced.pose.parts['stem']!.sy).toBeCloseTo(end.parts['stem']!.sy);
  const v = reduced.version;
  for (let i = 0; i < 60; i++) reduced.step(clock(1 + i / 12), true, true);
  expect(reduced.version, 'no idle motion').toBe(v);

  const low = createBossRun({ id: 'c', motion: trap, fixed: true, played: new Set() });
  for (let i = 0; i < 60; i++) low.step(clock(i / 12), i > 10, false);
  expect(low.phase).toBe('idle');
  expect(low.moment).toBe(0);
  expect(low.pose.parts['lobeTop']!.angle).toBeCloseTo(end.parts['lobeTop']!.angle);
});

test('every motion lasts 4 to 6 s and its idle loop starts at its end pose', () => {
  for (const [id, m] of Object.entries(MOTIONS)) {
    expect(m.seconds, id).toBeGreaterThanOrEqual(4);
    expect(m.seconds, id).toBeLessThanOrEqual(6);
    const a = createPose(m.roles);
    const b = createPose(m.roles);
    m.play(a, m.seconds);
    m.idle(b, 0);
    expect({ ...b, parts: undefined }, id).toEqual({ ...a, parts: undefined });
    for (const r of m.roles) expect(b.parts[r]!.angle, `${id} ${r}`).toBeCloseTo(a.parts[r]!.angle, 1);
  }
});
