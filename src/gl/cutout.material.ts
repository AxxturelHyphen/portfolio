import { AlwaysDepth, DoubleSide, GLSL3, LessEqualDepth, Mesh, NormalBlending, RawShaderMaterial, Vector3, Vector4 } from 'three';
import type { Texture } from 'three';
import type { CutoutBatch, CutoutUniforms, Gfx } from '../types.ts';
import { createCutoutGeometry } from './instances.ts';
import { sharedUniforms } from './lights.ts';
import common from './shaders/common.glsl?raw';
import lights from './shaders/lights.glsl?raw';
import vertexBody from './shaders/cutout.vert.glsl?raw';
import fragmentBody from './shaders/cutout.frag.glsl?raw';

export { sharedUniforms } from './lights.ts';

/** Drop shadow onto the paper behind (uv offset per unit lift, mip bias, strength) and the depth haze toward the wall. */
const SHADOW = { offset: 0.02, softness: 2.5, strength: 0.7 } as const;
const VERTEX = common + vertexBody;
const FRAGMENT = common + lights + fragmentBody;

/**
 * The one lit cutout material. Premultiplied output; instance order and renderOrder are paint order: the depth test
 * always passes, and the depth written (only when the scene target has a depth buffer, free roam) serves the actors
 * drawn after every cutout (createActorBatch). Fragments under uDepthCut alpha are discarded so soft edges write none.
 * Two sided: the back of a turned cutout shows plain paper. The returned uniforms are the frozen CutoutUniforms;
 * the material also reads the rest of the shared light set (lights.ts) by reference.
 */
export function createCutoutMaterial(color: Texture, normal: Texture): { material: RawShaderMaterial; uniforms: CutoutUniforms } {
  const haze = sharedUniforms.uHaze.value;
  const uniforms: CutoutUniforms = {
    uViewProj: sharedUniforms.uViewProj,
    uTime: sharedUniforms.uTime,
    uWind: sharedUniforms.uWind,
    uCursor: sharedUniforms.uCursor,
    uCursorColor: sharedUniforms.uCursorColor,
    uGather: sharedUniforms.uGather,
    uMoonDir: sharedUniforms.uMoonDir,
    uMoonColor: sharedUniforms.uMoonColor,
    uSkyTop: sharedUniforms.uSkyTop,
    uSkyHorizon: sharedUniforms.uSkyHorizon,
    uColor: { value: color },
    uNormal: { value: normal },
    uReveal: { value: 1 },
    uShadow: { value: new Vector3(SHADOW.offset, SHADOW.softness, SHADOW.strength) },
    uDepthFade: { value: new Vector4(haze.x, haze.y, haze.z, haze.w) },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { ...sharedUniforms, ...uniforms },
    transparent: true,
    premultipliedAlpha: true,
    blending: NormalBlending,
    side: DoubleSide,
    depthTest: true,
    depthFunc: AlwaysDepth,
    depthWrite: true,
  });
  return { material, uniforms };
}

/**
 * One draw call: a bed page (or the actors) as instanced quads, each with its ground decal drawn just before it.
 * The caller adds `mesh` to the scene and sets `mesh.renderOrder` to the layer's paint order. Textures are not owned
 * here: the atlas owner disposes them.
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

/** Paint order of the actor batches: after every cutout, the near dressing and the fireflies. */
const ACTOR_ORDER = 2e5;

/**
 * A batch of moving actors (the carried lantern): drawn after every cutout with a depth test against the depth they
 * wrote, so an actor passes behind what stands nearer the lens and in front of the rest. Same program as the cutouts.
 * With `carriedLight` (free roam, where the hand light sits on the visitor and the carried lantern is lamp 0) the
 * batch reads its own copies of the lamp list and the hand light, refreshed just before its draw with no allocation:
 * lamp 0 at that share, so the one who carries it is lit level with the plants beside them, and the hand light's
 * reach shrunk to nothing, so the inner edges of a figure, which all face its own chest, take no pale paper rim.
 */
export function createActorBatch(gfx: Gfx, color: Texture, normal: Texture, capacity: number, carriedLight?: number): CutoutBatch {
  const batch = createCutoutBatch(gfx, color, normal, capacity);
  const material = batch.mesh.material as RawShaderMaterial;
  material.depthFunc = LessEqualDepth;
  material.depthWrite = false;
  batch.mesh.renderOrder = ACTOR_ORDER;
  if (carriedLight !== undefined) {
    const lamps = sharedUniforms.uLamp.value;
    const ownLamps = lamps.map(() => new Vector4());
    const ownCursor = new Vector4();
    material.uniforms['uLamp'] = { value: ownLamps };
    material.uniforms['uCursor'] = { value: ownCursor };
    batch.mesh.onBeforeRender = () => {
      for (let i = 0; i < ownLamps.length; i++) ownLamps[i]!.copy(lamps[i]!);
      ownLamps[0]!.w *= carriedLight;
      ownCursor.copy(sharedUniforms.uCursor.value).setW(0);
    };
  }
  return batch;
}
