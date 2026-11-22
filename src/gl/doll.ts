import { BufferAttribute, DynamicDrawUsage, FrontSide, GLSL3, LessEqualDepth, Mesh, NormalBlending, RawShaderMaterial, BufferGeometry } from 'three';
import type { Doll } from '../world/doll.ts';
import { sharedUniforms } from './lights.ts';
import common from './shaders/common.glsl?raw';
import lights from './shaders/lights.glsl?raw';
import vertexShader from './shaders/doll.vert.glsl?raw';
import fragmentBody from './shaders/doll.frag.glsl?raw';

/** After every cutout, as the actor batches are (gl/cutout.material.ts), so the doll passes behind what stands nearer. */
const DOLL_ORDER = 2e5;

/**
 * The doll's one mesh (world/doll.ts): doll, lantern and contact shadow in one draw, lit like the solids. Made before
 * Gfx.warm(), so its program compiles there; drawn once `show` is on. `update` uploads the body after a re-pose and the
 * lantern every frame.
 */
export function createDollMesh(doll: Doll): { mesh: Mesh; update(body: boolean): void } {
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(doll.position, 3).setUsage(DynamicDrawUsage);
  const normal = new BufferAttribute(doll.normal, 3).setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('normal', normal);
  geometry.setAttribute('aPaint', new BufferAttribute(doll.paint, 4));
  geometry.setAttribute('aFab', new BufferAttribute(doll.fab, 2));
  geometry.setIndex(new BufferAttribute(doll.index, 1));
  const material = new RawShaderMaterial({
    name: 'doll', glslVersion: GLSL3, vertexShader: common + vertexShader, fragmentShader: common + lights + fragmentBody, uniforms: { ...sharedUniforms },
    transparent: true, blending: NormalBlending, side: FrontSide, depthTest: true, depthFunc: LessEqualDepth, depthWrite: true, forceSinglePass: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = DOLL_ORDER;
  mesh.frustumCulled = false;
  mesh.scale.setScalar(0);
  mesh.updateMatrixWorld();
  const lantern = doll.lanternFrom * 3;
  return {
    mesh,
    update(body) {
      const r = doll.root;
      mesh.position.set(r.x, r.lift * r.k, r.z);
      mesh.rotation.y = r.heading;
      mesh.scale.setScalar(r.k);
      // The scene never updates world matrices on its own (gl/renderer.ts).
      mesh.updateMatrixWorld();
      for (const a of [position, normal]) {
        if (!body) a.addUpdateRange(lantern, a.array.length - lantern);
        a.needsUpdate = true;
      }
    },
  };
}
