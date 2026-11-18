import type { AtlasManifest, AtlasTextures, BloomDef, CutoutBatch, QuadParams, SlotView, SpriteId, SpriteRect, Tier } from '../types.ts';
import { createFlower, type GardenFlower } from './flower.ts';
import { DEG, type BedScene3, type Placement3, type ValueGroup } from './layout.ts';
import { QUAD_FLAG, packPhase, turnFlag } from './quadflags.ts';
import { builtIn, type WorldMode } from './mode.ts';
import { keptLayers } from './scene.ts';
import { placedSize, resolveSprite, type AtlasKey } from './sprites.ts';

/**
 * Turns a bed's 3D placements into instanced cutout batches: one batch per atlas page used (bed pages and the shared
 * pages), quads sorted far to near inside a batch and batches ordered by depth, since paint order is depth order while
 * the renderer has no depth buffer. Hinge is the yaw; lean, ground-lying, decal and standee flags ride in the phase
 * (quadflags.ts).
 * Value groups D and M are mixed toward the place shadow colour by tint (cook/ART.md laws).
 */

export interface BuildAtlas { manifest: AtlasManifest; tex: AtlasTextures }
export interface BuildInput {
  scene: BedScene3;
  tier: Tier;
  maxLayers: number;
  /** The camera the bed is built for: items marked `only` for the other one are left out. */
  mode: WorldMode;
  /** The back wall's z: cutouts on its band never turn as standees. */
  wallZ: number;
  bed: BuildAtlas;
  shared: BuildAtlas | null;
  slots: readonly SlotView[];
  /** Project id to visited, from the garden memory. */
  visited(id: string): boolean;
  reduced: { readonly state: { readonly reduced: boolean } };
  createBatch(from: AtlasKey, page: number, capacity: number): CutoutBatch;
}

export interface FlowerRef { flower: GardenFlower; batch: CutoutBatch; at: number }
export interface WingRef { batch: CutoutBatch; at: number; quad: QuadParams; alpha: number }
export interface BuildOutput { batches: CutoutBatch[]; flowers: FlowerRef[]; wings: WingRef[]; skipped: number }

/** Share of the place shadow colour mixed into each value group. */
const GROUP_MIX: Record<ValueGroup, number> = { L: 0, M: 0.45, D: 0.7 };
/** Wings are near masks (ART.md 2.2): a dark cool silhouette, uncapped (QUAD_FLAG.silhouette), never a lit plate. */
const WING_TINT: readonly number[] = [0.13, 0.11, 0.2, 1];
/**
 * The sign board only anchors its DOM sign (garden/place.ts signAnchorsOf); it is not drawn, since its plate is a frame
 * with an empty black centre that read as a hole in the garden.
 */
const SIGN_BOARD: SpriteId = 'sh/board';
const FOOT_SPRAYS = 3;
const FOOT_SPREAD = 0.18;

type Entry = { z: number; write: (b: CutoutBatch, at: number) => number; wing?: QuadParams; flower?: GardenFlower };
interface Group { from: AtlasKey; page: number; entries: Entry[]; quads: number; zSum: number }

export function hexRgb(hex: string, out: Float32Array): Float32Array {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  out[0] = ((n >> 16) & 255) / 255;
  out[1] = ((n >> 8) & 255) / 255;
  out[2] = (n & 255) / 255;
  return out;
}

/** Flags of a placement; `turn` is QUAD_FLAG.turn or 0 (turnFlag). */
function flagsOf(it: Placement3, turn: number): number {
  return (it.flat === true ? QUAD_FLAG.flat : 0) | (it.lean === 0 ? QUAD_FLAG.noLean : 0)
    | (!it.shadow || it.wing === true ? QUAD_FLAG.noShadow : 0) | (it.wing === true ? QUAD_FLAG.silhouette : 0) | turn;
}

/** The standee rule for a bed placement: upright, leaning and not a near mask. */
const turnOf = (it: Placement3, wallZ: number): number => turnFlag(it.z, wallZ, it.flat !== true && it.lean !== 0 && it.wing !== true);

function quadOf(it: Placement3, rect: SpriteRect, size: [number, number], shade: Float32Array, turn: number, x = it.x, y = it.y, z = it.z, k = 1): QuadParams {
  const m = GROUP_MIX[it.group];
  const t = it.tint ?? [1, 1, 1];
  const flags = flagsOf(it, turn);
  return {
    x, y, z,
    rot: (it.rot ?? 0) * DEG,
    w: size[0] * k * (it.flip === true ? -1 : 1),
    h: size[1] * k,
    px: rect.pivot[0],
    py: rect.pivot[1],
    uv: rect.uv,
    sway: it.sway ?? 0,
    phase: packPhase(((x * 1.618034 + z) % 1) * Math.PI * 2, flags),
    lift: 0,
    facing: -it.hinge * DEG,
    tint: it.wing === true ? [...WING_TINT] : [t[0] * (1 - m * (1 - (shade[0] ?? 1))), t[1] * (1 - m * (1 - (shade[1] ?? 1))), t[2] * (1 - m * (1 - (shade[2] ?? 1))), 1],
  };
}

