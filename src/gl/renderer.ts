import { DataTexture, PerspectiveCamera, RGBAFormat, SRGBColorSpace, Scene, WebGLRenderer } from 'three';
import type { Texture } from 'three';
import type { Clock, Gfx, InfoSnapshot, Loop, Pose, Quality } from '../types.ts';
import { createCutoutBatch } from './cutout.material.ts';
import { createFilmPass } from './film.pass.ts';
import { createFireflies } from './fireflies.ts';
import type { Fireflies } from './fireflies.ts';
import { createGround } from './ground.ts';
import type { Ground } from './ground.ts';
import { sharedUniforms } from './lights.ts';
import { createPond } from './pond.ts';
import type { Pond } from './pond.ts';
import { residentTextureBytes } from './ktx2.ts';
import { createLanternShadow } from './shadow.ts';
import { createSky } from './sky.ts';
import type { Sky } from './sky.ts';
import { createSceneTarget, fitPixels } from './targets.ts';
import type { PixelSize, SceneTarget } from './targets.ts';

/**
 * The gl side of the garden: one WebGL2 renderer, the scene target, the sky, the film pass.
 * Colour pipeline: every program is a RawShaderMaterial, so three converts nothing. Colour atlases are sRGB textures
 * (decoded to linear by the sampler), shaders light and blend in linear into an SRGB8_ALPHA8 target, and the film pass
 * is the only place that grades and encodes to sRGB for the canvas.
 * Wiring (garden/index.ts): call `setPose` in stage 'camera' and `render` in stage 'render'; `warm()` before `ready`.
 */
export interface GlGfx extends Gfx {
  readonly camera: PerspectiveCamera;
  readonly sky: Sky;
  /** The ground plane (one draw): the world builder sets its layout and photo stone. */
  readonly ground: Ground;
  /** Fireflies and motes (one draw): the world builder sets the pockets of the place. */
  readonly fireflies: Fireflies;
  /** The Estanque water (one draw, empty until world calls setRect). */
  readonly pond: Pond;
  readonly target: SceneTarget;
  /** World Y up, camera looks toward -Z; pitch and yaw in radians (positive looks up, positive yaw turns toward +x, order YXZ), fov vertical in degrees. */
  setPose(p: Readonly<Pose> & { readonly yaw?: number }): void;
  /** Film inputs owned by state: reduced motion and the travel exposure dip (1 = none), applied on the next render. */
  setFilm(reduced: boolean, exposure: number): void;
  /** The kaleidoscope intro: an uploaded page texture and the intro channel (0..1), every frame of the intro. */
  setIntro(page: Texture | null, intro: number): void;
  /** The intro motif rects (film pass, kaleido.glsl). */
  setIntroMotifs(rects: readonly (readonly number[])[]): void;
  /** The one resize signal (a single ResizeObserver on the canvas): CSS size, and a counter that grows on every resize. */
  readonly cssW: number;
  readonly cssH: number;
  readonly resizes: number;
}

const NEAR = 0.05;
const FAR = 200;
/** The largest firefly cap of any tier (core/quality.ts): the instance buffer never reallocates. */
const FIREFLY_CAPACITY = 64;

