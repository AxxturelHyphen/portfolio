import type { AtlasManifest, AtlasTextures, BloomDef, CutoutBatch, QuadParams, SlotView, SpriteId, SpriteRect, Tier } from '../types.ts';
import { createFlower, type GardenFlower } from './flower.ts';
import { gateLeafOf, isGateLeaf, type GateLeaf } from './gates.ts';
import { DEG, type BedScene3, type Placement3, type ValueGroup } from './layout.ts';
import { QUAD_FLAG, packPhase, turnFlag } from './quadflags.ts';
import { builtIn, type WorldMode } from './mode.ts';
import type { PetRef } from './pet.ts';
import { keptLayers } from './scene.ts';
import { placedSize, resolveSprite, type AtlasKey } from './sprites.ts';

/**
 * Turns a bed's 3D placements into instanced cutout batches: one batch per atlas page used (bed pages and the shared
 * pages), quads sorted far to near inside a batch and batches ordered by depth, since paint order is depth order while
 * the renderer has no depth buffer. Hinge is the yaw; lean, ground-lying, decal and standee flags ride in the phase
 * (quadflags.ts).
 * Value groups D and M are mixed toward the place shadow colour by tint (cook/ART.md laws); under free roam far less,
 * since from 7 to 14 m the rail's mix turned every plant but the project flowers into a violet ghost (cook/ROAM_LOOK.md).
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
  /** Free roam: the visitor's [x, z] that project flowers open toward, else null. */
  visitor?: Float32Array | null;
  /** `front`: a batch of free roam's foreground frames, painted over the ground dressing (RENDER_ORDER.front). */
  createBatch(from: AtlasKey, page: number, capacity: number, front: boolean): CutoutBatch;
}

export interface FlowerRef { flower: GardenFlower; batch: CutoutBatch; at: number }
export interface WingRef { batch: CutoutBatch; at: number; quad: QuadParams; alpha: number }
export interface BuildOutput { batches: CutoutBatch[]; flowers: FlowerRef[]; wings: WingRef[]; pets: PetRef[]; gates: GateLeaf[]; skipped: number }

/** Share of the place shadow colour mixed into each value group, per camera. */
const GROUP_MIX: Record<WorldMode, Record<ValueGroup, number>> = { rail: { L: 0, M: 0.45, D: 0.7 }, roam: { L: 0, M: 0.2, D: 0.3 } };
/** Wings are near masks (ART.md 2.2): a dark cool silhouette, uncapped (QUAD_FLAG.silhouette), never a lit plate. */
const WING_TINT: readonly number[] = [0.13, 0.11, 0.2, 1];
/**
 * The sign board only places the signs (garden/place.ts signPostsOf: the rail's DOM label, free roam's painted
 * signpost); it is not drawn, since its plate is a frame with an empty black centre that read as a hole in the garden.
 */
const SIGN_BOARD: SpriteId = 'sh/board';
/**
 * Under free roam, cards standing south of this z (between the path and the lens: the foreground frames) are batched
 * apart and painted after the ground dressing, since paint order is depth order and the lawn lies behind them. The low
 * tier keeps them in their page's batch: one draw call per bed matters more there than that overlap.
 */
const FRONT_Z = 2;
const FOOT_SPRAYS = 3;
const FOOT_SPREAD = 0.18;

type Entry = { z: number; write: (b: CutoutBatch, at: number) => number; wing?: QuadParams; flower?: GardenFlower; pet?: { slot: string; quad: QuadParams }; gate?: { sprite: SpriteId; quad: QuadParams } };
interface Group { from: AtlasKey; page: number; front: boolean; entries: Entry[]; quads: number; zSum: number }

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
    | (!it.shadow || it.wing === true ? QUAD_FLAG.noShadow : 0) | (it.wing === true ? QUAD_FLAG.silhouette : 0) | (it.fade === true ? QUAD_FLAG.fade : 0) | turn;
}

/** The standee rule for a bed placement: upright, leaning and not a near mask. */
const turnOf = (it: Placement3, wallZ: number): number => turnFlag(it.z, wallZ, it.flat !== true && it.lean !== 0 && it.wing !== true);

