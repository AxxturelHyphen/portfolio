import { AdditiveBlending, CanvasTexture, DataTexture, GLSL3, LessEqualDepth, Mesh, RawShaderMaterial, RGBAFormat, SRGBColorSpace } from 'three';
import type { CutoutBatch, Gfx, InstanceWriter } from '../types.ts';
import { PARTS, type SignSpot } from '../world/signboard.ts';
import { plankTilt } from '../world/signboard.paint.ts';
import { createCutoutBatch } from './cutout.material.ts';
import { createCutoutGeometry } from './instances.ts';
import { sharedUniforms } from './lights.ts';
import { PROP_LOOK } from './props.ts';
import { createSignBoards } from './signwood.ts';
import { solidMaterial } from './solid.material.ts';
import common from './shaders/common.glsl?raw';
import vertexBody from './shaders/signglow.vert.glsl?raw';
import fragmentBody from './shaders/signglow.frag.glsl?raw';

/**
 * Free roam's signposts on the gl side (three draws for every sign; the posts and arms are the props' timber,
 * gl/signwood.ts): the planks' painted faces and the lanterns as one cutout batch on the painted atlas (the one lit
 * cutout program, so they take the scene's moon, ambient, lantern pools, haze and ground shadows like every plate), the
 * planks' wooden bodies just behind their faces as one instanced solid, and one additive pass of the planks for the warm
 * pool of each sign's own lantern. The batch and the bodies are drawn after the beds with a depth test, so they stand
 * among them by depth; the pool is drawn just after, nudged toward the lens so it never fights the plank's depth. All
 * are added to the scene here, before Gfx.warm(), which compiles them and uploads the atlas.
 */
export interface SignboardMeshes {
  readonly batch: CutoutBatch;
  /** The pool pass: one instance per plank, the plank's quad with the flame in its frame (see signglow.vert.glsl). */
  readonly glow: InstanceWriter;
  readonly texture: CanvasTexture;
  /** The lantern's slow flicker on or off (off under reduced motion). */
  setFlicker(on: boolean): void;
  /** Turns sign i's wooden board on its hook with its face card (radians), `open` of its height unfolded. No allocation. */
  swing(i: number, rot: number, open: number): void;
}

export function createSignboardMeshes(gfx: Gfx, canvas: HTMLCanvasElement, spots: readonly SignSpot[], order: number): SignboardMeshes {
  const signs = spots.length;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const flat = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, RGBAFormat);
  flat.needsUpdate = true;
  const batch = createCutoutBatch(gfx, texture, flat, signs * PARTS);
  (batch.mesh.material as RawShaderMaterial).depthFunc = LessEqualDepth;
  batch.mesh.renderOrder = order;

  const { geometry, writer } = createCutoutGeometry(signs);
  const flicker = { value: 1 };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: common + vertexBody,
    fragmentShader: common + fragmentBody,
    uniforms: {
      uViewProj: sharedUniforms.uViewProj,
      uTime: sharedUniforms.uTime,
      uLampColor: sharedUniforms.uLampColor,
      uColor: { value: texture },
      uFlicker: flicker,
    },
    transparent: true,
    premultipliedAlpha: true,
    blending: AdditiveBlending,
    depthTest: true,
    depthFunc: LessEqualDepth,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  const glow = new Mesh(geometry, material);
  glow.frustumCulled = false;
  glow.matrixAutoUpdate = false;
  glow.renderOrder = order + 1;
  const boards = createSignBoards(spots, spots.map((_, i) => plankTilt(i)), PROP_LOOK.wood, solidMaterial(true), order);
  gfx.scene.add(batch.mesh, boards.mesh, glow);
  return {
    batch,
    swing: boards.swing,
    glow: writer,
    texture,
    setFlicker(on) {
      flicker.value = on ? 1 : 0;
    },
  };
}
