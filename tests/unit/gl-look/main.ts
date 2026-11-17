// gl-look test page: the whole look at 1920x1080 through the real gl path (sky and moon, ground with path and puddles,
// 30 cutouts from real plates relit by the hand light, fireflies, film pass). Driven by shoot.ts through window.look.
// Dev only, never built or shipped. Layout follows the Rosaleda of cook/ART.md section 2.2.
import { CanvasTexture, SRGBColorSpace, TextureLoader, Vector4 } from 'three';
import type { Texture } from 'three';
import { irisOf } from '../../../src/core/motion.ts';
import { createCutoutBatch, sharedUniforms } from '../../../src/gl/cutout.material.ts';
import { QUAD_FLAG, packPhase } from '../../../src/gl/instances.ts';
import { createGfx } from '../../../src/gl/renderer.ts';
import type { Clock, InfoSnapshot, Loop, Pose, QuadParams, Quality, TierConfig } from '../../../src/types.ts';
import { buildPlateAtlas } from './plates.ts';
import { PLACEMENTS, WALL } from './placements.ts';

const HIGH: TierConfig = { tier: 'high', dprMin: 1, dprMax: 1, pixelCap: 1920 * 1080, halation: true, filmScale: 1, maxLayers: 8, fireflies: 64, atlas: 'hi', texBudgetMB: 128, drawBudget: 80 };
const LOW: TierConfig = { ...HIGH, tier: 'low', halation: false, filmScale: 0.5, fireflies: 16, atlas: 'lo', texBudgetMB: 48, drawBudget: 40 };
const listeners = new Set<(q: Quality) => void>();
const quality: Quality & { cfg: TierConfig; tier: TierConfig['tier'] } = {
  tier: 'high', cfg: HIGH, dpr: 1, scale: 1,
  probe: () => Promise.resolve('high'), adapt: () => undefined, setPanelScale: () => undefined,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
const loop: Loop = {
  on: () => () => undefined, start: () => undefined, pause: () => undefined, resume: () => undefined, wake: () => undefined,
  running: true, rec: { start: () => undefined, stop: () => ({ label: '', frames: 0, avg: 0, p95: 0, max: 0, over25: 0, over50: 0, over100: 0, longTasks: 0, callsP95: 0 }) },
};

const canvas = document.querySelector('canvas');
if (canvas === null) throw new Error('no canvas');
const gfx = createGfx(canvas, quality, loop);
const pose: Pose = { x: 10.6, y: 1.75, z: 6.6, pitch: -0.075, fov: 40 };
const clock: Clock & { t: number; now: number; frame: number } = { now: 0, dt: 1 / 60, t: 2, frame: 0, frozen: true };
const HERO_BLOOM: [number, number, number] = [11.55, 1.7, -1.5];
const CURSOR = new Vector4(11.0, 1.35, -0.4, 2.4);

function plateTexture(c: HTMLCanvasElement, srgb: boolean): Texture {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

async function setup(): Promise<void> {
  const atlas = await buildPlateAtlas('/archive/raw/');
  const color = plateTexture(atlas.color, true);
  const normal = plateTexture(atlas.normal, false);
  const loader = new TextureLoader();
  const [wallC, wallN, stoneC, stoneN] = await Promise.all([
    loader.loadAsync('/archive/raw/textures/ph-old-stone-wall_diff_2k.jpg'),
    loader.loadAsync('/archive/raw/textures/ph-old-stone-wall_nor_2k.jpg'),
    loader.loadAsync('/archive/raw/textures/ph-grey-stone-path_diff_2k.jpg'),
    loader.loadAsync('/archive/raw/textures/ph-grey-stone-path_nor_2k.jpg'),
  ]);
  wallC.colorSpace = SRGBColorSpace;
  stoneC.colorSpace = SRGBColorSpace;
  gfx.ground.setStone(stoneC, stoneN);

  const quad: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 1, h: 1, px: 0.5, py: 0, uv: [0, 0, 1, 1], sway: 0, phase: 0, lift: 0, facing: 0, tint: [1, 1, 1, 1] };
  const wall = createCutoutBatch(gfx, wallC, wallN, WALL.length);
  WALL.forEach((f, i) => {
    Object.assign(quad, { x: f.x, y: 0, z: f.z, w: 2.4, h: f.h, px: 0.5, py: 0, uv: f.uv, sway: 0, phase: packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.noShadow), lift: 0, facing: f.yaw, tint: f.tint });
    wall.writer.set(i, quad);
  });
  wall.writer.count = WALL.length;
  wall.writer.commit(0, WALL.length);
  wall.mesh.renderOrder = 0;
  gfx.scene.add(wall.mesh);

  const sorted = [...PLACEMENTS].sort((a, b) => a.z - b.z);
  const plates = createCutoutBatch(gfx, color, normal, sorted.length);
  sorted.forEach((p, i) => {
    const s = atlas.sprites[p.sprite];
    if (s === undefined) throw new Error(`no sprite ${p.sprite}`);
    const uv = p.flip ? [s.uv[2], s.uv[1], s.uv[0], s.uv[3]] : s.uv;
    Object.assign(quad, { x: p.x, y: p.y ?? 0, z: p.z, w: p.h * s.aspect, h: p.h, px: 0.5, py: 0, uv, sway: p.sway ?? 0.02, phase: packPhase(i * 1.7, p.flags ?? 0), lift: p.lift ?? 0.5, facing: (p.yaw * Math.PI) / 180, tint: p.tint });
    plates.writer.set(i, quad);
  });
  plates.writer.count = sorted.length;
  plates.writer.commit(0, sorted.length);
  plates.mesh.renderOrder = 1;
  gfx.scene.add(plates.mesh);
  gfx.setPose(pose);
  await gfx.warm();
}

