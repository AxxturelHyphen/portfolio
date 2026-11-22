import { HalfFloatType, LinearFilter, Mesh, RawShaderMaterial, Scene, Vector2, WebGLRenderTarget, GLSL3 } from 'three';
import type { BufferGeometry, Camera, Texture, WebGLRenderer } from 'three';
import vertexShader from './shaders/film.vert.glsl?raw';
import downShader from './shaders/halation.down.frag.glsl?raw';
import blurShader from './shaders/halation.blur.frag.glsl?raw';

/** Source threshold: luma 0.72 in display terms (cook/SHOTS.md B), about 0.48 in the linear scene target. */
const THRESHOLD_LINEAR = 0.48;
/** Free roam: only the lamp flames and their brightest glass pass, so the glow stays at the lamps. */
const ROAM_THRESHOLD_LINEAR = 0.7;
/** RGBA half float: 8 bytes per pixel. */
const BYTES_PER_PX = 8;

/**
 * Quarter-resolution halation chain: threshold downsample, horizontal blur, vertical blur (3 draws).
 * Two ping-pong targets sized once per resize; the panel scale and DPR only move the viewport sub-rect.
 */
export interface Halation {
  /** The blurred result, valid after render(); the used fraction is the `scale` passed to render(). */
  readonly texture: Texture;
  readonly bytes: number;
  readonly allocated: boolean;
  resize(sceneW: number, sceneH: number): void;
  release(): void;
  render(scene: Texture, scale: number): void;
  /** The three programs, for Gfx.warm() to compile before first use. */
  readonly scenes: readonly Scene[];
  dispose(): void;
}

function fullscreen(geometry: BufferGeometry, material: RawShaderMaterial): Scene {
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const scene = new Scene();
  scene.matrixWorldAutoUpdate = false;
  scene.add(mesh);
  return scene;
}

function target(): WebGLRenderTarget {
  return new WebGLRenderTarget(1, 1, {
    type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false, generateMipmaps: false,
  });
}

export function createHalation(renderer: WebGLRenderer, geometry: BufferGeometry, camera: Camera, roam = false): Halation {
  const a = target();
  const b = target();
  let w = 0;
  let h = 0;

  const down = new RawShaderMaterial({
    glslVersion: GLSL3, vertexShader, fragmentShader: downShader, depthTest: false, depthWrite: false,
    uniforms: { uScene: { value: null }, uScale: { value: 1 }, uThreshold: { value: roam ? ROAM_THRESHOLD_LINEAR : THRESHOLD_LINEAR } },
  });
  const blur = new RawShaderMaterial({
    glslVersion: GLSL3, vertexShader, fragmentShader: blurShader, depthTest: false, depthWrite: false,
    uniforms: { uSrc: { value: null }, uDir: { value: new Vector2(1, 0) }, uScale: { value: 1 } },
  });
  const downScene = fullscreen(geometry, down);
  const blurScene = fullscreen(geometry, blur);
  const downU = down.uniforms;
  const blurU = blur.uniforms;
  const dir = blurU['uDir']!.value as Vector2;

  const pass = (rt: WebGLRenderTarget, scene: Scene, scale: number): void => {
    rt.viewport.set(0, 0, Math.max(1, Math.ceil(w * scale)), Math.max(1, Math.ceil(h * scale)));
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
  };

  return {
    get texture() { return a.texture; },
    get bytes() { return w * h * BYTES_PER_PX * 2; },
    get allocated() { return w > 0; },
    scenes: [downScene, blurScene],
    resize(sceneW, sceneH) {
      w = Math.max(1, Math.ceil(sceneW / 4));
      h = Math.max(1, Math.ceil(sceneH / 4));
      a.setSize(w, h);
      b.setSize(w, h);
    },
    release() {
      w = 0;
      h = 0;
      a.dispose();
      b.dispose();
    },
    render(scene, scale) {
      downU['uScene']!.value = scene;
      downU['uScale']!.value = scale;
      blurU['uScale']!.value = scale;
      pass(a, downScene, scale);
      blurU['uSrc']!.value = a.texture;
      dir.set(1, 0);
      pass(b, blurScene, scale);
      blurU['uSrc']!.value = b.texture;
      dir.set(0, 1);
      pass(a, blurScene, scale);
    },
    dispose() {
      a.dispose();
      b.dispose();
      down.dispose();
      blur.dispose();
    },
  };
}