function quadOf(it: Placement3, rect: SpriteRect, size: [number, number], shade: Float32Array, mix: Record<ValueGroup, number>, turn: number,
  x = it.x, y = it.y, z = it.z, k = 1): QuadParams {
  const m = mix[it.group];
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
  const mix = GROUP_MIX[i.mode];
  const groups = new Map<string, Group>();
  const size: [number, number] = [0, 0];
  let skipped = 0;

  const groupOf = (from: AtlasKey, page: number, front: boolean): Group => {
    const key = `${from}:${page}${front ? ':front' : ''}`;
    let g = groups.get(key);
    if (g === undefined) {
      g = { from, page, front, entries: [], quads: 0, zSum: 0 };
      groups.set(key, g);
    }
    return g;
  };
  const add = (from: AtlasKey, page: number, e: Entry, quads: number): void => {
    const g = groupOf(from, page, i.mode === 'roam' && i.tier !== 'low' && e.z > FRONT_Z);
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

  /** Pet slots bound for this camera, by the sprite of the item that wakes (its first placement). */
  const pets = new Map<SpriteId, string>();
  for (const slot of scene.slots) {
    const id = `${scene.id}/${slot.id}`;
    if (slot.kind === 'pet' && slot.ref !== undefined && i.slots.some((v) => v.id === id)) pets.set(slot.ref, id);
  }

  for (const layer of keptLayers(scene, i.tier, i.maxLayers)) {
    for (const it of layer.items) {
      if (it.sprite === SIGN_BOARD || !builtIn(it, i.mode)) continue;
      const r = resolveSprite(it.sprite, bed.manifest, shared?.manifest ?? null);
      if (r === null) { skipped++; continue; }
      placedSize(r.rect, it.h, it.w, it.scale, size);
      const turn = turnOf(it, i.wallZ);
      const q = quadOf(it, r.rect, size, shade, mix, turn);
      const pet = pets.get(it.sprite);
      const entry: Entry = { z: it.z, write: once(q) };
      if (it.wing === true) entry.wing = q;
      if (isGateLeaf(it.sprite)) entry.gate = { sprite: it.sprite, quad: q };
      if (pet !== undefined) {
        entry.pet = { slot: pet, quad: q };
        pets.delete(it.sprite);
      }
      add(r.from, r.rect.page, entry, 1);
      if (it.foot !== 'sprays') continue;
      for (let f = 1; f <= FOOT_SPRAYS; f++) {
        const foot = exact(`${it.sprite}.foot${f}`) ?? (f === 2 ? exact(`${it.sprite}-foot`) : null);
        if (foot === null) continue;
        placedSize(foot.rect, undefined, undefined, 1, size);
        const dx = (f - 2) * FOOT_SPREAD * size[1];
        add(foot.from, foot.rect.page, { z: it.z + 0.01 * f, write: once(quadOf(it, foot.rect, size, shade, mix, turn, it.x + dx, 0, it.z + 0.01 * f, 1)) }, 1);
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
    const flower = createFlower({ slot: view, bloom, sprites: bed.manifest.sprites, scale: slot.scale, env: i.reduced, hinge: slot.hinge * DEG, turn, visitor: i.visitor ?? null });
    flower.setVisited(view.project !== undefined && i.visited(view.project.id));
    add('bed', rect.page, { z: view.world[2], write: (b, at) => flower.write(b.writer, at), flower }, flower.quads);
  }

  const ordered = [...groups.values()].sort((a, b) => a.zSum / a.entries.length - b.zSum / b.entries.length);
  const out: BuildOutput = { batches: [], flowers: [], wings: [], pets: [], gates: [], skipped };
  for (const g of ordered) {
    const batch = i.createBatch(g.from, g.page, Math.max(1, g.quads), g.front);
    g.entries.sort((a, b) => a.z - b.z);
    let at = 0;
    for (const e of g.entries) {
      if (e.flower !== undefined) out.flowers.push({ flower: e.flower, batch, at });
      if (e.wing !== undefined) out.wings.push({ batch, at, quad: e.wing, alpha: 1 });
      if (e.pet !== undefined) out.pets.push({ slot: e.pet.slot, batch, at, quad: e.pet.quad });
      const gate = e.gate === undefined ? null : gateLeafOf(e.gate.sprite, e.gate.quad, batch, at);
      if (gate !== null) out.gates.push(gate);
      at += e.write(batch, at);
    }
    batch.writer.count = at;
    batch.writer.commit(0, at);
    out.batches.push(batch);
  }
  return out;
}
