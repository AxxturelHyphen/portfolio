import { BufferGeometry, Camera, DataTexture, Float32BufferAttribute, GLSL3, Mesh, RawShaderMaterial, Scene, Vector2, Vector3, Vector4 } from 'three';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import type { Clock, FilmPass, FilmUniforms, Quality } from '../types.ts';
import { FILM, STEP_FPS } from '../core/motion.ts';
import { createHalation } from './halation.ts';
import vertexShader from './shaders/film.vert.glsl?raw';
import fragmentShader from './shaders/film.frag.glsl?raw';

// Look constants (cook/SHOTS.md B). Display-referred unless noted.
/** Grain std at mid grey: 2.5 levels of 255. */
const GRAIN_STD = 2.5 / 255;
/** Vignette: corners 18 % under the centre, onset at 55 % of the radius. */
const VIGNETTE_STRENGTH = 0.18;
const VIGNETTE_ONSET = 0.55;
/** Black point #0d0a1e: the lifted black of the grade and the colour of a shut iris. Never pure black. */
const LIFTED_BLACK = [13 / 255, 10 / 255, 30 / 255] as const;
/** Grade gain stub: display white stops at luma 240 (moon core); P2 tunes the regions below it. */
const WHITE_POINT = 240 / 255;
/** Flicker knots: 2.5 Hz keeps exposure noise under the 3 Hz photosensitivity limit. */
const FLICKER_HZ = FILM.flickerMaxHz;
/** Std of the smoothstep-interpolated knot noise below, used to turn an rms target into an amplitude. */
const KNOT_NOISE_STD = 0.45;
/** Grain reseeds 24 times per second of content time (FilmUniforms.uSeed). */
const SEED_FPS = 24;

/** The film pass plus what the Gfx owner drives per frame. */
export interface FilmDriver extends FilmPass {
  /** Per frame, before render(): time, seed, weave and flicker. `exposure` multiplies in (1 = none; travel dip). */
  tick(c: Clock, reduced: boolean, exposure: number): void;
  /** Compiles the film and halation programs, uploads the fallback texture and runs the chain once into its targets. */
  warm(scene: WebGLRenderTarget): Promise<void>;
  dispose(): void;
}

/** Deterministic hash of an integer knot to -1..1 (no allocation). */
function knot(i: number, salt: number): number {
  let n = Math.imul(i ^ salt, 0x27d4eb2d);
  n = Math.imul(n ^ (n >>> 15), 0x165667b1);
  n ^= n >>> 13;
  return ((n >>> 0) / 4294967295) * 2 - 1;
}

/** Smooth value noise over integer knots at `rate` per second: no content above `rate` Hz. */
function knotNoise(t: number, rate: number, salt: number): number {
  const x = t * rate;
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return knot(i, salt) + (knot(i + 1, salt) - knot(i, salt)) * s;
}

const clampAbs = (v: number, limit: number): number => (v > limit ? limit : v < -limit ? -limit : v);

function fullscreenTriangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return g;
}

function filmUniforms(black: DataTexture): FilmUniforms {
  return {
    uScene: { value: black }, uHalation: { value: black }, uRes: { value: new Vector2(1, 1) }, uScale: { value: 1 },
    uTime: { value: 0 }, uSeed: { value: 0 }, uGrain: { value: GRAIN_STD }, uWeave: { value: new Vector2() },
    uDust: { value: 0 }, uFlicker: { value: 0 }, uVignette: { value: new Vector2(VIGNETTE_STRENGTH, VIGNETTE_ONSET) },
    uSoft: { value: 0 }, uLift: { value: new Vector3(...LIFTED_BLACK) }, uGamma: { value: new Vector3(1, 1, 1) },
    uGain: { value: new Vector3(WHITE_POINT, WHITE_POINT, WHITE_POINT) }, uTint: { value: [new Vector4(), new Vector4(), new Vector4()] },
    uIris: { value: new Vector4(0.5, 0.5, 1.2, 0.018) }, uIrisColor: { value: new Vector3(...LIFTED_BLACK) },
    uStrip: { value: new Vector4() }, uProtect: { value: new Vector3() }, uStatic: { value: 0 }, uFilmOn: { value: 1 },
  };
}

