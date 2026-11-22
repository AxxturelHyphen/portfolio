import { BufferAttribute, BufferGeometry, GLSL3, Matrix4, Mesh, RawShaderMaterial, Sphere, Vector3 } from 'three';
import { linearHex } from './colour.ts';
import { sharedUniforms } from './lights.ts';
import common from './shaders/common.glsl?raw';
import vertexBody from './shaders/sky.vert.glsl?raw';
import fragmentBody from './shaders/sky.frag.glsl?raw';

/**
 * The sky, by night and by day (world/daytime.ts): drawn first into the scene target, at the far plane. It shares the sky colours and the real moon
 * with the cutouts and the ground (lights.ts), so everything is lit by the sky it stands under.
 * Moon body #ddd4cb (cook/SHOTS.md B: moon white, never #ffffff); the film grade lifts its core to luma 236 to 240.
 */
export type SkyUniforms = {
  uSkyTop: typeof sharedUniforms.uSkyTop;
  uSkyHorizon: typeof sharedUniforms.uSkyHorizon;
  uMoonBack: typeof sharedUniforms.uMoonBack;
  uDay: typeof sharedUniforms.uDay;
  uSun: typeof sharedUniforms.uSun;
  uCamPos: typeof sharedUniforms.uCamPos;
  uInvViewProj: { value: Matrix4 };
  uMoonBody: { value: Vector3 };
};
export interface Sky {
  readonly mesh: Mesh;
  readonly uniforms: SkyUniforms;
  dispose(): void;
}

/** Moon body in linear light; above 1 so the core reaches the white point after the grade. */
const MOON_BODY_GAIN = 1.75;

export function createSky(): Sky {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
  geometry.boundingSphere = new Sphere(new Vector3(), Number.MAX_VALUE);
  const uniforms: SkyUniforms = {
    uSkyTop: sharedUniforms.uSkyTop,
    uSkyHorizon: sharedUniforms.uSkyHorizon,
    uMoonBack: sharedUniforms.uMoonBack,
    uDay: sharedUniforms.uDay,
    uSun: sharedUniforms.uSun,
    uCamPos: sharedUniforms.uCamPos,
    uInvViewProj: { value: new Matrix4() },
    uMoonBody: { value: linearHex('#ddd4cb', new Vector3(), MOON_BODY_GAIN) },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: common + vertexBody,
    fragmentShader: common + fragmentBody,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = -1e6;
  return {
    mesh,
    uniforms,
    dispose(): void {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
