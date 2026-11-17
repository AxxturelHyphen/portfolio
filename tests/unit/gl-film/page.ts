// Standalone bench page for the film pass: a reference still is drawn into a linear scene target, then the real
// film pass runs over it. Driven by shoot.ts through window.filmBench. Dev only, never built or shipped.
import { BufferGeometry, Camera, Float32BufferAttribute, GLSL3, HalfFloatType, LinearFilter, Mesh, RawShaderMaterial, SRGBColorSpace, Scene, TextureLoader, WebGLRenderTarget, WebGLRenderer } from 'three';
import { createFilmPass, type FilmDriver } from '../../../src/gl/film.pass.ts';
import { irisOf, stripOf } from '../../../src/core/motion.ts';
import type { Quality, TierConfig } from '../../../src/types.ts';
import vertexShader from '../../../src/gl/shaders/film.vert.glsl?raw';

const W = 1920;
const H = 1080;
const IMAGE = new URLSearchParams(location.search).get('img') ?? '/cook/refs/R06.png';

const HIGH: TierConfig = { tier: 'high', dprMin: 1, dprMax: 1, pixelCap: W * H, halation: true, filmScale: 1, maxLayers: 7, fireflies: 64, atlas: 'hi', texBudgetMB: 128, drawBudget: 80 };
const LOW: TierConfig = { ...HIGH, tier: 'low', halation: false, filmScale: 0.5, atlas: 'lo', texBudgetMB: 48, drawBudget: 40 };

const listeners = new Set<(q: Quality) => void>();
const quality: Quality & { cfg: TierConfig; tier: TierConfig['tier'] } = {
  tier: 'high', cfg: HIGH, dpr: 1, scale: 1,
  probe: () => Promise.resolve('high'), adapt: () => undefined, setPanelScale: () => undefined,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
const clock = { now: 0, dt: 1 / 60, t: 0, frame: 0, frozen: true };

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
const sceneTarget = new WebGLRenderTarget(W, H, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
const camera = new Camera();

const blit = new RawShaderMaterial({
  glslVersion: GLSL3, vertexShader, depthTest: false, depthWrite: false, uniforms: { uImage: { value: null } },
  fragmentShader: 'precision highp float; uniform sampler2D uImage; in vec2 vUv; out vec4 o; void main(){ o = texture(uImage, vUv); }',
});

const film = createFilmPass(renderer, quality);
const bypass = createFilmPass(renderer, quality);
bypass.uniforms.uFilmOn.value = 0;
const blitScene = new Scene();
const triangle = new BufferGeometry();
triangle.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const blitMesh = new Mesh(triangle, blit);
blitMesh.frustumCulled = false;
blitScene.add(blitMesh);

async function setup(): Promise<void> {
  const tex = await new TextureLoader().loadAsync(IMAGE);
  tex.colorSpace = SRGBColorSpace;
  blit.uniforms['uImage']!.value = tex;
  film.resize(W, H, HIGH.pixelCap);
  bypass.resize(W, H, HIGH.pixelCap);
  await film.warm(sceneTarget);
  await bypass.warm(sceneTarget);
}

interface Shot { open?: number; leg?: number; stripX?: number; reduced?: boolean; t?: number; tier?: 'high' | 'low'; filmOn?: boolean; flower?: [number, number] }

function setTier(t: 'high' | 'low'): void {
  if (quality.tier === t) return;
  quality.tier = t;
  quality.cfg = t === 'high' ? HIGH : LOW;
  for (const fn of listeners) fn(quality);
}

function apply(s: Shot): FilmDriver {
  setTier(s.tier ?? 'high');
  clock.t = s.t ?? 1.25;
  const pass = s.filmOn === false ? bypass : film;
  const u = pass.uniforms;
  const [fx, fy] = s.flower ?? [0.62, 0.42];
  irisOf(s.open ?? 0, fx, fy, W / H, u.uIris.value);
  if (s.leg !== undefined) stripOf(s.leg, 2, u.uStrip.value);
  else if (s.stripX !== undefined) u.uStrip.value.set(s.stripX, 0.03, 1, 1);
  else u.uStrip.value.set(0, 0, 0, 0);
  pass.tick(clock, s.reduced ?? false, 1);
  return pass;
}

function drawScene(): void {
  renderer.setRenderTarget(sceneTarget);
  renderer.render(blitScene, camera);
}

function show(s: Shot): void {
  const pass = apply(s);
  drawScene();
  pass.render(sceneTarget);
}

const nextFrame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));

/** GPU time of the film pass (halation included) per frame, from EXT_disjoint_timer_query_webgl2 when exposed. */
async function time(s: Shot, frames: number): Promise<{ ms: number; method: string }> {
  const pass = apply(s);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  if (ext) {
    const queries: WebGLQuery[] = [];
    for (let i = 0; i < frames; i++) {
      await nextFrame();
      drawScene();
      const q = gl.createQuery()!;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      pass.render(sceneTarget);
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      queries.push(q);
    }
    for (let i = 0; i < 30; i++) await nextFrame();
    let sum = 0;
    let n = 0;
    for (const q of queries) {
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        sum += gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        n++;
      }
      gl.deleteQuery(q);
    }
    if (n > 0) return { ms: sum / n / 1e6, method: `timer query, ${n} samples` };
  }
  const px = new Uint8Array(4);
  drawScene();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) pass.render(sceneTarget);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { ms: (performance.now() - t0) / frames, method: 'cpu wall time with readPixels sync' };
}

const ready = setup();

declare global { interface Window { filmBench: { ready: Promise<void>; show(s: Shot): void; time(s: Shot, frames: number): Promise<{ ms: number; method: string }>; programs(): number } } }
window.filmBench = { ready, show, time, programs: () => renderer.info.programs?.length ?? 0 };
