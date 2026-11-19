import type { AtlasManifest, CutoutBatch, QuadParams, SpriteRect } from '../types.ts';
import { clumpSprite } from './clumps.ts';
import { DRESS_KIND, DRESS_STRIDE, EDGE_PLANTS, LAWN_PLANTS, type GroundBuild } from './ground.ts';
import { RENDER_ORDER } from './order.ts';
import { QUAD_FLAG, packPhase, turnFlag } from './quadflags.ts';

/**
 * The near-ground dressing (cook/LOOK_NOTES.md 4): grass clumps, a low leafy plant, its leaves lying flat as litter
 * and fallen petals, all from the shared atlas, in one instanced batch painted over the beds (pieces are sorted far
 * to near, the material has no depth). Standing pieces cast their contact shadow; flat ones lie on the ground.
 * On the rail, nearer pieces are mixed toward the night shade so the foreground frames the picture instead of
 * competing with it. Under free roam (the lawn, ground.ts) nothing is a silhouette: every piece stays lit with a
 * slight green, straw or warm cast, standing pieces clear of the wall foot turn as standees, and the wild plants of the
 * second shared page draw in a second batch hung under the first (one more draw call, roam only).
 */

const CLUMP_CARDS = 2;
const DEG = Math.PI / 180;
/** The night colour the nearest pieces are mixed toward (ART.md 2.2 wall in shade). */
const NIGHT = [0.15, 0.12, 0.24] as const;
/** Below this shade a piece reads as foreground framing (a near silhouette). */
const NEAR_SHADE = 0.5;
const PETALS = ['sh/petal-1', 'sh/petal-2', 'sh/petal-3'] as const;
/** Lawn tints, picked by the piece's tone: a green cast, straw, a warm one. Never dark: the scene light does the rest. */
const LAWN_TINT = [[0.9, 1, 0.9], [1, 0.97, 0.84], [1, 0.92, 0.82]] as const;
const LAWN_PICK = [0.5, 0.85] as const;
/** The lawn's wild plants (w/*) share one page of the shared atlas. */
const WILD_PROBE = 'w/poppy';

function lawnTint(pick: number): readonly number[] {
  return LAWN_TINT[pick < LAWN_PICK[0] ? 0 : pick < LAWN_PICK[1] ? 1 : 2] ?? LAWN_TINT[0];
}

function spriteOf(m: AtlasManifest, kind: number, i: number): string | null {
  if (kind >= DRESS_KIND.plant) return LAWN_PLANTS[kind - DRESS_KIND.plant]?.sprite ?? null;
  if (kind >= DRESS_KIND.edge) return EDGE_PLANTS[kind - DRESS_KIND.edge]?.sprite ?? null;
  if (kind < DRESS_KIND.leafy) return clumpSprite(m, kind - DRESS_KIND.clump);
  if (kind === DRESS_KIND.petal) return PETALS[i % PETALS.length] ?? null;
  return 'sh/ivy';
}

export function writeDressing(g: GroundBuild, wallZ: number, m: AtlasManifest, createBatch: (page: number, capacity: number) => CutoutBatch): CutoutBatch | null {
  const probe = m.sprites['sh/ivy'];
  if (g.dressCount === 0 || probe === undefined) return null;
  const batch = createBatch(probe.page, g.dressCount * CLUMP_CARDS);
  fill(g, wallZ, m, probe.page, batch);
  const wild = m.sprites[WILD_PROBE];
  if (g.mode === 'roam' && wild !== undefined && wild.page !== probe.page) {
    const plants = createBatch(wild.page, g.dressCount);
    fill(g, wallZ, m, wild.page, plants);
    plants.mesh.renderOrder = RENDER_ORDER.near;
    batch.mesh.add(plants.mesh);
  }
  return batch;
}

function fill(g: GroundBuild, wallZ: number, m: AtlasManifest, page: number, batch: CutoutBatch): void {
  const tint: [number, number, number, number] = [1, 1, 1, 1];
  const q: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0.5, py: 0, uv: [0, 0, 0, 0], sway: 0, phase: 0, lift: 0, facing: 0, tint };
  const roam = g.mode === 'roam';
  let at = 0;
  for (let i = 0; i < g.dressCount; i++) {
    const o = i * DRESS_STRIDE;
    const kind = g.dress[o + 2] ?? 0;
    const id = spriteOf(m, kind, i);
    const rect: SpriteRect | undefined = id === null ? undefined : m.sprites[id];
    if (rect === undefined || rect.page !== page) continue;
    const shade = g.dress[o + 5] ?? 1;
    const lawn = roam ? lawnTint(shade) : null;
    for (let c = 0; c < 3; c++) tint[c] = lawn === null ? (NIGHT[c] ?? 0) + (1 - (NIGHT[c] ?? 0)) * shade * shade : (lawn[c] ?? 1);
    const flat = kind === DRESS_KIND.litter || kind === DRESS_KIND.petal;
    const grass = kind < DRESS_KIND.leafy || (id?.startsWith('sh/clump') ?? false);
    const cards = grass ? CLUMP_CARDS : 1;
    const upright = kind >= DRESS_KIND.edge && !grass;
    const h = g.dress[o + 4] ?? 0.3;
    const side = i % 2 === 0 ? 1 : -1;
    /** The nearest pieces are true dark framing: their night tint is applied uncapped. */
    const flags = (flat ? QUAD_FLAG.flat | QUAD_FLAG.noShadow : 0) | (!roam && shade < NEAR_SHADE ? QUAD_FLAG.silhouette : 0)
      | turnFlag(g.dress[o + 1] ?? 0, wallZ, !flat);
    for (let k = 0; k < cards; k++) {
      q.x = (g.dress[o] ?? 0) + k * 0.05 * side;
      q.y = 0;
      q.z = (g.dress[o + 1] ?? 0) + k * 0.03;
      q.facing = g.dress[o + 3] ?? 0;
      q.rot = flat ? (g.dress[o + 3] ?? 0) * 3 : side * (upright ? 2 + 10 * Math.abs(g.dress[o + 3] ?? 0) : 6 + 10 * k) * DEG;
      q.h = h * (1 - k * 0.15);
      q.w = q.h * (rect.size[0] / rect.size[1]) * (side < 0 && !flat ? -1 : 1);
      q.px = rect.pivot[0];
      q.py = rect.pivot[1];
      q.uv = rect.uv;
      q.sway = flat ? 0 : 0.03;
      q.phase = packPhase((i * 0.618034 + k * 0.3) * Math.PI * 2, flags);
      batch.writer.set(at++, q);
    }
  }
  batch.writer.count = at;
  batch.writer.commit(0, at);
}