/**
 * The single combined film pass (cook/ARCH.md 2.7): one fullscreen triangle to the canvas, plus the quarter-res
 * halation chain that the tier can switch off. `resize` takes the scene target size (allocated at dprMax).
 * The caller owns uScale (used fraction of the scene target) and uFilmOn (0 for ?film=0: everything but the sRGB
 * encode is bypassed, halation included). render() reads cfg.filmScale and cfg.halation every frame, so tier and
 * DPR changes reallocate nothing but the halation targets on a tier change.
 */
export function createFilmPass(renderer: WebGLRenderer, quality: Quality): FilmDriver {
  const camera = new Camera();
  const geometry = fullscreenTriangle();
  const black = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;
  const uniforms = filmUniforms(black);
  const material = new RawShaderMaterial({ glslVersion: GLSL3, vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const scene = new Scene();
  scene.matrixWorldAutoUpdate = false;
  scene.add(mesh);
  const halation = createHalation(renderer, geometry, camera);
  const buffer = new Vector2();
  let sceneW = 0;
  let sceneH = 0;

  const fitHalation = (): void => {
    if (!quality.cfg.halation) {
      if (halation.allocated) halation.release();
      return;
    }
    if (sceneW > 0) halation.resize(sceneW, sceneH);
  };
  const offQuality = quality.onChange(fitHalation);

  const render = (target: WebGLRenderTarget): void => {
    uniforms.uScene.value = target.texture;
    renderer.getDrawingBufferSize(buffer);
    uniforms.uRes.value.set(buffer.x * quality.cfg.filmScale, buffer.y * quality.cfg.filmScale);
    if (halation.allocated && quality.cfg.halation && uniforms.uFilmOn.value > 0.5) {
      halation.render(target.texture, uniforms.uScale.value);
      uniforms.uHalation.value = halation.texture;
    } else {
      uniforms.uHalation.value = black;
    }
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  };

  return {
    uniforms,
    get targetBytes() { return halation.bytes; },
    resize(w, h, pixelCap) {
      const k = w * h > pixelCap ? Math.sqrt(pixelCap / (w * h)) : 1;
      sceneW = Math.floor(w * k);
      sceneH = Math.floor(h * k);
      fitHalation();
    },
    render,
    tick(c, reduced, exposure) {
      uniforms.uTime.value = c.t;
      uniforms.uSeed.value = Math.floor(c.t * SEED_FPS);
      uniforms.uStatic.value = reduced ? 1 : 0;
      const weave = uniforms.uWeave.value;
      if (reduced) {
        weave.set(0, 0);
        uniforms.uFlicker.value = exposure - 1;
        return;
      }
      const res = uniforms.uRes.value;
      const aspect = res.y > 0 ? res.x / res.y : 1;
      const wAmp = FILM.weaveRms / KNOT_NOISE_STD;
      weave.set(
        clampAbs(knotNoise(c.t, STEP_FPS, 0x51) * wAmp, FILM.weaveClamp) / aspect,
        clampAbs(knotNoise(c.t, STEP_FPS, 0x9e) * wAmp, FILM.weaveClamp),
      );
      const flicker = clampAbs(knotNoise(c.t, FLICKER_HZ, 0x3c) * (FILM.flickerRms / KNOT_NOISE_STD), FILM.flickerClamp);
      uniforms.uFlicker.value = (1 + flicker) * exposure - 1;
    },
    async warm(target) {
      renderer.initTexture(black);
      await Promise.all([renderer.compileAsync(scene, camera), ...halation.scenes.map((s) => renderer.compileAsync(s, camera))]);
      render(target);
    },
    dispose() {
      offQuality();
      halation.dispose();
      material.dispose();
      geometry.dispose();
      black.dispose();
    },
  };
}