interface Shot { t?: number; reduced?: boolean; tier?: 'high' | 'low'; filmOn?: boolean; cursor?: [number, number, number]; key?: boolean }

/** The Rosaleda key of cook/ART.md section 1 (no sky in frame: the moon is seen in the puddles). */
const KEY: Pose = { x: 10.6, y: 2.6, z: 4.6, pitch: -0.314, fov: 35 };

function protectHero(): void {
  const v = new Vector4(...HERO_BLOOM, 1).applyMatrix4(sharedUniforms.uViewProj.value);
  gfx.film.uniforms.uProtect.value.set(v.x / v.w * 0.5 + 0.5, v.y / v.w * 0.5 + 0.5, 0.14);
}

function apply(s: Shot): void {
  const cfg = s.tier === 'low' ? LOW : HIGH;
  if (quality.cfg !== cfg) {
    quality.cfg = cfg;
    quality.tier = cfg.tier;
    for (const fn of listeners) fn(quality);
  }
  clock.t = s.t ?? 2;
  clock.now += 1000 / 60;
  clock.frame++;
  gfx.setPose(s.key === true ? KEY : pose);
  gfx.film.uniforms.uFilmOn.value = s.filmOn === false ? 0 : 1;
  const c = s.cursor ?? [CURSOR.x, CURSOR.y, CURSOR.z];
  sharedUniforms.uCursor.value.set(c[0], c[1], c[2], CURSOR.w);
  irisOf(1, 0.5, 0.5, 16 / 9, gfx.film.uniforms.uIris.value);
  gfx.setFilm(s.reduced ?? false, 1);
  protectHero();
}

function show(s: Shot): void {
  apply(s);
  gfx.render(clock);
}

const nextFrame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));

/** GPU time per frame of the whole frame and of the film pass alone (EXT_disjoint_timer_query_webgl2). */
async function time(s: Shot, frames: number): Promise<{ frameMs: number; filmMs: number; samples: number }> {
  const gl = gfx.renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  if (ext === null) return { frameMs: -1, filmMs: -1, samples: 0 };
  const frame: WebGLQuery[] = [];
  const film: WebGLQuery[] = [];
  for (let i = 0; i < frames; i++) {
    await nextFrame();
    apply({ ...s, t: (s.t ?? 2) + i / 60 });
    const q = gl.createQuery();
    if (q === null) break;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    gfx.render(clock);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    frame.push(q);
    const f = gl.createQuery();
    if (f === null) break;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, f);
    gfx.film.render(gfx.target.target);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    film.push(f);
  }
  for (let i = 0; i < 30; i++) await nextFrame();
  const avg = (qs: WebGLQuery[]): [number, number] => {
    let sum = 0, n = 0;
    for (const q of qs) {
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT)) { sum += gl.getQueryParameter(q, gl.QUERY_RESULT) as number; n++; }
      gl.deleteQuery(q);
    }
    return [n > 0 ? sum / n / 1e6 : -1, n];
  };
  const [frameMs, samples] = avg(frame);
  const [filmMs] = avg(film);
  return { frameMs, filmMs, samples };
}

const ready = setup();
const snapshot: InfoSnapshot = { calls: 0, triangles: 0, textures: 0, geometries: 0, programs: 0, texBytes: 0, targetBytes: 0 };
declare global { interface Window { look: { ready: Promise<void>; show(s: Shot): void; time(s: Shot, frames: number): Promise<{ frameMs: number; filmMs: number; samples: number }>; info(): InfoSnapshot } } }
window.look = { ready, show, time, info: () => gfx.info(snapshot) };
