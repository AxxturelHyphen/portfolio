import type { AtlasManifest, AtlasTextures, BedBehaviour, BedId, Clock, CutoutBatch, GardenDeps, GardenHandle, Phase, QuadParams, SpriteRect, State } from '../types.ts';
import puerta from '../../content/beds/puerta.json' with { type: 'json' };
import rosaleda from '../../content/beds/rosaleda.json' with { type: 'json' };
import estanque from '../../content/beds/estanque.json' with { type: 'json' };
import semillero from '../../content/beds/semillero.json' with { type: 'json' };
import gruta from '../../content/beds/gruta.json' with { type: 'json' };
import salida from '../../content/beds/salida.json' with { type: 'json' };
import { RENDER_ORDER, StreamBed, fetchManifest, uploadPages, type BedEnv, type StreamKit } from './bed.ts';
import { createResidency, type StreamResidency } from './residency.ts';
import type { BuildAtlas } from './bed.build.ts';
import type { GardenRig } from './camera.ts';
import { buildGround, type GroundBuild } from './ground.ts';
import { worldMode } from './mode.ts';
import { writeClumps } from './clumps.ts';
import { writeDressing } from './dressing.ts';
import { QUAD_FLAG, packPhase } from './quadflags.ts';
import { writeWall } from './wall.ts';
import { writeCrowns, writeHedge } from './crowns.ts';
import { ITEM_DEFAULTS, type BedScene3, type WorldLayout } from './layout.ts';
import { createMemory, type GardenMemory } from './memory.ts';

/**
 * The garden (cook/ARCH.md 2.6): six beds along X, the residency that streams them, and the always-resident overview
 * atlas that stands in for every bed that is not revealed. Scenes are bundled (a few KB, validated at build); their
 * textures stream. The bed under the camera is entered once it is ready; its slots go to the proxy layer.
 */

/** A bundled scene with the item values the build dropped (scripts/beds.slim.ts) filled back. */
const filled = (s: unknown): BedScene3 => {
  const scene = s as BedScene3;
  return { ...scene, layers: scene.layers.map((l) => ({ ...l, items: l.items.map((it) => ({ ...ITEM_DEFAULTS, ...it })) })) };
};

/** Every scene file, keyed by bed. Adding a project is JSON only: projects bind to the slots of their bed. */
export const SCENES: Readonly<Record<BedId, BedScene3>> = {
  puerta: filled(puerta), rosaleda: filled(rosaleda), estanque: filled(estanque), semillero: filled(semillero), gruta: filled(gruta), salida: filled(salida),
};

/** Depth of the overview stand-in cards: the beds' middle band. */
const OVERVIEW_Z = -2;
/**
 * A bed not yet loaded stands as its flattened overview card (64 px per metre) pushed into cool shade, garden further
 * along the wall, until its real cutouts fade in over it. The tint is uncapped (QUAD_FLAG.silhouette).
 */
const SILHOUETTE = [0.4, 0.4, 0.58] as const;
const SETTLED: readonly Phase[] = ['bed', 'focus', 'opening', 'inspect', 'closing'];

export interface StreamGarden extends GardenHandle {
  readonly residency: StreamResidency;
  readonly beds: ReadonlyMap<BedId, StreamBed>;
  /** Resolves once the overview atlas is uploaded and drawn once (hidden), so the overview can show. */
  readonly ready: Promise<void>;
  /** Pointer or focus over a bed in the overview: prefetch its bytes. */
  hover(bed: BedId | null): void;
  /** The ground kit as flat instance arrays (path flags, puddles, wall, clumps) for gl's ground batches. */
  readonly ground: GroundBuild;
  /** Visited flowers, kept across visits. */
  readonly memory: GardenMemory;
  /** The shared atlas (lanterns, pots, boards) once it is uploaded, else null. */
  sharedAtlas(): BuildAtlas | null;
}

interface OverviewCard { bed: StreamBed; batch: CutoutBatch; index: number; rect: SpriteRect; alpha: number }

