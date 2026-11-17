import { GLSL3, Matrix4, Mesh, NormalBlending, RawShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import type { Texture } from 'three';
import type { CutoutBatch, CutoutUniforms, Gfx } from '../types.ts';
import { createCutoutGeometry } from './instances.ts';
import vertexShader from './shaders/cutout.vert.glsl?raw';
import fragmentShader from './shaders/cutout.frag.glsl?raw';

/**
 * Uniforms shared by every cutout batch and the sky: one object per uniform, referenced (not copied) by each
 * material, so the camera and light rigs write them once per frame. Colours are linear.
 * Defaults are the P1 dusk: blue-violet sky, cool moon from the upper left, warm cursor light.
 */
export const sharedUniforms = {
  uViewProj: { value: new Matrix4() },
  uTime: { value: 0 },
  uWind: { value: new Vector2(0, 0.5) },
  uCursor: { value: new Vector4(0, 0, 1, 2.5) },
  uCursorColor: { value: new Vector3(1.5, 1.05, 0.62) },
  uGather: { value: new Vector4(0, 0, 0, 0) },
  uMoonDir: { value: new Vector3(-0.45, 0.55, 0.7).normalize() },
  uMoonColor: { value: new Vector3(0.42, 0.46, 0.62) },
  uSkyTop: { value: new Vector3(0.018, 0.02, 0.07) },
  uSkyHorizon: { value: new Vector3(0.065, 0.042, 0.11) },
};

/** Per-batch defaults: contact shadow (uv offset per unit lift, mip bias, strength) and depth fade toward the dusk haze. */
const SHADOW = { offset: 0.012, softness: 2.5, strength: 0.55 } as const;
const DEPTH_FADE = { r: 0.06, g: 0.05, b: 0.12, perUnit: 0.035 } as const;

/** The one lit cutout material. Premultiplied output, no depth: instance order and renderOrder are paint order. */
export function createCutoutMaterial(color: Texture, normal: Texture): { material: RawShaderMaterial; uniforms: CutoutUniforms } {
  const uniforms: CutoutUniforms = {
    ...sharedUniforms,
    uColor: { value: color },
    uNormal: { value: normal },
    uReveal: { value: 1 },
    uShadow: { value: new Vector3(SHADOW.offset, SHADOW.softness, SHADOW.strength) },
    uDepthFade: { value: new Vector4(DEPTH_FADE.r, DEPTH_FADE.g, DEPTH_FADE.b, DEPTH_FADE.perUnit) },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    premultipliedAlpha: true,
    blending: NormalBlending,
    depthTest: false,
    depthWrite: false,
  });
  return { material, uniforms };
}

/**
 * One draw call: a bed page (or the actors) as instanced quads. The caller adds `mesh` to the scene and sets
 * `mesh.renderOrder` to the layer's paint order. Textures are not owned here: the atlas owner disposes them.
 */
export function createCutoutBatch(_gfx: Gfx, color: Texture, normal: Texture, capacity: number): CutoutBatch {
  const { geometry, writer } = createCutoutGeometry(capacity);
  const { material, uniforms } = createCutoutMaterial(color, normal);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return {
    mesh,
    writer,
    uniforms,
    dispose(): void {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
