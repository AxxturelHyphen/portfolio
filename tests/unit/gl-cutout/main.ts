import type { AtlasManifest, Clock, InfoSnapshot, Loop, Pose, QuadParams, Quality, TierConfig } from '../../../src/types.ts';
import { createCutoutBatch, sharedUniforms } from '../../../src/gl/cutout.material.ts';
import { createGfx } from '../../../src/gl/renderer.ts';
import { loadAtlas, uploadTexture } from '../../../src/gl/ktx2.ts';
import { drawPlaceholderAtlas, SPRITES } from './placeholder.ts';

// gl-cutout test page: 200 placeholder cutouts in 5 depth layers (one batch each), relit by a moving cursor light.
// ?t=<seconds> freezes the clock. window.__gl exposes counters for the Playwright check.

const params = new URLSearchParams(location.search);
const frozenT = params.has('t') ? Number(params.get('t')) : null;
const LAYERS = 5;
const PER_LAYER = 40;

const cfg: TierConfig = {
  tier: 'high', dprMin: 0.75, dprMax: 1.5, pixelCap: 1920 * 1080 * 1.5, halation: true, filmScale: 1,
  maxLayers: 8, fireflies: 0, atlas: 'hi', texBudgetMB: 128, drawBudget: 80,
};
const quality: Quality = {
  tier: 'high', cfg, dpr: 1, scale: 1,
  probe: () => Promise.resolve('high'), adapt: () => undefined, setPanelScale: () => undefined, onChange: () => () => undefined,
};
const loop: Loop = {
  on: () => () => undefined, start: () => undefined, pause: () => undefined, resume: () => undefined, wake: () => undefined,
  running: true, rec: { start: () => undefined, stop: () => ({ label: '', frames: 0, avg: 0, p95: 0, max: 0, over25: 0, over50: 0, over100: 0, longTasks: 0, callsP95: 0 }) },
};

const canvas = document.querySelector('canvas');
if (canvas === null) throw new Error('no canvas');
const gfx = createGfx(canvas, quality, loop);
const pose: Pose = { x: 0, y: 1.2, z: 11, pitch: -0.04, fov: 40 };
gfx.setPose(pose);

/** Deterministic pseudo-random numbers, so the screenshot is stable. */
let seed = 7;
const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);

async function main(): Promise<void> {
  const urls = await drawPlaceholderAtlas();
  const manifest: AtlasManifest = {
    id: 'shared', hash: 'test', sprites: {}, blooms: {},
    pages: [{ w: 512, h: 512, color: { hi: urls.color, lo: urls.color }, normal: { hi: urls.normal, lo: urls.normal }, fileBytes: { hi: 0, lo: 0 } }],
  };
  const atlas = await loadAtlas(gfx, manifest, 'hi', new AbortController().signal);
  const color = atlas.color[0];
  const normal = atlas.normal[0];
  if (color === undefined || normal === undefined) throw new Error('atlas page missing');
  uploadTexture(gfx, color);
  uploadTexture(gfx, normal);

  const quad: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 1, h: 1, px: 0.5, py: 0, uv: [0, 0, 1, 1], sway: 0, phase: 0, lift: 0, facing: 0, tint: [1, 1, 1, 1] };
  const tint = [1, 1, 1, 1];
  for (let layer = 0; layer < LAYERS; layer++) {
    const batch = createCutoutBatch(gfx, color, normal, PER_LAYER);
    const z = -(LAYERS - 1 - layer) * 2.2;
    for (let i = 0; i < PER_LAYER; i++) {
      const sprite = SPRITES[Math.floor(rand() * SPRITES.length)];
      if (sprite === undefined) continue;
      const s = 0.6 + rand() * 0.9;
      quad.x = (rand() * 2 - 1) * (7 + layer * 0.4 - z * 0.45);
      quad.y = -1.6 + rand() * 1.6 + z * 0.08;
      quad.z = z + rand() * 0.3;
      quad.rot = (rand() - 0.5) * 0.3;
      quad.w = sprite.aspect * s;
      quad.h = s;
      quad.uv = rand() < 0.5 ? sprite.uv : [sprite.uv[2], sprite.uv[1], sprite.uv[0], sprite.uv[3]];
      quad.sway = 0.02 + rand() * 0.04;
      quad.phase = rand() * 6.28;
      quad.lift = 0.3 + rand() * 0.7;
      const shade = 0.75 + rand() * 0.25;
      tint[0] = sprite.tint[0] * shade; tint[1] = sprite.tint[1] * shade; tint[2] = sprite.tint[2] * shade;
      quad.tint = tint;
      batch.writer.set(i, quad);
    }
    batch.writer.count = PER_LAYER;
    batch.writer.commit(0, PER_LAYER);
    batch.mesh.renderOrder = layer;
    gfx.scene.add(batch.mesh);
  }

  await gfx.warm();
  const programsAfterWarm = gfx.renderer.info.programs?.length ?? 0;
  const snapshot: InfoSnapshot = { calls: 0, triangles: 0, textures: 0, geometries: 0, programs: 0, texBytes: 0, targetBytes: 0 };
  let frame = 0;
  const start = performance.now();
  const clock = { now: 0, dt: 0, t: 0, frame: 0, frozen: frozenT !== null };

  function tick(now: number): void {
    clock.dt = Math.min((now - clock.now) / 1000, 0.05);
    clock.now = now;
    clock.t = frozenT ?? (now - start) / 1000;
    clock.frame = frame++;
    const a = clock.t * 0.6;
    sharedUniforms.uCursor.value.set(Math.sin(a) * 6, 0.2 + Math.cos(a * 1.3) * 0.8, 1.2, 4.5);
    gfx.render(clock as Clock);
    gfx.info(snapshot);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  (window as unknown as { __gl: object }).__gl = {
    info: () => snapshot,
    frame: () => frame,
    programsAfterWarm: () => programsAfterWarm,
    programs: () => gfx.renderer.info.programs?.length ?? 0,
  };
}

main().catch((e: unknown) => { document.body.dataset['error'] = String(e); throw e; });
