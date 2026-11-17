import type {
  AtlasManifest, AtlasTextures, Bed, BedBehaviour, BedCtx, BedId, BedModule, BedScene, BedState, CameraRig, Channel, Clock, Content,
  CreateCutoutBatch, CutoutBatch, Gfx, Lang, Layer, LightRig, LoadAtlas, Machine, Moth, Project, ProjectBed, QuadParams,
  Quality, SlotView, State,
} from '../types.ts';
import type { Texture } from 'three';
import { spring } from '../core/spring.ts';
import { STREAM } from '../core/motion.ts';
import { createFlower, type GardenFlower } from './flower.ts';
import { bindSlots, keptLayers, relabel, slotLayer } from './scene.ts';

/** What the composition root (src/garden/index.ts) hands the world from gl/ and content/, which world may not import. */
export interface StreamKit {
  /** gl/ktx2.ts loadAtlas; `prefetched` holds page bytes fetched ahead, taken (and emptied) by the load. */
  loadAtlas(...a: [...Parameters<LoadAtlas>, prefetched?: Map<string, ArrayBuffer>]): ReturnType<LoadAtlas>;
  createCutoutBatch: CreateCutoutBatch;
  /** gl/ktx2.ts uploadTexture: uploads now and counts the bytes until the texture is disposed. */
  uploadTexture(gfx: Gfx, tex: Texture): number;
  projectsOf(bed: ProjectBed): Project[];
  moth(): Moth;
  /** The loop's 'dom' stage: fn runs there until the returned function is called. */
  onDom(fn: (c: Clock) => void): () => void;
  /** ui/xform.ts createMover: preallocated transform writes. */
  createMover(el: HTMLElement): DomMover;
}

/** Transform writer that allocates nothing per frame (ui/xform.ts Mover, seen from world). */
export interface DomMover { move(x: number, y: number, s: number): void; reset(): void }

/** What a bed behaviour gets: the BedCtx of cook/ARCH.md 2.6 plus its DOM stage, since world may not import ui. */
export interface StreamBedCtx extends BedCtx {
  onDom: StreamKit['onDom'];
  createMover: StreamKit['createMover'];
}

/** Shared world context of every bed. */
export interface BedEnv { gfx: Gfx; machine: Machine; rig: CameraRig; light: LightRig; quality: Quality; content: Content; kit: StreamKit }

/** Load work gate owned by the residency: one grant per frame, a time slice and an upload allowance. */
export interface Slicer { frame(): Promise<void>; upload(): Promise<void>; spent(): boolean }

/** Paint order: the overview atlas under every bed, the grotto under its host so the ivy covers it. */
export const RENDER_ORDER = { overview: -1, hidden: 0, bed: 100 } as const;
const ACTOR_CAPACITY = 64;
const DEG = Math.PI / 180;
const NO_TINT: readonly [number, number, number] = [1, 1, 1];

const behaviours = import.meta.glob<BedModule>('./behaviours/*.ts');

export const atlasUrl = (file: string): string => new URL(`atlas/${file}`, document.baseURI).href;

export async function fetchManifest(name: string, signal: AbortSignal): Promise<AtlasManifest> {
  const res = await fetch(atlasUrl(`${name}.json`), { signal });
  if (!res.ok) throw new Error(`atlas ${name}: HTTP ${res.status}`);
  return (await res.json()) as AtlasManifest;
}

/** Uploads every page, one texture per granted upload, so no frame carries more than one. */
export async function uploadPages(env: BedEnv, tex: AtlasTextures, slicer: Slicer, alive: () => boolean): Promise<boolean> {
  for (let i = 0; i < tex.color.length; i++) {
    for (const t of [tex.color[i], tex.normal[i]]) {
      if (t === undefined) continue;
      await slicer.upload();
      if (!alive()) return false;
      env.kit.uploadTexture(env.gfx, t);
    }
  }
  return true;
}