const quad: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0, py: 0, uv: [0, 0, 0, 0], sway: 0, phase: 0, lift: 0, facing: 0, tint: [1, 1, 1, 1] };
const tint = new Float32Array(4);
quad.tint = tint;
quad.phase = packPhase(0, QUAD_FLAG.silhouette | QUAD_FLAG.noShadow);

/**
 * Free roam: the closed garden's crowns and hedge stand behind its solid walls (garden/place.ts, painted at
 * RENDER_ORDER.overview - 2) in place of the rail's wall.
 */
const CLOSED_ORDER = { crowns: RENDER_ORDER.overview - 5, hedge: RENDER_ORDER.overview - 4 } as const;

/** Free roam hands the garden the bed ahead of the walking visitor (cook/ROAM_PLAN.md section 3, Streaming). */
export interface RoamStreaming { heading(): BedId | null; here(): BedId | null; readonly pos: Float32Array }

export function createGarden(d: GardenDeps & { kit: StreamKit; rig: GardenRig; roam?: RoamStreaming }): StreamGarden {
  const { gfx, machine, content, proxies } = d;
  const roam = d.roam ?? null;
  const layout = content.garden as WorldLayout;
  const memory = createMemory();
  let shared: BuildAtlas | null = null;
  const env: BedEnv = { gfx, machine, rig: d.rig, light: d.light, quality: d.quality, content, kit: d.kit, shared: () => shared, memory, visitor: roam?.pos ?? null };
  const ground = buildGround(layout.ground, layout.order.map((b) => SCENES[b]), d.quality.tier);
  const beds = new Map<BedId, StreamBed>();
  const list: StreamBed[] = [];
  const slicer = { frame: () => residency.frame(), upload: () => residency.upload(), spent: () => residency.spent() };
  for (const id of layout.order) {
    const bed = new StreamBed(id, SCENES[id], layout.anchors[id], env, slicer);
    beds.set(id, bed);
    list.push(bed);
  }
  const residency = createResidency(beds, layout, machine, d.quality, gfx);
  const cards: OverviewCard[] = [];
  let origin: BedId | null = null;
  let active: BedId | null = null;
  let heading: BedId | null = null;
  /**
   * Free roam: the bed the visitor stands in while the garden is walked (not over the overview), kept while they walk
   * out of it, so its cutouts never give way mid-view.
   */
  let here: BedId | null = null;
  let hovered: BedId | null = null;
  let entered: StreamBed | null = null;

  const mountBeds = (): void => {
    const lang = machine.state.lang;
    proxies.mountBeds(layout.order.filter((b) => b !== 'gruta').map((b) => ({ id: b, title: SCENES[b].title[lang] })));
  };

  /**
   * Where the camera is (active) and where it is going (heading); the bed being left stays wanted until arrival. In free
   * roam the active bed is the machine's bed and the heading is the bed ahead of the walking visitor.
   */
  const place = (s: State): void => {
    if (roam !== null) {
      active = s.phase === 'travel' || SETTLED.includes(s.phase) ? s.bed : null;
      heading = roam.heading();
      here = active === null ? null : roam.here();
    } else if (s.phase === 'travel') {
      heading = s.intent.k === 'overview' ? null : s.bed;
      active = origin;
    } else if (SETTLED.includes(s.phase)) {
      active = s.bed;
      origin = s.bed;
      heading = null;
    } else {
      active = null;
      origin = null;
      heading = null;
    }
  };

  /**
   * The beds to keep. Free roam keeps the visitor's own bed and, on an assisted walk, its goal (else the bed ahead): the
   * bed being left stays drawn as its own cutouts until it is out of view, never as its overview card.
   */
  const want = (): void => {
    if (roam === null) residency.want(active, heading, hovered);
    else residency.want(here ?? active, machine.state.phase === 'travel' ? active : heading ?? active, hovered);
  };

  /** Enters the bed the camera has settled on as soon as it is ready; leaves it the moment the camera moves on. */
  const syncEntered = (): void => {
    const s = machine.state;
    const target = SETTLED.includes(s.phase) ? s.bed : null;
    if (entered !== null && entered.id !== target) {
      entered.leave();
      proxies.unmountSlots();
      entered = null;
    }
    if (entered !== null || target === null) return;
    const bed = beds.get(target);
    if (bed?.state !== 'ready') return;
    bed.enter();
    bed.focus(s.slot);
    proxies.mountSlots(target, bed.slots);
    entered = bed;
  };

  const slotEvents = (s: State, prev: State, hooks: BedBehaviour | null): void => {
    if (hooks === null) return;
    hooks.onState?.(s, prev);
    if (hooks.onSlot === undefined) return;
    if (prev.slot !== null && prev.slot !== s.slot) hooks.onSlot(prev.slot, 'blur');
    if (s.slot !== null && prev.slot !== s.slot) hooks.onSlot(s.slot, 'focus');
    if (s.slot !== null && s.phase === 'opening' && prev.phase !== 'opening') hooks.onSlot(s.slot, 'open');
    if (s.slot !== null && prev.phase === 'closing' && s.phase !== 'closing' && s.phase !== 'opening') hooks.onSlot(s.slot, 'close');
  };

  machine.subscribe((s, prev) => {
    if (s.phase === 'inspect' && prev.phase !== 'inspect' && s.project !== null && memory.visit(s.project)) {
      for (const bed of list) bed.remember(s.project);
    }
    const wasActive = active;
    const wasHeading = heading;
    const wasHere = here;
    place(s);
    const travelled = roam !== null && (s.phase === 'travel') !== (prev.phase === 'travel');
    if (active !== wasActive || heading !== wasHeading || here !== wasHere || travelled) want();
    if (s.lang !== prev.lang) {
      for (const bed of list) bed.setLang(s.lang);
      mountBeds();
      if (entered !== null) proxies.mountSlots(entered.id, entered.slots);
    }
    syncEntered();
    if (entered !== null && s.slot !== prev.slot) entered.focus(s.slot);
    slotEvents(s, prev, entered?.behaviourHooks ?? null);
  });

  const ready = loadOverview().then(loadShared);

  /** The shared atlas (ground kit, lanterns, boards, vignettes): always resident; the grass clumps draw from it. */
  async function loadShared(): Promise<void> {
    const signal = new AbortController().signal;
    const manifest = await fetchManifest('shared', signal);
    const tex = await d.kit.loadAtlas(gfx, manifest, d.quality.cfg.atlas, signal);
    await uploadPages(env, tex, slicer, () => true);
    residency.addShared(tex.gpuBytes);
    shared = { manifest, tex };
    const batchOn = (page: number, capacity: number): CutoutBatch => {
      const color = tex.color[page];
      const normal = tex.normal[page];
      if (color === undefined || normal === undefined) throw new Error(`shared atlas: no page ${page}`);
      return d.kit.createCutoutBatch(gfx, color, normal, capacity);
    };
    if (worldMode() === 'roam') addClosed(manifest, batchOn);
    else addBatch(writeWall(ground, layout.ground.wall.z, manifest, batchOn), RENDER_ORDER.overview - 1);
    const clumps = writeClumps(ground, manifest, batchOn);
    if (clumps !== null) {
      clumps.mesh.renderOrder = RENDER_ORDER.bed - 1;
      gfx.scene.add(clumps.mesh);
    }
    const dressing = writeDressing(ground, manifest, batchOn);
    if (dressing !== null) {
      dressing.mesh.renderOrder = RENDER_ORDER.near;
      gfx.scene.add(dressing.mesh);
    }
    await residency.frame();
  }

  function addBatch(batch: CutoutBatch | null, order: number): void {
    if (batch === null) return;
    batch.mesh.renderOrder = order;
    gfx.scene.add(batch.mesh);
  }

  function addClosed(manifest: AtlasManifest, batchOn: (page: number, capacity: number) => CutoutBatch): void {
    const g = layout.ground;
    addBatch(writeCrowns(g.enclosure, manifest, batchOn), CLOSED_ORDER.crowns);
    addBatch(writeHedge(g.enclosure, manifest, batchOn), CLOSED_ORDER.hedge);
  }

  async function loadOverview(): Promise<void> {
    const signal = new AbortController().signal;
    const manifest: AtlasManifest = await fetchManifest('overview', signal);
    const tex: AtlasTextures = await d.kit.loadAtlas(gfx, manifest, d.quality.cfg.atlas, signal);
    await uploadPages(env, tex, slicer, () => true);
    residency.addShared(tex.gpuBytes);
    const pages = new Map<number, CutoutBatch>();
    for (const bed of list) {
      const rect = manifest.sprites[bed.id];
      if (bed.id === 'gruta' || rect === undefined) continue;
      let batch = pages.get(rect.page);
      if (batch === undefined) {
        const color = tex.color[rect.page];
        const normal = tex.normal[rect.page];
        if (color === undefined || normal === undefined) throw new Error(`overview atlas: no page ${rect.page}`);
        batch = d.kit.createCutoutBatch(gfx, color, normal, list.length);
        batch.mesh.renderOrder = RENDER_ORDER.overview;
        batch.uniforms.uReveal.value = 1;
        pages.set(rect.page, batch);
        gfx.scene.add(batch.mesh);
      }
      const card: OverviewCard = { bed, batch, index: batch.writer.count++, rect, alpha: -1 };
      cards.push(card);
      writeCard(card, 1);
    }
    await residency.frame();
  }

  function writeCard(card: OverviewCard, alpha: number): void {
    const { rect, bed } = card;
    card.alpha = alpha;
    /** The card is the flattened bed between its bounds: its left edge sits on bounds[0] (the manifest pivot may not). */
    quad.x = bed.scene.bounds[0];
    quad.y = 0;
    quad.z = OVERVIEW_Z;
    quad.w = rect.size[0];
    quad.h = rect.size[1];
    quad.px = 0;
    quad.py = rect.pivot[1];
    quad.uv = rect.uv;
    tint[0] = SILHOUETTE[0]; tint[1] = SILHOUETTE[1]; tint[2] = SILHOUETTE[2]; tint[3] = alpha;
    card.batch.writer.set(card.index, quad);
    card.batch.writer.commit(card.index, card.index + 1);
  }

  mountBeds();
  place(machine.state);
  want();

  return {
    residency,
    beds,
    ready,
    ground,
    memory,
    sharedAtlas: () => shared,
    hover(bed) {
      if (bed === hovered) return;
      hovered = bed;
      want();
    },
    update(c: Clock) {
      if (roam !== null && (roam.heading() !== heading || (active !== null && roam.here() !== here))) {
        place(machine.state);
        want();
      }
      residency.tick(c);
      if (entered === null) syncEntered();
      const s = machine.state;
      for (let i = 0; i < list.length; i++) {
        const bed = list[i];
        if (bed === undefined) continue;
        const shown = (bed.state === 'ready' || bed.state === 'active') && (bed.id !== 'gruta' || heading === 'gruta' || active === 'gruta');
        const v = shown ? 1 : 0;
        if (bed.reveal.target !== v) bed.reveal.to(v);
        /** Frozen time (stills) has no dt: the reveal lands at once, so no overview card lingers over a loaded bed. */
        if (c.frozen && bed.reveal.value !== v) bed.reveal.snap(v);
        if (bed.state === 'ready' || bed.state === 'active') bed.update(c, s, machine.ch);
      }
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        if (card === undefined) continue;
        const alpha = 1 - card.bed.reveal.value;
        if (Math.abs(alpha - card.alpha) > 0.002 || (alpha === 0) !== (card.alpha === 0)) writeCard(card, alpha);
      }
    },
  };
}
