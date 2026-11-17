import { BufferAttribute, BufferGeometry, GLSL3, Mesh, RawShaderMaterial, Sphere, Vector3, Vector4 } from 'three';
import { sharedUniforms } from './cutout.material.ts';
import vertexShader from './shaders/sky.vert.glsl?raw';
import fragmentShader from './shaders/sky.frag.glsl?raw';

/** Sky colours are the shared ambient uniforms, so the cutouts are lit by the sky they stand under. */
export type SkyUniforms = {
  uSkyTop: typeof sharedUniforms.uSkyTop;
  uSkyHorizon: typeof sharedUniforms.uSkyHorizon;
  uMoonColor: typeof sharedUniforms.uMoonColor;
  uMoon: { value: Vector4 };   // centre x, y in 0..1 of the viewport; radius and halo in viewport heights
  uAspect: { value: number };
  uHorizon: { value: number };
};
export interface Sky { readonly mesh: Mesh; readonly uniforms: SkyUniforms; setAspect(aspect: number): void; dispose(): void }

/** Large soft moon, upper left of the frame; the light rig may move it for parallax. */
const MOON = { x: 0.28, y: 0.74, radius: 0.11, halo: 0.22 } as const;
const HORIZON = 0.3;

export function createSky(): Sky {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
  geometry.boundingSphere = new Sphere(new Vector3(), Number.MAX_VALUE);
  const uniforms: SkyUniforms = {
    uSkyTop: sharedUniforms.uSkyTop,
    uSkyHorizon: sharedUniforms.uSkyHorizon,
    uMoonColor: sharedUniforms.uMoonColor,
    uMoon: { value: new Vector4(MOON.x, MOON.y, MOON.radius, MOON.halo) },
    uAspect: { value: 16 / 9 },
    uHorizon: { value: HORIZON },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader,
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
    setAspect(aspect: number): void { uniforms.uAspect.value = aspect; },
    dispose(): void {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
