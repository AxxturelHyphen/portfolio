import { BufferAttribute, BufferGeometry, GLSL3, Mesh, NormalBlending, RawShaderMaterial, Sphere, Vector3, Vector4 } from 'three';
import { sharedUniforms } from './lights.ts';
import common from './shaders/common.glsl?raw';
import lights from './shaders/lights.glsl?raw';
import vertexBody from './shaders/pond.vert.glsl?raw';
import fragmentBody from './shaders/pond.frag.glsl?raw';

/**
 * The still pond of the Estanque (cook/ART.md 2.3): one procedural draw on the ground plane. Dark water, a long broken
 * moon reflection, slow ripples, rings under the hand light, a soft wet bank, and the cutouts that stand near the water
 * mirrored as cheap vertical smears (no second pass, no render target).
 *
 * World places it from the bed JSON: `setRect` with the water's bounding rectangle on the ground (the ellipse inscribed
 * in it is the water), `setReflectors` with the cutouts that should mirror in it. Both are load-time calls.
 */
export interface PondRect { x0: number; z0: number; x1: number; z1: number }
/** A standing cutout mirrored in the water: its foot (x, z), height and width in metres, its mean plate colour (sRGB 0..1). */
export interface PondReflector { x: number; z: number; h: number; w: number; colour: readonly [number, number, number] }
export interface Pond {
  readonly mesh: Mesh;
  setRect(r: PondRect): void;
  /** Up to MAX_REFLECTORS; extra entries are ignored. */
  setReflectors(list: readonly PondReflector[]): void;
  dispose(): void;
}

export const MAX_REFLECTORS = 8;
/** Paint order: after the ground (-1e5), before the wall and every bed layer. */
export const POND_ORDER = -9e4;

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function createPond(): Pond {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  geometry.boundingSphere = new Sphere(new Vector3(), Number.MAX_VALUE);
  const uniforms = {
    ...sharedUniforms,
    uRect: { value: new Vector4() },
    uRefl: { value: Array.from({ length: MAX_REFLECTORS }, () => new Vector4()) },
    uReflColour: { value: Array.from({ length: MAX_REFLECTORS }, () => new Vector3()) },
    uReflCount: { value: 0 },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: common + vertexBody,
    fragmentShader: common + lights + fragmentBody,
    uniforms,
    transparent: true,
    premultipliedAlpha: true,
    blending: NormalBlending,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = POND_ORDER;

  return {
    mesh,
    setRect(r) {
      uniforms.uRect.value.set(r.x0, r.z0, r.x1, r.z1);
    },
    setReflectors(list) {
      const n = Math.min(MAX_REFLECTORS, list.length);
      for (let i = 0; i < n; i++) {
        const it = list[i];
        if (it === undefined) continue;
        uniforms.uRefl.value[i]?.set(it.x, it.z, it.h, it.w);
        uniforms.uReflColour.value[i]?.set(toLinear(it.colour[0]), toLinear(it.colour[1]), toLinear(it.colour[2]));
      }
      uniforms.uReflCount.value = n;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
