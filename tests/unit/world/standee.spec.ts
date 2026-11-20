import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { QUAD_FLAG, TURN_WALL_GAP, packPhase, turnFlag } from '../../../src/world/quadflags.ts';

// Standees under an orbiting camera (cook/PLAN_3D.md F1, F2): every cutout keeps its hinge, so the paper's cut edge
// shows from the side. The vertex stage finds the eye from uViewProj alone (eyeOf); this mirrors that solve on the CPU.

const vert = readFileSync(new URL('../../../src/gl/shaders/cutout.vert.glsl', import.meta.url), 'utf8');
const frag = readFileSync(new URL('../../../src/gl/shaders/cutout.frag.glsl', import.meta.url), 'utf8');

/** eyeOf of cutout.vert.glsl: the point whose clip x, y and w are zero, from rows 0, 1 and 3 of the matrix. */
function eyeOf(m: Matrix4): Vector3 {
  const e = m.elements;
  const row = (i: number): [Vector3, number] => [new Vector3(e[i], e[4 + i], e[8 + i]), e[12 + i]!];
  const [a0, d0] = row(0);
  const [a1, d1] = row(1);
  const [a3, d3] = row(3);
  const c01 = new Vector3().crossVectors(a0, a1);
  const c13 = new Vector3().crossVectors(a1, a3);
  const c30 = new Vector3().crossVectors(a3, a0);
  const det = a0.dot(c13);
  return c13.multiplyScalar(d0).add(c30.multiplyScalar(d1)).add(c01.multiplyScalar(d3)).multiplyScalar(-1 / det);
}

test('the yaw is the hinge: no turn toward the eye is left in the shader', () => {
  expect(vert).toContain('float yaw = aAnim.w;');
  expect(vert).not.toMatch(/TURN_MAX|TURN_K|bearing/);
});

test('the eye comes back from the view-projection, orbited or not', () => {
  for (const [x, y, z, yawDeg] of [[3, 4.6, 8, 0], [12, 2.1, 1.5, 25], [-1, 3.3, 4, -35]] as const) {
    const camera = new PerspectiveCamera(40, 16 / 9, 0.05, 400);
    camera.position.set(x, y, z);
    camera.rotation.set(-0.5, (-yawDeg * Math.PI) / 180, 0, 'YXZ');
    camera.updateMatrixWorld();
    const vp = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const eye = eyeOf(vp);
    expect(eye.x).toBeCloseTo(x, 3);
    expect(eye.y).toBeCloseTo(y, 3);
    expect(eye.z).toBeCloseTo(z, 3);
  }
});

test('paper thickness is free roam only, off with uThick, and the quad grows by the slope the edge is cut at', () => {
  expect(vert).toContain('uThick * uEye.z * (1.0 - flat_)');
  const pad = /const float THICK_PAD = ([0-9.]+);/.exec(vert)?.[1];
  const slope = /const float SIDE_SLOPE = ([0-9.]+);/.exec(frag)?.[1];
  expect(pad).toBeDefined();
  expect(slope).toBe(pad);
});

test('the rule: upright cutouts are standees unless they stand on the wall band', () => {
  const wallZ = -6;
  expect(turnFlag(-2, wallZ, true)).toBe(QUAD_FLAG.turn);
  expect(turnFlag(-2, wallZ, false)).toBe(0);
  expect(turnFlag(wallZ + TURN_WALL_GAP, wallZ, true)).toBe(0);
  expect(turnFlag(-5.4, wallZ, true)).toBe(0);
  expect(turnFlag(-8.4, wallZ, true)).toBe(0);
});

test('the fade flag decodes beside the standee flag and fades to about a third, only under free roam', () => {
  expect(QUAD_FLAG.fade).toBe(64);
  expect(vert).toContain('bit(flags, 64.0) * uEye.z');
  const fadeTo = /const float FADE_TO = ([0-9.]+);/.exec(vert)?.[1];
  expect(Number(fadeTo)).toBeCloseTo(0.35, 2);
  const phase = packPhase(1.3, QUAD_FLAG.turn | QUAD_FLAG.fade);
  expect(Math.floor(Math.floor(phase / 8) / 64) % 2).toBe(1);
  expect(Math.floor(Math.floor(phase / 8) / 32) % 2).toBe(1);
});
