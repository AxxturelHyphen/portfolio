import { DepthTexture, LessEqualCompare, LinearFilter, Matrix4, WebGLRenderTarget } from 'three';
import type { Camera, Scene, WebGLRenderer } from 'three';
import { setShadowPass } from './cutout.material.ts';
import { SHADOW_LAYER, sharedUniforms } from './lights.ts';

/**
 * The carried lantern's shadow (free roam, not on the low tier): one depth map seen straight down from its flame, of
 * the cutout batches only (their alpha-tested silhouettes, the visitor among the actors; decals, flats and the hung
 * lantern itself cast none), so plants and the figure throw long shadows away from the lantern as it moves. The same
 * cutout programs draw it with the lantern's view in uViewProj (no program of its own, nothing compiled on first use);
 * the ground and the cutouts read it in lights.glsl lampShadow.
 */
const SIZE = 512;
/** Half the downward field of view: tan 75 degrees reaches 3.4 m round a flame at hand height, the carried pool's reach. */
const SPREAD = 1 / Math.tan((75 * Math.PI) / 180);
/** Batches whose ground box lies farther than this from the flame cast nothing the map holds: they are not drawn. */
const REACH = 3.6;
const NEAR = 0.05;
const FAR = 3;
const BYTES = SIZE * SIZE * 8;

export interface LanternShadow {
  /** Draws the map before the scene, or turns the shadow off (the lantern dark, the low tier). No allocation. */
  render(on: boolean): void;
  /** Bytes of the map once allocated (colour and depth), 0 before. */
  readonly bytes: number;
}

/** A perspective view straight down from (x, y, z): clip x, y from the ground offsets, w the depth under the flame. */
function downFrom(out: Matrix4, x: number, y: number, z: number): Matrix4 {
  const a = (FAR + NEAR) / (FAR - NEAR);
  const b = (2 * FAR * NEAR) / (FAR - NEAR);
  return out.set(
    SPREAD, 0, 0, -SPREAD * x,
    0, 0, SPREAD, -SPREAD * z,
    0, -a, 0, a * y - b,
    0, -1, 0, y,
  );
}

export function createLanternShadow(renderer: WebGLRenderer, scene: Scene, camera: Camera): LanternShadow {
  let target: WebGLRenderTarget | null = null;
  const view = new Matrix4();
  const u = sharedUniforms;

  function allocate(): WebGLRenderTarget {
    const depth = new DepthTexture(SIZE, SIZE);
    depth.compareFunction = LessEqualCompare;
    depth.magFilter = LinearFilter;
    depth.minFilter = LinearFilter;
    return new WebGLRenderTarget(SIZE, SIZE, { depthTexture: depth, generateMipmaps: false });
  }

  return {
    get bytes() { return target === null ? 0 : BYTES; },
    render(on) {
      const lamp = u.uLamp.value[0]!;
      u.uShadowOn.value = 0;
      u.uShadowMap.value = null;
      if (!on || lamp.w <= 0) return;
      target ??= allocate();
      downFrom(u.uShadowVP.value, lamp.x, lamp.y, lamp.z);
      view.copy(u.uViewProj.value);
      u.uViewProj.value.copy(u.uShadowVP.value);
      u.uShadowPass.value = 1;
      setShadowPass(true, lamp.x, lamp.z, REACH);
      const mask = camera.layers.mask;
      camera.layers.set(SHADOW_LAYER);
      renderer.setRenderTarget(target);
      renderer.clear(false, true, false);
      renderer.render(scene, camera);
      camera.layers.mask = mask;
      setShadowPass(false);
      u.uShadowPass.value = 0;
      u.uViewProj.value.copy(view);
      u.uShadowMap.value = target.depthTexture;
      u.uShadowOn.value = 1;
    },
  };
}
