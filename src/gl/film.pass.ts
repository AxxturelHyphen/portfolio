import { BufferGeometry, Camera, DataTexture, Float32BufferAttribute, GLSL3, Mesh, RawShaderMaterial, Scene, Vector2, Vector3, Vector4 } from 'three';
import type { Texture, WebGLRenderer, WebGLRenderTarget } from 'three';
import { STEP_FPS } from '../core/motion.ts';
import type { Clock, FilmPass, FilmUniforms, Quality } from '../types.ts';
import { displayHex } from './colour.ts';
import { createFilmDrive } from './film.drive.ts';
import type { FilmExtras } from './film.drive.ts';
import { halationGain } from './film.drive.ts';
import { createHalation } from './halation.ts';
import common from './shaders/common.glsl?raw';
import vertexShader from './shaders/film.vert.glsl?raw';
import fragmentBody from './shaders/film.frag.glsl?raw';
import kaleido from './shaders/kaleido.glsl?raw';
import marks from './shaders/marks.glsl?raw';

// Look constants (cook/SHOTS.md B). Display-referred unless noted.
/** Vignette onset at 55 % of the radius. */
const VIGNETTE_ONSET = 0.55;
/** Warm highlight tint #f3e6cf. */
const HIGHLIGHT = '#f3e6cf';

/** The tunable half of the grade: the rail's archival stills, and free roam's walk. */
interface FilmLook {
  /** Grain std at mid grey (1.0 level of it at the black and white points, luminance weighted), its cell in px at
   * 1080p, and the std of the slow mottle under it. */
  grain: number;
  grainPx: number;
  mottle: number;
  /** Dust specks per frame at 1080p. */
  dust: number;
  /** Lens softness at the corners (0..1 mix toward a 1.6 px blur) and the red/blue fringe there, px at 1080p. */
  soft: number;
  fringe: number;
  /** Corners this much under the centre. */
  vignette: number;
  /** The lifted black of the grade and the colour of a shut iris. Never pure black. */
  black: string;
  /** Exposure on the display value, and the mids opened by x^(1 / gamma). */
  exposure: number;
  gamma: number;
  /** The lows pulled toward the black point, and the saturation kept in the deepest lows. */
  darkPull: number;
  inkKeep: number;
  /** Strength of the pencil hatching and the paper tooth; the hatch half width (in spacings) and share of slots drawn. */
  marks: number;
  hatchWidth: number;
  hatchFill: number;
}

/** The rail (cook/SHOTS.md B): mean V of a night shot near 34 %, black point #0d0a1e, 1 % grain, 4 to 8 specks, soft corners. */
const RAIL_LOOK: FilmLook = {
  grain: 2.5 / 255, grainPx: 1.5, mottle: 1.1 / 255, dust: 6, soft: 0.55, fringe: 0.8, vignette: 0.18, black: '#0d0a1e',
  exposure: 1.28, gamma: 1 / 0.88, darkPull: 0.42, inkKeep: 0.6, marks: 1, hatchWidth: 0.09, hatchFill: 0.5,
};
/**
 * Free roam is walked through, not looked at: a sharp lens edge to edge, and every dark layer over the picture (grain,
 * hatching, tooth, the pull of the lows, the vignette) at about a third, so the textures read through. The grain is a
 * pixel fine and, with the rest of the film, held still (film.drive.ts); no dust. A lighter night: the darkest ground
 * sits near 25 of 255 instead of crushing to ink.
 */
const ROAM_LOOK: FilmLook = {
  grain: 0.85 / 255, grainPx: 0.8, mottle: 0, dust: 0, soft: 0, fringe: 0.25, vignette: 0.06, black: '#14111f',
  exposure: 1.28, gamma: 1 / 0.88, darkPull: 0.14, inkKeep: 0.87, marks: 0.33, hatchWidth: 0.06, hatchFill: 0.3,
};

/** The film pass plus what the Gfx owner drives per frame. */
export interface FilmDriver extends FilmPass {
  /** Per frame, before render(): time, seed, weave, flicker, scratch, tint breathing. `exposure` multiplies in. */
  tick(c: Clock, reduced: boolean, exposure: number): void;
  /**
   * The kaleidoscope intro: `page` is the plate shown in radial symmetry, `intro` the intro channel (0..1). Below 1 the
   * mandala fills what the iris does not show; at 1 the iris is plain again. Null keeps the plain ground. No allocation.
   */
  setIntro(page: Texture | null, intro: number): void;
  /** The uv rects of the intro motifs (hub, rose, leaf, plume, swallow), once the intro manifest is read. */
  setIntroMotifs(rects: readonly (readonly number[])[]): void;
  /** Compiles the film and halation programs, uploads the fallback texture and runs the chain once into its targets. */
  warm(scene: WebGLRenderTarget): Promise<void>;
  dispose(): void;
}

function fullscreenTriangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return g;
}

