import { DepthTexture, LessEqualCompare, LinearFilter, Matrix4, WebGLRenderTarget } from 'three';
import type { Vector3 } from 'three';
import type { Camera, Scene, WebGLRenderer } from 'three';
import { setShadowPass } from './cutout.material.ts';
import { SHADOW_LAYER, shadowSide, sharedUniforms } from './lights.ts';

/**
 * The carried lantern's shadow (free roam, not on the low tier): one depth map seen straight down from its flame, of
 * what sits on SHADOW_LAYER: the cutout batches (their alpha-tested silhouettes, the visitor among the actors; decals,
 * flats and the hung lantern itself cast none), the iron gate and the one draw of ground stones and solid props (bench,
 * pot, lanterns, signposts, kerbs, rim stones, the Puerta's gates and the trellis), so plants, props and the figure throw
 * long shadows away from the lantern as it moves. The scene's own programs draw it with the lantern's view in uViewProj
 * (no program of its own, nothing compiled on first use). The view is mirrored, so closed solids leave their far faces
 * in the map (no acne on the faces that receive). The ground, the walls, the solids and the cutouts read it in
 * lights.glsl lampShadow. By day the same map is the sun's (lights.ts shadowSide above 0): an orthographic frame
 * round the visitor along the key light, mirrored the same way, read by sunShadow. The two never mix: the day's
 * signed strength crosses zero at dusk and dawn, where the map switches from one to the other.
 */
const SIZE = 512;
/** Half the downward field of view: tan 75 degrees reaches 3.4 m round a flame at hand height, the carried pool's reach. */
const SPREAD = 1 / Math.tan((75 * Math.PI) / 180);
/** Batches whose ground box lies farther than this from the flame cast nothing the map holds: they are not drawn. */
const REACH = 3.6;
const NEAR = 0.05;
const FAR = 3;
const BYTES = SIZE * SIZE * 8;
/** The sun's frame: half its width round the visitor, half its depth along the sun, and the batches it draws (m). */
const SUN = { half: 7, depth: 12, reach: 8.5 } as const;

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

/**
 * An orthographic view along the sun (from `d`, unit, toward the light) round the ground point (x, z): clip x, y across
 * the sun, z along it. Up is flipped, so the view is mirrored like the lantern's (closed solids keep their far faces).
 */
function alongSun(out: Matrix4, d: Vector3, x: number, z: number): Matrix4 {
  const fx = -d.x;
  const fy = -d.y;
  const fz = -d.z;
  const rl = Math.hypot(fz, fx) || 1;
  const rx = -fz / rl;
  const rz = fx / rl;
  const ux = fy * rz;
  const uy = fz * rx - fx * rz;
  const uz = -fy * rx;
  const h = 1 / SUN.half;
  const k = 1 / SUN.depth;
  return out.set(
    rx * h, 0, rz * h, -(rx * x + rz * z) * h,
    ux * h, uy * h, uz * h, -(ux * x + uz * z) * h,
    fx * k, fy * k, fz * k, -(fx * x + fz * z) * k,
    0, 0, 0, 1,
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
      const side = shadowSide();
      u.uShadowOn.value.set(0, 0);
      u.uShadowMap.value = null;
      const sun = side > 0;
      if (!on || side === 0 || (!sun && lamp.w <= 0)) return;
      target ??= allocate();
      const at = u.uVisitor.value;
      if (sun) alongSun(u.uShadowVP.value, u.uMoonDir.value, at[0]!, at[1]!);
      else downFrom(u.uShadowVP.value, lamp.x, lamp.y, lamp.z);
      view.copy(u.uViewProj.value);
      u.uViewProj.value.copy(u.uShadowVP.value);
      u.uShadowPass.value = 1;
      if (sun) setShadowPass(true, at[0]!, at[1]!, SUN.reach);
      else setShadowPass(true, lamp.x, lamp.z, REACH);
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
      u.uShadowOn.value.set(sun ? 0 : -side, sun ? side : 0);
    },
  };
}
