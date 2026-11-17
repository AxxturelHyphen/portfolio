import { BufferAttribute, BufferGeometry, DataTexture, DoubleSide, GLSL3, LinearFilter, Mesh, RawShaderMaterial, RedFormat, RepeatWrapping, Sphere, Vector3, Vector4 } from 'three';
import type { Texture } from 'three';
import { ART_LAYOUT, MAX_PUDDLES, PATH_RANGE_M, bakePathField } from './ground.layout.ts';
import type { GroundLayout } from './ground.layout.ts';
import { sharedUniforms } from './lights.ts';
import common from './shaders/common.glsl?raw';
import lights from './shaders/lights.glsl?raw';
import vertexBody from './shaders/ground.vert.glsl?raw';
import fragmentBody from './shaders/ground.frag.glsl?raw';

export type { GroundLayout } from './ground.layout.ts';
export { ART_LAYOUT } from './ground.layout.ts';

/**
 * The ground plane for the world builder: one draw (earth, moss, flagstone path, puddles, line screen), drawn right
 * after the sky and before every cutout. Puddle radii are fixed here (cook/ART.md: elliptical masks in the joints).
 */
export interface Ground {
  readonly mesh: Mesh;
  /** Bakes the path field (a few ms) and places the puddles. Load time only. */
  setLayout(l: GroundLayout): void;
  /** Photo stone and its normal map (CC0, repeat-wrapped by the caller's loader); null keeps the code-drawn stone. */
  setStone(color: Texture | null, normal: Texture | null): void;
  /** Textures the warm-up must upload before first use. */
  readonly textures: readonly Texture[];
  dispose(): void;
}

const PUDDLE_RADIUS = { x: 0.55, z: 0.32 } as const;
/** Paint order: after the sky (-1e6), before every bed layer. */
export const GROUND_ORDER = -1e5;

export function createGround(moonBody: Vector3): Ground {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  geometry.boundingSphere = new Sphere(new Vector3(), Number.MAX_VALUE);
  const neutral = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  neutral.needsUpdate = true;
  let path = new DataTexture(new Uint8Array([255]), 1, 1, RedFormat);
  const uniforms = {
    ...sharedUniforms,
    uBounds: { value: new Vector4() },
    uWallZ: { value: ART_LAYOUT.wallZ },
    uPath: { value: path as Texture },
    uPathRange: { value: PATH_RANGE_M },
    uStone: { value: neutral as Texture },
    uStoneN: { value: neutral as Texture },
    uStoneOn: { value: 0 },
    uPuddle: { value: Array.from({ length: MAX_PUDDLES }, () => new Vector4()) },
    uPuddles: { value: 0 },
    uMoonBody: { value: moonBody },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: common + vertexBody,
    fragmentShader: common + lights + fragmentBody,
    uniforms,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = GROUND_ORDER;
  const textures: Texture[] = [path, neutral];

  const setLayout = (l: GroundLayout): void => {
    uniforms.uBounds.value.set(l.x0, l.z0, l.x1, l.z1);
    uniforms.uWallZ.value = l.wallZ;
    const field = bakePathField(l);
    path.dispose();
    path = new DataTexture(field.data, field.w, field.h, RedFormat);
    path.minFilter = LinearFilter;
    path.magFilter = LinearFilter;
    path.needsUpdate = true;
    uniforms.uPath.value = path;
    textures[0] = path;
    const n = Math.min(MAX_PUDDLES, Math.floor(l.puddles.length / 2));
    for (let i = 0; i < n; i++) uniforms.uPuddle.value[i]?.set(l.puddles[i * 2] ?? 0, l.puddles[i * 2 + 1] ?? 0, PUDDLE_RADIUS.x, PUDDLE_RADIUS.z);
    uniforms.uPuddles.value = n;
  };
  setLayout(ART_LAYOUT);

  return {
    mesh,
    textures,
    setLayout,
    setStone(color, normal) {
      for (const t of [color, normal]) if (t !== null) t.wrapS = t.wrapT = RepeatWrapping;
      uniforms.uStone.value = color ?? neutral;
      uniforms.uStoneN.value = normal ?? neutral;
      uniforms.uStoneOn.value = color === null ? 0 : 1;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      path.dispose();
      neutral.dispose();
    },
  };
}
