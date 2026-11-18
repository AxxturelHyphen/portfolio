import { DataTexture, RGBAFormat, SRGBColorSpace } from 'three';
import type { Clock, Loop, Pose, QuadParams, Quality, TierConfig } from '../../../src/types.ts';
import { createActorBatch, createCutoutBatch, sharedUniforms } from '../../../src/gl/cutout.material.ts';
import { setRoamLight } from '../../../src/gl/lights.ts';
import { createGfx } from '../../../src/gl/renderer.ts';

// Depth test page (free roam, cook/ROAM_PLAN.md 3): a far blue card, a near red card painted in depth order, and a
// green actor drawn last between them (silhouette flag: tints uncapped, no decals). window.__depth renders with and without the actor and reads the canvas back.

const cfg: TierConfig = {
  tier: 'high', dprMin: 1, dprMax: 1, pixelCap: 1280 * 720, halation: false, filmScale: 1,
  maxLayers: 8, fireflies: 0, atlas: 'hi', texBudgetMB: 128, drawBudget: 80,
};
const quality: Quality = {
  tier: 'high', cfg, dpr: 1, scale: 1,
  probe: () => Promise.resolve('high'), adapt: () => undefined, setPanelScale: () => undefined, onChange: () => () => undefined,
};
const loop: Loop = {
  on: () => () => undefined, start: () => undefined, pause: () => undefined, resume: () => undefined, wake: () => undefined,
  running: true, rec: { start: () => undefined, stop: () => ({ label: '', frames: 0, avg: 0, p95: 0, max: 0, over25: 0, over50: 0, over100: 0, longTasks: 0, callsP95: 0 }) },
};

const canvas = document.querySelector('canvas');
if (canvas === null) throw new Error('no canvas');
const gfx = createGfx(canvas, quality, loop, true);
setRoamLight();
gfx.film.uniforms.uFilmOn.value = 0;
const pose: Pose = { x: 0, y: 1.2, z: 11, pitch: -0.04, fov: 40 };
gfx.setPose(pose);

const solid = (rgba: number[]): DataTexture => {
  const t = new DataTexture(new Uint8Array(rgba), 1, 1, RGBAFormat);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
};
const white = solid([255, 255, 255, 255]);
const flatNormal = solid([128, 128, 255, 255]);
const quad: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 1, h: 1, px: 0.5, py: 0, uv: [0, 0, 1, 1], sway: 0, phase: (8 + 16) * 8, lift: 0, facing: 0, tint: [1, 1, 1, 1] };

function card(x: number, z: number, w: number, h: number, tint: number[], order: number): void {
  const b = createCutoutBatch(gfx, white, flatNormal, 1);
  quad.x = x; quad.y = -1; quad.z = z; quad.w = w; quad.h = h; quad.tint = tint;
  b.writer.set(0, quad);
  b.writer.count = 1;
  b.writer.commit(0, 1);
  b.mesh.renderOrder = order;
  gfx.scene.add(b.mesh);
}
card(0, -3, 8, 4, [0, 0, 1, 1], 0);
card(-1.6, 3, 1.6, 3, [1, 0, 0, 1], 1);
const actor = createActorBatch(gfx, white, flatNormal, 1);
quad.x = 0; quad.y = -0.6; quad.z = 0; quad.w = 3; quad.h = 2; quad.tint = [0, 1, 0, 1];
actor.writer.set(0, quad);
actor.writer.commit(0, 1);
gfx.scene.add(actor.mesh);

const clock = { now: 0, dt: 0, t: 1, frame: 0, frozen: true };
const gl = gfx.renderer.getContext();

function shoot(withActor: boolean): Uint8Array {
  actor.writer.count = withActor ? 1 : 0;
  gfx.render(clock as Clock);
  const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

/** Pixels of the near (red) card, how many of them the actor changed, and how many actor (green) pixels show at all. */
async function measure(): Promise<{ near: number; nearChanged: number; actorShown: number }> {
  await gfx.warm();
  const without = shoot(false);
  const withActor = shoot(true);
  let near = 0;
  let nearChanged = 0;
  let actorShown = 0;
  for (let i = 0; i < without.length; i += 4) {
    const r = without[i]!;
    const g = without[i + 1]!;
    const b = without[i + 2]!;
    const isNear = r > g + 20 && r > b + 20;
    if (isNear) {
      near++;
      if (Math.abs(withActor[i]! - r) + Math.abs(withActor[i + 1]! - g) + Math.abs(withActor[i + 2]! - b) > 3) nearChanged++;
    }
    if (withActor[i + 1]! > withActor[i]! + 20 && withActor[i + 1]! > withActor[i + 2]! + 20) actorShown++;
  }
  return { near, nearChanged, actorShown };
}

(window as unknown as { __depth: object }).__depth = { measure, depthCut: () => sharedUniforms.uDepthCut.value };