/** `depth`: the scene target gets a depth buffer (free roam: actors drawn last are placed among the cutouts by depth). */
export function createGfx(canvas: HTMLCanvasElement, quality: Quality, loop: Loop, depth = false): GlGfx {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.setPixelRatio(1);

  const scene = new Scene();
  scene.matrixAutoUpdate = false;
  scene.matrixWorldAutoUpdate = false;
  const camera = new PerspectiveCamera(40, 16 / 9, NEAR, FAR);
  camera.rotation.order = 'YXZ';
  const sky = createSky();
  const ground = createGround(sky.uniforms.uMoonBody.value);
  const fireflies = createFireflies(FIREFLY_CAPACITY);
  fireflies.setCount(quality.cfg.fireflies);
  const pond = createPond();
  scene.add(sky.mesh, ground.mesh, pond.mesh, fireflies.mesh);
  const target = createSceneTarget(depth);
  const film = createFilmPass(renderer, quality, depth);
  const shadow = createLanternShadow(renderer, scene, camera);

  const size: PixelSize = { w: 0, h: 0 };
  let cssW = canvas.clientWidth;
  let cssH = canvas.clientHeight;
  let resizes = 1;
  let dirty = true;
  let dprMax = quality.cfg.dprMax;
  let pixelCap = quality.cfg.pixelCap;
  let reduced = false;
  let exposure = 1;

  new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect;
    if (box === undefined) return;
    cssW = box.width;
    cssH = box.height;
    resizes++;
    dirty = true;
    loop.wake();
  }).observe(canvas);
  /** Only a tier change reallocates; DPR steps and the panel scale move the sub-rect (cook/ARCH.md 2.7). */
  quality.onChange((q) => {
    fireflies.setCount(q.cfg.fireflies);
    if (q.cfg.dprMax === dprMax && q.cfg.pixelCap === pixelCap) return;
    dprMax = q.cfg.dprMax;
    pixelCap = q.cfg.pixelCap;
    dirty = true;
  });

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    loop.pause('context-lost');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    size.w = 0;
    dirty = true;
    loop.resume('context-lost');
  });

  /**
   * The canvas and scene target match the display's own pixels up to the tier's dprMax: a buffer above the display ratio
   * was rendered at a fraction of it and resampled twice (up by the film pass, down by the compositor), softening every
   * edge. The scene sub-rect then fills the target 1:1 at full DPR and only shrinks when the adaptive DPR steps down.
   */
  const baseDpr = (): number => Math.min(dprMax, Math.max(quality.cfg.dprMin, window.devicePixelRatio || 1));

  function applySize(): void {
    dirty = false;
    const prevW = size.w;
    const prevH = size.h;
    fitPixels(cssW, cssH, baseDpr(), pixelCap, size);
    if (size.w !== prevW || size.h !== prevH) renderer.setSize(size.w, size.h, false);
    target.resize(size.w, size.h);
    film.resize(size.w, size.h, quality.cfg.pixelCap);
    const aspect = size.w / size.h;
    if (camera.aspect !== aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      updateViewProj();
    }
  }

  function updateViewProj(): void {
    camera.updateMatrixWorld();
    const vp = sharedUniforms.uViewProj.value;
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    sky.uniforms.uInvViewProj.value.copy(vp).invert();
    const m = camera.matrixWorld.elements;
    sharedUniforms.uCamRight.value.set(m[0] ?? 1, m[1] ?? 0, m[2] ?? 0);
    sharedUniforms.uCamUp.value.set(m[4] ?? 0, m[5] ?? 1, m[6] ?? 0);
    sharedUniforms.uCamPos.value.copy(camera.position);
  }

  function renderScene(c: Clock): void {
    if (dirty) applySize();
    target.setScale((quality.scale * dprMax) / baseDpr());
    film.uniforms.uScale.value = target.scale;
    sharedUniforms.uTime.value = c.t;
    fireflies.update(c);
    film.tick(c, reduced, exposure);
    renderer.info.reset();
    shadow.render(depth && quality.tier !== 'low');
    ground.setMarch(quality.tier !== 'low');
    renderer.setRenderTarget(target.target);
    if (depth) renderer.clearDepth();
    renderer.render(scene, camera);
    film.render(target.target);
  }

  /**
   * Hidden warm scene: one instance of every program, so compileAsync covers the fixed set before first use.
   * The probe batch is never disposed: it anchors the cutout program, so evicting every bed never releases it
   * (three frees a program when its last material is disposed, and the next bed would compile on first draw).
   */
  const pixel = new DataTexture(new Uint8Array([128, 128, 255, 0]), 1, 1, RGBAFormat);
  pixel.needsUpdate = true;
  async function warm(): Promise<void> {
    if (dirty) applySize();
    const probe = createCutoutBatch(gfx, pixel, pixel, 1);
    const warmScene = new Scene();
    /** Meshes the garden added before warm (free roam's signposts) are compiled and their textures uploaded too. */
    const added = scene.children.filter((o) => o !== sky.mesh && o !== ground.mesh && o !== pond.mesh && o !== fireflies.mesh);
    warmScene.add(sky.mesh, ground.mesh, pond.mesh, fireflies.mesh, probe.mesh, ...added);
    for (const t of ground.textures) renderer.initTexture(t);
    renderer.setRenderTarget(target.target);
    await renderer.compileAsync(warmScene, camera);
    renderer.render(warmScene, camera);
    await film.warm(target.target);
    scene.add(sky.mesh, ground.mesh, pond.mesh, fireflies.mesh);
    for (const o of added) if (o.parent === warmScene) scene.add(o);
  }

  const gfx: GlGfx = {
    renderer,
    scene,
    film,
    camera,
    sky,
    ground,
    fireflies,
    pond,
    target,
    render: renderScene,
    warm,
    get cssW() { return cssW; },
    get cssH() { return cssH; },
    get resizes() { return resizes; },
    setPose(p): void {
      camera.position.set(p.x, p.y, p.z);
      camera.rotation.set(p.pitch, -(p.yaw ?? 0), 0);
      if (camera.fov !== p.fov) {
        camera.fov = p.fov;
        camera.updateProjectionMatrix();
      }
      updateViewProj();
    },
    info(out: InfoSnapshot): InfoSnapshot {
      const info = renderer.info;
      out.calls = info.render.calls;
      out.triangles = info.render.triangles;
      out.textures = info.memory.textures;
      out.geometries = info.memory.geometries;
      out.programs = info.programs?.length ?? 0;
      out.texBytes = residentTextureBytes();
      out.targetBytes = target.bytes + film.targetBytes + shadow.bytes;
      return out;
    },
    setFilm(r: boolean, e: number): void {
      reduced = r;
      pond.setCalm(r);
      exposure = e;
    },
    setIntroMotifs(rects): void {
      film.setIntroMotifs(rects);
    },
    setIntro(page, intro): void {
      film.setIntro(page, intro);
    },
  };
  return gfx;
}
