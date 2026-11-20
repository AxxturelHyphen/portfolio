import { expect, test } from '@playwright/test';
import estanque from '../../../src/world/behaviours/estanque.ts';
import type { StreamBedCtx } from '../../../src/world/bed.ts';
import type { BossPhase } from '../../../src/world/boss.ts';
import type { Clock, InstanceWriter, SpriteRect } from '../../../src/types.ts';

// The Estanque peacock as the free-roam boss (src/world/behaviours/estanque.ts): a first visit holds the fan shut while
// the boss waits, so the display opens it from shut instead of snapping it closed; the grown bird grows its reflection.

const rect = (w: number, h: number): SpriteRect => ({ page: 0, uv: [0, 0, 1, 1], size: [w, h], pivot: [0.5, 0], pad: 0, sources: [] });
const reflect = { w: 1.25, colour: [0.8, 0.8, 0.8] };

function setup() {
  const run = { phase: 'wait' as BossPhase, version: 0, pose: { grow: 0, display: 0, turn: 0 } };
  const writer: InstanceWriter = { capacity: 32, count: 0, set: () => undefined, commit: () => undefined };
  const sized: number[][] = [];
  const ctx = {
    actors: writer,
    machine: { state: { mode: 'garden', bed: 'estanque', phase: 'bed', reduced: false } },
    scene: { id: 'estanque', layers: [{ items: [
      { sprite: 'es/lily', x: 18, y: 0, z: -2, scale: 1, h: 1, reflect },
      { sprite: 'es/peacock', x: 20, y: 0, z: -5.3, scale: 1, h: 2, hinge: -6, reflect, only: 'roam' },
    ] }] },
    sprites: { 'es/plume-1': rect(1, 0.2), 'es/peacock': rect(0.6, 1) },
    boss: { def: { scale: 3.2 }, run, own: () => undefined },
    rig: { pose: { x: 20, z: 6 } },
    mode: 'roam',
    setReflector: (...a: number[]) => sized.push(a),
  } as unknown as StreamBedCtx;
  const fan = estanque(ctx);
  let t = 0;
  const step = (): void => {
    t += 1 / 60;
    const c: Clock = { now: t * 1000, dt: 1 / 60, t, frame: Math.round(t * 60), frozen: false };
    fan.update?.(c);
  };
  return { run, writer, sized, step };
}

test('the fan stays shut while the boss waits, then opens on its display', () => {
  const { run, writer, step } = setup();
  for (let i = 0; i < 120; i++) step();
  expect(writer.count, 'no plume rises before the display').toBe(0);
  run.phase = 'play';
  run.pose.display = 0.5;
  run.version++;
  step();
  expect(writer.count).toBeGreaterThan(0);
});

test('the grown boss scales its own reflector in the water', () => {
  const { run, sized, step } = setup();
  run.phase = 'play';
  run.pose.grow = 1;
  run.version++;
  step();
  expect(sized.at(-1)).toEqual([1, 3.2, 1.25 * 3.2 / 2]);
});