const once = (q: QuadParams) => (b: CutoutBatch, at: number): number => {
  b.writer.set(at, q);
  return 1;
};

export function buildBed(i: BuildInput): BuildOutput {
  const { scene, bed, shared } = i;
  const shade = hexRgb(scene.shade, new Float32Array(3));
  const groups = new Map<string, Group>();
  const size: [number, number] = [0, 0];
  let skipped = 0;

  const groupOf = (from: AtlasKey, page: number): Group => {
    const key = `${from}:${page}`;
    let g = groups.get(key);
    if (g === undefined) {
      g = { from, page, entries: [], quads: 0, zSum: 0 };
      groups.set(key, g);
    }
    return g;
  };
  const add = (from: AtlasKey, page: number, e: Entry, quads: number): void => {
    const g = groupOf(from, page);
    g.entries.push(e);
    g.quads += quads;
    g.zSum += e.z;
  };
  const exact = (id: SpriteId): { from: AtlasKey; rect: SpriteRect } | null => {
    const s = shared?.manifest.sprites[id];
    if (s !== undefined) return { from: 'shared', rect: s };
    const b = bed.manifest.sprites[id];
    return b === undefined ? null : { from: 'bed', rect: b };
  };

  for (const layer of keptLayers(scene, i.tier, i.maxLayers)) {
    for (const it of layer.items) {
      if (it.sprite === SIGN_BOARD || !builtIn(it, i.mode)) continue;
      const r = resolveSprite(it.sprite, bed.manifest, shared?.manifest ?? null);
      if (r === null) { skipped++; continue; }
      placedSize(r.rect, it.h, it.w, it.scale, size);
      const turn = turnOf(it, i.wallZ);
      const q = quadOf(it, r.rect, size, shade, turn);
      add(r.from, r.rect.page, it.wing === true ? { z: it.z, write: once(q), wing: q } : { z: it.z, write: once(q) }, 1);
      if (it.foot !== 'sprays') continue;
      for (let f = 1; f <= FOOT_SPRAYS; f++) {
        const foot = exact(`${it.sprite}.foot${f}`) ?? (f === 2 ? exact(`${it.sprite}-foot`) : null);
        if (foot === null) continue;
        placedSize(foot.rect, undefined, undefined, 1, size);
        const dx = (f - 2) * FOOT_SPREAD * size[1];
        add(foot.from, foot.rect.page, { z: it.z + 0.01 * f, write: once(quadOf(it, foot.rect, size, shade, turn, it.x + dx, 0, it.z + 0.01 * f, 1)) }, 1);
      }
    }
  }

  for (const view of i.slots) {
    const slot = scene.slots.find((s) => `${scene.id}/${s.id}` === view.id);
    if (view.kind !== 'project' || slot === undefined) continue;
    const bloom: BloomDef | undefined = bed.manifest.blooms[slot.bloom ?? ''] ?? bed.manifest.blooms[slot.accepts ?? ''];
    const frame0 = bloom?.frames?.[0] ?? bloom?.petals?.[0]?.sprite;
    const rect = frame0 === undefined ? undefined : bed.manifest.sprites[frame0];
    if (bloom === undefined || rect === undefined) { skipped++; continue; }
    const turn = turnFlag(view.world[2], i.wallZ, true);
    const flower = createFlower({ slot: view, bloom, sprites: bed.manifest.sprites, scale: slot.scale, env: i.reduced, hinge: slot.hinge * DEG, turn });
    flower.setVisited(view.project !== undefined && i.visited(view.project.id));
    add('bed', rect.page, { z: view.world[2], write: (b, at) => flower.write(b.writer, at), flower }, flower.quads);
  }

  const ordered = [...groups.values()].sort((a, b) => a.zSum / a.entries.length - b.zSum / b.entries.length);
  const out: BuildOutput = { batches: [], flowers: [], wings: [], skipped };
  for (const g of ordered) {
    const batch = i.createBatch(g.from, g.page, Math.max(1, g.quads));
    g.entries.sort((a, b) => a.z - b.z);
    let at = 0;
    for (const e of g.entries) {
      if (e.flower !== undefined) out.flowers.push({ flower: e.flower, batch, at });
      if (e.wing !== undefined) out.wings.push({ batch, at, quad: e.wing, alpha: 1 });
      at += e.write(batch, at);
    }
    batch.writer.count = at;
    batch.writer.commit(0, at);
    out.batches.push(batch);
  }
  return out;
}
