import type {
  AtlasManifest, AtlasTextures, Bed, BedBehaviour, BedCtx, BedId, BedModule, BedState, Channel, Clock, Content,
  CreateCutoutBatch, CutoutBatch, Gfx, Lang, LightRig, LoadAtlas, Machine, Moth, Project, ProjectBed,
  Quality, SlotView, SpriteId, SpriteRect, State,
} from '../types.ts';
import type { Texture } from 'three';
import { spring } from '../core/spring.ts';
import { STREAM, wingOpacityOf } from '../core/motion.ts';
import { buildBed, type BuildAtlas, type FlowerRef, type WingRef } from './bed.build.ts';
import type { GardenRig } from './camera.ts';
import type { BedScene3 } from './layout.ts';
import type { GardenMemory } from './memory.ts';
import { bindSlots, relabel } from './scene.ts';

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

/**
 * What a bed behaviour gets: the BedCtx of cook/ARCH.md 2.6 plus its DOM stage, since world may not import ui, and the
 * bed's sprite rects (the actor batch samples the page of scene.actorSprite).
 */
export interface StreamBedCtx extends BedCtx {
  onDom: StreamKit['onDom'];
  createMover: StreamKit['createMover'];
  sprites: Readonly<Record<SpriteId, SpriteRect>>;
}

/** Shared world context of every bed: the always-resident shared atlas (null until loaded) and the garden memory. */
export interface BedEnv {
  gfx: Gfx; machine: Machine; rig: GardenRig; light: LightRig; quality: Quality; content: Content; kit: StreamKit;
  shared(): BuildAtlas | null; memory: GardenMemory;
  /** The back wall's z (garden.json ground.wall.z). */
  wallZ: number;
}

/** Load work gate owned by the residency: one grant per frame, a time slice and an upload allowance. */
export interface Slicer { frame(): Promise<void>; upload(): Promise<void>; spent(): boolean }

/** Paint order: the overview atlas under every bed, the grotto under its host so the ivy covers it. */
/** Paint order bases; `near` is the ground dressing in front of every bed (world/dressing.ts). */
export const RENDER_ORDER = { overview: -1, hidden: 0, bed: 100, near: 600 } as const;
const ACTOR_CAPACITY = 64;

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
  private wings: WingRef[] = [];
  /** Placements skipped because the atlas does not hold their sprite id yet (they draw nothing). */
  missing = 0;
  private actors: CutoutBatch | null = null;
  private behaviour: BedBehaviour | null = null;

  constructor(readonly id: BedId, readonly scene: BedScene3, readonly anchorX: number, private readonly env: BedEnv, private readonly slicer: Slicer) {
    const projects = id === 'rosaleda' || id === 'estanque' || id === 'semillero' ? env.kit.projectsOf(id) : [];
    this.slots = bindSlots({ scene, projects, profile: env.content.profile, lang: env.machine.state.lang });
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

  /** Builds every batch in one slice (a bed is a few dozen quads), then the behaviour on the hero page. */
  private async build(m: AtlasManifest, tex: AtlasTextures, alive: () => boolean): Promise<boolean> {
    const env = this.env;
    if (this.slicer.spent()) {
      await this.slicer.frame();
      if (!alive()) return false;
    }
    /** Shared sprites (pots, lanterns, boards, ivy) resolve only against the loaded shared atlas: wait for it. */
    while (env.shared() === null) {
      await this.slicer.frame();
      if (!alive()) return false;
    }
    const shared = env.shared();
    const order = this.id === 'gruta' ? RENDER_ORDER.hidden : RENDER_ORDER.bed;
    const out = buildBed({
      scene: this.scene, tier: env.quality.tier, maxLayers: env.quality.cfg.maxLayers, wallZ: env.wallZ, bed: { manifest: m, tex }, shared,
      slots: this.slots, visited: (id) => env.memory.visited(id), reduced: env.machine,
      createBatch: (from, page, capacity) => {
        const t = from === 'shared' && shared !== null ? shared.tex : tex;
        const color = t.color[page];
        const normal = t.normal[page];
        if (color === undefined || normal === undefined) throw new Error(`bed ${this.id}: ${from} atlas has no page ${page}`);
        const batch = env.kit.createCutoutBatch(env.gfx, color, normal, capacity);
        batch.mesh.renderOrder = order + this.batches.length;
        batch.mesh.frustumCulled = false;
        this.batches.push(batch);
        return batch;
      },
    });
    this.flowers = out.flowers;
    this.wings = out.wings;
    this.missing = out.skipped;
    const hero = this.flowers[0]?.batch ?? this.batches[0];
    const actorPage = m.sprites[this.scene.actorSprite ?? '']?.page;
    const color = actorPage === undefined ? hero?.uniforms.uColor.value : tex.color[actorPage];
    const normal = actorPage === undefined ? hero?.uniforms.uNormal.value : tex.normal[actorPage];
    if (this.module !== null && color !== undefined && normal !== undefined) {
      this.actors = env.kit.createCutoutBatch(env.gfx, color, normal, ACTOR_CAPACITY);
      this.actors.mesh.renderOrder = order + this.batches.length;
      this.actors.mesh.frustumCulled = false;
    }
    this.drawCalls = this.batches.length + (this.actors === null ? 0 : 1);
    if (this.module !== null && this.actors !== null) {
      const ctx: StreamBedCtx = { scene: this.scene, actors: this.actors.writer, machine: env.machine, light: env.light,
        rig: env.rig, quality: env.quality, content: env.content, moth: env.kit.moth(), onDom: env.kit.onDom, createMover: env.kit.createMover,
        sprites: m.sprites };
      this.behaviour = this.module.default(ctx);
    }
    return true;
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
    this.fadeWings(wingOpacityOf(this.env.rig.speed));
    if (this.state !== 'active') return;
    for (let i = 0; i < this.flowers.length; i++) {
      const f = this.flowers[i];
      if (f === undefined) continue;
      f.flower.update(c);
      if (f.flower.dirty) f.batch.writer.commit(f.at, f.at + f.flower.write(f.batch.writer, f.at));
    }
    this.behaviour?.update?.(c);
  }

  /** Visited flowers rest open; called when the memory learns a new one. */
  remember(id: string): void {
    for (let i = 0; i < this.flowers.length; i++) {
      const f = this.flowers[i];
      if (f !== undefined && f.flower.slot.project?.id === id) f.flower.setVisited(true);
    }
  }

  /** Near wings fade out while the camera walks fast (cook/ART.md section 1). */
  private fadeWings(alpha: number): void {
    for (let i = 0; i < this.wings.length; i++) {
      const w = this.wings[i];
      if (w === undefined || w.alpha === alpha || (Math.abs(w.alpha - alpha) < 0.01 && alpha > 0 && alpha < 1)) continue;
      w.alpha = alpha;
      (w.quad.tint as number[])[3] = alpha;
      w.batch.writer.set(w.at, w.quad);
      w.batch.writer.commit(w.at, w.at + 1);
    }
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
    this.wings = [];
    if (this.tex !== null) for (const t of [...this.tex.color, ...this.tex.normal]) t.dispose();
    this.tex = null;
    this.gpuBytes = 0;
    this.drawCalls = 0;
    this.reveal.snap(0);
    this.state = this.state === 'cold' ? 'cold' : 'disposed';
    this.prefetching = null;
  }
}
