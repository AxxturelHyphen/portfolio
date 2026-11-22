import { expect, test } from '@playwright/test';
import { Mesh } from 'three';
import { SolidBuilder } from '../../../src/gl/masonry.ts';
import { peacockHeadInto } from '../../../src/gl/peacock.head.ts';
import { peacockHead } from '../../../src/world/peacock.head.ts';
import estanque from '../../../src/world/behaviours/estanque.ts';
import type { StreamBedCtx } from '../../../src/world/bed.ts';
import type { BossPhase } from '../../../src/world/boss.ts';
import type { Clock, InstanceWriter, SpriteRect } from '../../../src/types.ts';

// The Estanque peacock as the free-roam boss (src/world/behaviours/estanque.ts): a first visit holds the fan shut while
// the boss waits, so the display opens it from shut instead of snapping it closed; the grown bird grows its reflection
// and keeps its upright head on its shoulders.

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
  return { run, writer, sized, step, fan };
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

test('the head stands on the body from the wait to the grown boss and goes with the bed', () => {
  const solids = new SolidBuilder();
  const bind = peacockHeadInto(solids);
  const mesh = new Mesh(solids.geometry());
  bind(mesh);
  const at = mesh.geometry.getAttribute('position');
  /** The neck's foot (the lowest vertex) and the head's top, in the bird's heights from its foot at (20, 0, -5.3). */
  const span = (size: number) => {
    let low = 0;
    let top = -Infinity;
    for (let i = 0; i < at.count; i++) {
      if (at.getY(i) < at.getY(low)) low = i;
      top = Math.max(top, at.getY(i));
    }
    return { foot: at.getY(low) / size, across: Math.abs(at.getX(low) - 20) / size, out: (at.getZ(low) + 5.3) / size, top: top / size };
  };
  expect(span(1).top, 'hidden until the bird is placed').toBe(0);
  const { run, step, fan } = setup();
  step();
  for (const size of [2, 3.2]) {
    const s = span(size);
    expect(s.foot, `the neck leaves the body's top at ${size} m`).toBeGreaterThan(0.75);
    expect(s.foot).toBeLessThan(0.85);
    expect(s.across).toBeLessThan(0.1);
    expect(s.out).toBeGreaterThan(0);
    expect(s.top).toBeGreaterThan(1.3);
    expect(s.top).toBeLessThan(1.5);
    run.phase = 'play';
    run.pose.grow = 1;
    run.version++;
    step();
  }
  fan.dispose?.();
  expect(span(1).top, 'hidden once the bed is freed').toBe(0);
  peacockHead.draw = null;
});
