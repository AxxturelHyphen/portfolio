import { BufferAttribute, BufferGeometry, DoubleSide, GLSL3, Mesh, NoBlending, RawShaderMaterial, Vector3 } from 'three';
import { SHADOW_LAYER, sharedUniforms } from './lights.ts';
import common from './shaders/common.glsl?raw';
import lights from './shaders/lights.glsl?raw';
import vertexBody from './shaders/iron.vert.glsl?raw';
import fragmentBody from './shaders/iron.frag.glsl?raw';

/**
 * La Salida's iron gate (world/irongate.ts) as one draw: real geometry among the cutouts, depth tested and depth
 * writing, so the masonry that stands nearer the lens hides it and the visitor passes in front of it. It sits in the
 * transparent list at the given paint order (after the wall it stands in, before the beds painted over it) and on the
 * shadow layer, so the carried lantern throws its bars across the path; the same program draws the shadow map (one more
 * draw). It is never culled: two draws a frame, cheaper than a bounding volume for the swing. Both sides of every face draw and the shader finds each face's normal itself, so the
 * geometry is positions alone. The leaves read La Salida's push through the doorway (world/exit.ts) just before each
 * draw and swing open well before it lands.
 */
export interface GateGeometry {
  /** The shut gate in world space, and per vertex the pin it turns about: -1 left, 1 right. */
  position: Float32Array; leaf: Float32Array; index: Uint32Array;
  /** The hinge pins: left x, right x and their z. */
  hinge: [number, number, number];
}

export function createIronGate(g: GateGeometry, gate: { readonly push: number }, order: number): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(g.position, 3));
  geometry.setAttribute('aLeaf', new BufferAttribute(g.leaf, 1));
  geometry.setIndex(new BufferAttribute(g.index, 1));
  const open = { value: 0 };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: common + vertexBody,
    fragmentShader: common + lights + fragmentBody,
    uniforms: { ...sharedUniforms, uOpen: open, uHinge: { value: new Vector3(...g.hinge) } },
    transparent: true,
    blending: NoBlending,
    side: DoubleSide,
    // Opaque in the transparent list: one pass for both sides, not three's back-then-front pair.
    forceSinglePass: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.layers.enable(SHADOW_LAYER);
  mesh.onBeforeRender = () => {
    open.value = gate.push;
  };
  return mesh;
}
