import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { QUAD_FLAG, TURN_WALL_GAP, packPhase, turnFlag } from '../../../src/world/quadflags.ts';

// Standees (cook/ROAM_PLAN.md 3, P2): the vertex shader turns flagged cutouts from their hinge toward the eye on the
// ground plane. This mirrors that yaw on the CPU, with the constants read from the shader source so the two cannot drift.

const glsl = readFileSync(new URL('../../../src/gl/shaders/cutout.vert.glsl', import.meta.url), 'utf8');
const constant = (name: string): number => {
  const m = new RegExp(`const float ${name} = ([0-9.]+);`).exec(glsl);
  if (m === null) throw new Error(`cutout.vert.glsl has no ${name}`);
  return Number(m[1]);
};
const TURN_MAX = constant('TURN_MAX');
const TURN_K = constant('TURN_K');
const DEG = Math.PI / 180;

interface Instance { x: number; z: number; facing: number; phase: number }
interface Eye { x: number; z: number; weight: number }

/** The shader's decode of the flags and its yaw, in the same order of operations. */
function yawOf(i: Instance, eye: Eye): number {
  const flags = Math.floor(i.phase / 8);
  const turn = Math.floor(flags / 32) % 2;
  const bearing = Math.min(TURN_MAX, Math.max(-TURN_MAX, Math.atan2(eye.x - i.x, eye.z - i.z)));
  return i.facing + turn * eye.weight * TURN_K * bearing;
}

const standee = (x: number, z: number, hingeDeg: number, flags: number = QUAD_FLAG.turn): Instance =>
  ({ x, z, facing: -hingeDeg * DEG, phase: packPhase(1.3, flags) });

test('the shader turns 35 degrees at most and a factor of 0.7', () => {
  expect(TURN_MAX).toBeCloseTo(35 * DEG, 4);
  expect(TURN_K).toBe(0.7);
});

test('a standee straight in front of the eye keeps its hinge', () => {
  const s = standee(10, -2, 7);
  expect(yawOf(s, { x: 10, z: 8, weight: 1 })).toBeCloseTo(s.facing, 12);
});

test('the turn follows the bearing, scaled by the factor, inside the clamp', () => {
  const s = standee(10, -2, 0);
  const eye = { x: 13, z: 8, weight: 1 };
  const bearing = Math.atan2(3, 10);
  expect(bearing).toBeLessThan(TURN_MAX);
  expect(yawOf(s, eye)).toBeCloseTo(TURN_K * bearing, 12);
  expect(yawOf(s, { ...eye, x: 7 })).toBeCloseTo(-TURN_K * bearing, 12);
});

test('far to the side the turn stops at the clamp, both ways, on top of the hinge', () => {
  const s = standee(10, -2, -12);
  expect(yawOf(s, { x: 40, z: 0, weight: 1 })).toBeCloseTo(s.facing + TURN_K * TURN_MAX, 12);
  expect(yawOf(s, { x: -20, z: 0, weight: 1 })).toBeCloseTo(s.facing - TURN_K * TURN_MAX, 12);
});

test('weight 0 (the rail) gives the hinge exactly, for every instance', () => {
  for (const [x, z, hinge] of [[10, -2, 7], [5, 0.1, 12], [20, -3.4, -6], [42, 0.4, -12]] as const) {
    const s = standee(x, z, hinge);
    for (const ex of [-5, x, 50]) expect(yawOf(s, { x: ex, z: 6, weight: 0 })).toBe(s.facing);
  }
});

test('an instance without the flag never turns, whatever the other flags', () => {
  for (const flags of [0, QUAD_FLAG.noLean, QUAD_FLAG.flat | QUAD_FLAG.noShadow, QUAD_FLAG.silhouette | QUAD_FLAG.noShadow]) {
    const s = standee(10, -2, 5, flags);
    expect(yawOf(s, { x: 30, z: 6, weight: 1 })).toBe(s.facing);
  }
  const both = standee(10, -2, 5, QUAD_FLAG.turn | QUAD_FLAG.noShadow | QUAD_FLAG.silhouette);
  expect(yawOf(both, { x: 30, z: 6, weight: 1 })).not.toBe(both.facing);
});

test('the rule: upright cutouts turn unless they stand on the wall band', () => {
  const wallZ = -6;
  expect(turnFlag(-2, wallZ, true)).toBe(QUAD_FLAG.turn);
  expect(turnFlag(-2, wallZ, false)).toBe(0);
  expect(turnFlag(wallZ + TURN_WALL_GAP, wallZ, true)).toBe(0);
  expect(turnFlag(-5.4, wallZ, true)).toBe(0);
  expect(turnFlag(-8.4, wallZ, true)).toBe(0);
});

test('the fade flag decodes beside the turn and fades to about a third, only under free roam', () => {
  expect(QUAD_FLAG.fade).toBe(64);
  expect(glsl).toContain('bit(flags, 64.0) * uEye.z');
  expect(constant('FADE_TO')).toBeCloseTo(0.35, 2);
  const s = standee(10, -2, 5, QUAD_FLAG.turn | QUAD_FLAG.fade);
  expect(Math.floor(Math.floor(s.phase / 8) / 64) % 2).toBe(1);
  expect(yawOf(s, { x: 30, z: 6, weight: 1 })).toBe(yawOf(standee(10, -2, 5), { x: 30, z: 6, weight: 1 }));
});