function filmUniforms(black: DataTexture, look: FilmLook): FilmUniforms {
  const lift = displayHex(look.black, new Vector3());
  const e = look.exposure;
  const g = look.gamma;
  return {
    uScene: { value: black }, uHalation: { value: black }, uRes: { value: new Vector2(1, 1) }, uScale: { value: 1 },
    uTime: { value: 0 }, uSeed: { value: 0 }, uGrain: { value: look.grain }, uWeave: { value: new Vector2() },
    uDust: { value: look.dust }, uFlicker: { value: 0 }, uVignette: { value: new Vector2(look.vignette, VIGNETTE_ONSET) },
    // Gain and gamma per channel: a touch warm in the highs, a touch cool in the mids.
    uSoft: { value: look.soft }, uLift: { value: lift }, uGamma: { value: new Vector3(g, g, g * 1.04) },
    uGain: { value: new Vector3(1.04 * e, e, 0.95 * e) }, uTint: { value: [new Vector4(), new Vector4(), new Vector4()] },
    uIris: { value: new Vector4(0.5, 0.5, 1.2, 0.018) }, uIrisColor: { value: lift.clone() },
    uStrip: { value: new Vector4() }, uProtect: { value: new Vector3() }, uStatic: { value: 0 }, uFilmOn: { value: 1 },
  };
}

/**
 * The single combined film pass (cook/ARCH.md 2.7): one fullscreen triangle to the canvas, plus the quarter-res
 * halation chain that the tier can switch off. `resize` takes the scene target size (the canvas size).
 * The caller owns uScale, uIris, uStrip, uProtect and uFilmOn (0 for ?film=0: everything but the sRGB encode is
 * bypassed, halation included). render() reads cfg.filmScale and cfg.halation every frame, so tier and DPR changes
 * reallocate nothing but the halation targets on a tier change. `roam` picks free roam's look over the rail's.
 */
export function createFilmPass(renderer: WebGLRenderer, quality: Quality, roam = false): FilmDriver {
  const look = roam ? ROAM_LOOK : RAIL_LOOK;
  const camera = new Camera();
  const geometry = fullscreenTriangle();
  const black = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;
  const clear = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  clear.needsUpdate = true;
  const uniforms = filmUniforms(black, look);
  const extras: FilmExtras & {
    uHighlight: { value: Vector3 }; uKaleido: { value: Texture }; uKRect: { value: Vector4[] }; uIntro: { value: number };
    uBoil: { value: number }; uHatch: { value: number }; uMarks: { value: number }; uFringe: { value: number };
    uDarkPull: { value: number }; uInkKeep: { value: number }; uGrainShape: { value: Vector2 }; uHatchLine: { value: Vector2 };
  } = {
    uScratch: { value: new Vector3() },
    uHalGain: { value: halationGain(roam) },
    uHighlight: { value: displayHex(HIGHLIGHT, new Vector3()) },
    uKaleido: { value: clear },
    uKRect: { value: Array.from({ length: 5 }, () => new Vector4()) },
    uIntro: { value: 1 },
    uBoil: { value: 0 },
    uHatch: { value: 1 },
    uMarks: { value: look.marks },
    uFringe: { value: look.fringe },
    uDarkPull: { value: look.darkPull },
    uInkKeep: { value: look.inkKeep },
    uGrainShape: { value: new Vector2(look.grainPx, look.mottle) },
    uHatchLine: { value: new Vector2(look.hatchWidth, look.hatchFill) },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3, vertexShader, fragmentShader: common + kaleido + marks + fragmentBody, uniforms: { ...uniforms, ...extras }, depthTest: false, depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const scene = new Scene();
  scene.matrixWorldAutoUpdate = false;
  scene.add(mesh);
  const halation = createHalation(renderer, geometry, camera, roam);
  const drive = createFilmDrive(uniforms, extras, roam);
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
    extras.uHatch.value = quality.cfg.tier === 'low' ? 0 : 1;
    uniforms.uRes.value.set(buffer.x * quality.cfg.filmScale, buffer.y * quality.cfg.filmScale);
    // A fully shut iris (radius 0) covers every pixel, so the halation would never be read.
    const seen = uniforms.uFilmOn.value > 0.5 && uniforms.uIris.value.z > 0;
    if (halation.allocated && quality.cfg.halation && seen) {
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
      drive.tick(c, reduced, exposure);
      extras.uBoil.value = reduced || roam ? 0 : Math.floor(c.t * STEP_FPS);
    },
    setIntro(page, intro) {
      extras.uKaleido.value = page ?? clear;
      extras.uIntro.value = intro;
    },
    setIntroMotifs(rects) {
      rects.forEach((r, i) => extras.uKRect.value[i]?.set(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0, r[3] ?? 0));
    },
    async warm(target) {
      renderer.initTexture(black);
      renderer.initTexture(clear);
      await Promise.all([renderer.compileAsync(scene, camera), ...halation.scenes.map((s) => renderer.compileAsync(s, camera))]);
      render(target);
    },
    dispose() {
      offQuality();
      halation.dispose();
      material.dispose();
      geometry.dispose();
      black.dispose();
      clear.dispose();
    },
  };
}