const scratch: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0, py: 0, uv: [0, 0, 0, 0], sway: 0, phase: 0, lift: 0, facing: 0, tint: [1, 1, 1, 1] };
const tint = new Float32Array(4);
scratch.tint = tint;

interface FlowerRef { flower: GardenFlower; batch: CutoutBatch; at: number }

export class StreamBed implements Bed {
  state: BedState = 'cold';
  gpuBytes = 0;
  drawCalls = 0;
  readonly reveal: Channel = spring(STREAM.revealS);
  readonly slots: SlotView[];
  manifest: AtlasManifest | null = null;
  private prefetching: Promise<void> | null = null;
  private module: BedModule | null = null;
  private gen = -1;
  private abort: AbortController | null = null;
  private tex: AtlasTextures | null = null;
  /** Page bytes from prefetch, handed to the one load that uses them, so nothing downloads twice. */
  private pageBytes: Map<string, ArrayBuffer> | null = null;
  private batches: CutoutBatch[] = [];
  private flowers: FlowerRef[] = [];
  private actors: CutoutBatch | null = null;
  private behaviour: BedBehaviour | null = null;

  constructor(readonly id: BedId, readonly scene: BedScene, readonly anchorX: number, private readonly env: BedEnv, private readonly slicer: Slicer) {
    const projects = id === 'rosaleda' || id === 'estanque' || id === 'semillero' ? env.kit.projectsOf(id) : [];
    this.slots = bindSlots({ scene, anchorX, projects, profile: env.content.profile, lang: env.machine.state.lang });
  }

  /** Bytes only: manifest, KTX2 files (kept for the load) and the behaviour chunk. No GPU work. */
  prefetch(signal: AbortSignal): Promise<void> {
    if (this.state !== 'cold' && this.state !== 'disposed') return this.prefetching ?? Promise.resolve();
    this.prefetching ??= this.fetchBytes(signal).catch((err: unknown) => {
      this.prefetching = null;
      throw err;
    });
    return this.prefetching;
  }

  private async fetchBytes(signal: AbortSignal): Promise<void> {
    const variant = this.env.quality.cfg.atlas;
    const manifest = this.manifest ?? (await fetchManifest(this.id, signal));
    const pageBytes = new Map<string, ArrayBuffer>();
    await Promise.all(manifest.pages.flatMap((p) => [p.color[variant], p.normal[variant]]).map(async (file) => {
      const res = await fetch(atlasUrl(file), { signal });
      if (!res.ok) throw new Error(`atlas ${this.id}: ${file} HTTP ${res.status}`);
      pageBytes.set(file, await res.arrayBuffer());
    }));
    if (this.scene.behaviour !== undefined) {
      const load = behaviours[`./behaviours/${this.scene.behaviour}.ts`];
      if (load === undefined) throw new Error(`bed ${this.id}: no behaviour module "${this.scene.behaviour}"`);
      this.module = await load();
    }
    this.manifest = manifest;
    if (this.state === 'cold' || this.state === 'disposed') {
      this.pageBytes = pageBytes;
      this.state = 'prefetched';
    }
  }

  /** Worker transcode, one upload per frame, instance buffers in time slices, one hidden warm draw, then 'ready'. */
  async load(gen: number): Promise<void> {
    if (this.state === 'loading' || this.state === 'ready' || this.state === 'active') return;
    this.gen = gen;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const alive = (): boolean => this.gen === gen;
    await this.prefetch(signal);
    const manifest = this.manifest;
    if (!alive() || manifest === null) return;
    this.state = 'loading';
    try {
      const pageBytes = this.pageBytes ?? undefined;
      this.pageBytes = null;
      const tex = await this.env.kit.loadAtlas(this.env.gfx, manifest, this.env.quality.cfg.atlas, signal, pageBytes);
      if (!alive()) {
        for (const t of [...tex.color, ...tex.normal]) t.dispose();
        return;
      }
      this.tex = tex;
      this.gpuBytes = tex.gpuBytes;
      if (!(await uploadPages(this.env, tex, this.slicer, alive))) return;
      if (!(await this.build(manifest, tex, alive))) return;
      this.reveal.snap(0);
      this.setUniformReveal(0);
      for (const b of this.batches) this.env.gfx.scene.add(b.mesh);
      if (this.actors !== null) this.env.gfx.scene.add(this.actors.mesh);
      await this.slicer.frame();
      if (!alive()) return;
      this.state = 'ready';
    } catch (err) {
      if (alive()) throw err;
    }
  }

  private async build(m: AtlasManifest, tex: AtlasTextures, alive: () => boolean): Promise<boolean> {
    const env = this.env;
    const layers = keptLayers(this.scene, env.quality.tier, env.quality.cfg.maxLayers);
    const perLayer: GardenFlower[][] = layers.map(() => []);
    for (const view of this.slots) {
      const slot = this.scene.slots.find((s) => `${this.id}/${s.id}` === view.id);
      if (view.kind !== 'project' || slot === undefined) continue;
      const bloom = m.blooms[slot.bloom ?? slot.accepts ?? ''];
      if (bloom === undefined) throw new Error(`bed ${this.id}: bloom "${slot.bloom ?? ''}" is missing from atlas/${this.id}.json`);
      const flower = createFlower({ slot: view, bloom, sprites: m.sprites, scale: slot.scale, env: env.machine });
      perLayer[slotLayer(layers, slot)]?.push(flower);
    }
    const pages = [...new Set(layers.map((l) => l.page))].sort((a, b) => a - b);
    const order = this.id === 'gruta' ? RENDER_ORDER.hidden : RENDER_ORDER.bed;
    const heroPage = layers[perLayer.findIndex((f) => f.length > 0)]?.page ?? pages[Math.floor(pages.length / 2)] ?? 0;
    for (const page of pages) {
      const color = tex.color[page];
      const normal = tex.normal[page];
      if (color === undefined || normal === undefined) throw new Error(`bed ${this.id}: atlas has no page ${page}`);
      let quads = 0;
      layers.forEach((l, i) => {
        if (l.page === page) quads += l.items.length + (perLayer[i] ?? []).reduce((n, f) => n + f.quads, 0);
      });
      const batch = env.kit.createCutoutBatch(env.gfx, color, normal, Math.max(1, quads));
      batch.mesh.renderOrder = order + page * 2;
      batch.mesh.frustumCulled = false;
      this.batches.push(batch);
      let at = 0;
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (layer === undefined || layer.page !== page) continue;
        at = await this.writeLayer(batch, layer, at, m, alive);
        if (at < 0) return false;
        for (const flower of perLayer[i] ?? []) {
          this.flowers.push({ flower, batch, at });
          at += flower.write(batch.writer, at);
        }
      }
      batch.writer.count = at;
      batch.writer.commit(0, at);
      if (page === heroPage && this.module !== null) {
        this.actors = env.kit.createCutoutBatch(env.gfx, color, normal, ACTOR_CAPACITY);
        this.actors.mesh.renderOrder = order + page * 2 + 1;
        this.actors.mesh.frustumCulled = false;
      }
    }
    this.drawCalls = this.batches.length + (this.actors === null ? 0 : 1);
    if (this.module !== null && this.actors !== null) {
      const ctx: StreamBedCtx = { scene: this.scene, actors: this.actors.writer, machine: env.machine, light: env.light,
        rig: env.rig, quality: env.quality, content: env.content, moth: env.kit.moth(), onDom: env.kit.onDom, createMover: env.kit.createMover };
      this.behaviour = this.module.default(ctx);
    }
    return true;
  }

  /** Writes one layer's placements, yielding to the next frame whenever the slice is spent. Returns -1 when stale. */
  private async writeLayer(batch: CutoutBatch, layer: Layer, from: number, m: AtlasManifest, alive: () => boolean): Promise<number> {
    let at = from;
    for (let k = 0; k < layer.items.length; k++) {
      if (this.slicer.spent()) {
        await this.slicer.frame();
        if (!alive()) return -1;
      }
      const p = layer.items[k];
      if (p === undefined) continue;
      const rect = m.sprites[p.sprite];
      if (rect === undefined) throw new Error(`bed ${this.id}: sprite ${p.sprite} is missing from atlas/${this.id}.json`);
      const t = p.tint ?? NO_TINT;
      scratch.x = this.anchorX + p.x;
      scratch.y = p.y;
      scratch.z = layer.z + (p.dz ?? 0);
      scratch.rot = (p.rot ?? 0) * DEG;
      scratch.w = rect.size[0] * p.scale * (p.flip === true ? -1 : 1);
      scratch.h = rect.size[1] * p.scale;
      scratch.px = rect.pivot[0];
      scratch.py = rect.pivot[1];
      scratch.uv = rect.uv;
      scratch.sway = p.sway ?? 0;
      scratch.phase = ((at * 0.618034) % 1) * Math.PI * 2;
      scratch.lift = p.lift ?? 0;
      scratch.facing = 0;
      tint[0] = t[0]; tint[1] = t[1]; tint[2] = t[2]; tint[3] = 1;
      batch.writer.set(at, scratch);
      at++;
    }
    return at;
  }

  enter(): void {
    if (this.state !== 'ready') return;
    this.state = 'active';
  }

  leave(): void {
    if (this.state === 'active') this.state = 'ready';
  }

  setLang(lang: Lang): void {
    relabel(this.slots, this.scene, this.env.content.profile, lang);
  }

  focus(slot: string | null): void {
    for (let i = 0; i < this.flowers.length; i++) {
      const f = this.flowers[i];
      if (f !== undefined) f.flower.setFocused(f.flower.slot.id === slot);
    }
  }

  get behaviourHooks(): BedBehaviour | null {
    return this.state === 'active' ? this.behaviour : null;
  }

  update(c: Clock, _s: State, _ch: Machine['ch']): void {
    this.reveal.tick(c.dt);
    this.setUniformReveal(this.reveal.value);
    if (this.state !== 'active') return;
    for (let i = 0; i < this.flowers.length; i++) {
      const f = this.flowers[i];
      if (f === undefined) continue;
      f.flower.update(c);
      if (f.flower.dirty) f.batch.writer.commit(f.at, f.at + f.flower.write(f.batch.writer, f.at));
    }
    this.behaviour?.update?.(c);
  }

  private setUniformReveal(v: number): void {
    for (let i = 0; i < this.batches.length; i++) {
      const b = this.batches[i];
      if (b !== undefined) b.uniforms.uReveal.value = v;
    }
    if (this.actors !== null) this.actors.uniforms.uReveal.value = v;
  }

  /** Frees every GPU object and the prefetched bytes; gpuBytes returns to 0. */
  dispose(): void {
    this.gen = -1;
    this.pageBytes = null;
    this.abort?.abort();
    this.abort = null;
    this.behaviour?.dispose?.();
    this.behaviour = null;
    for (const b of this.batches) {
      this.env.gfx.scene.remove(b.mesh);
      b.dispose();
    }
    if (this.actors !== null) {
      this.env.gfx.scene.remove(this.actors.mesh);
      this.actors.dispose();
    }
    this.batches = [];
    this.actors = null;
    this.flowers = [];
    if (this.tex !== null) for (const t of [...this.tex.color, ...this.tex.normal]) t.dispose();
    this.tex = null;
    this.gpuBytes = 0;
    this.drawCalls = 0;
    this.reveal.snap(0);
    this.state = this.state === 'cold' ? 'cold' : 'disposed';
    this.prefetching = null;
  }
}
