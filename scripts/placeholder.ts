/// <reference types="node" />
// P1 placeholder stage: one flat cut-paper sprite plus its normal map for every sprite placed in content/beds/*.json,
// six bloom frames for every slot bloom, and the shared sprites. Writes archive/work/{sprite,normal}/*.png and the
// sprite catalog archive/work/sprites.json that the pack stage reads. Sources are 'code:placeholder' (code-made art).
import type { BloomDef, Project, SpriteId } from '../src/types.ts';
import { CATALOG, GUTTER, PX_PER_UNIT, SHARED_SPRITES, hashInputs, readBeds, spritePng, writeFile, writeJson, type Cache, type Catalog } from './stages/common.ts';
import { normalMap } from './stages/normal.ts';
import { encodePng } from './stages/raster.ts';
import { drawPlaceholder, shapeOf, type Shape } from './stages/shapes.ts';

export const PLACEHOLDER_SOURCE = 'code:placeholder';
const BLOOM_STEPS = 6;
const BLOOM_REST = { idea: 0.4, wip: 0.7, shipped: 1 };
const MAX_SIDE = 1024 - 2 * GUTTER;
const CODE = ['scripts/placeholder.ts', 'scripts/stages/shapes.ts', 'scripts/stages/normal.ts', 'scripts/stages/raster.ts'];

interface Job { id: SpriteId; shape: Shape; open: number }

const FLOWER_KINDS: readonly Project['flower'][] = ['rose', 'lily', 'pod', 'bud'];
function flowerKind(bloom: string, accepts: Project['flower'] | undefined): Project['flower'] {
  if (accepts !== undefined) return accepts;
  const k = shapeOf(bloom).kind;
  return FLOWER_KINDS.find((f) => f === k) ?? 'rose';
}

export const bloomFrame = (bloom: string, i: number): SpriteId => `${bloom}.f${i}`;

/** Every sprite and bloom the beds need, without drawing anything. */
export function plan(): { jobs: Job[]; blooms: Record<string, BloomDef> } {
  const jobs = new Map<SpriteId, Job>();
  const blooms: Record<string, BloomDef> = {};
  for (const bed of readBeds()) {
    for (const layer of bed.layers) for (const it of layer.items) if (!jobs.has(it.sprite)) jobs.set(it.sprite, { id: it.sprite, shape: shapeOf(it.sprite), open: 1 });
    for (const slot of bed.slots) {
      if (slot.bloom === undefined || blooms[slot.bloom] !== undefined) continue;
      const kind = flowerKind(slot.bloom, slot.accepts);
      const frames: SpriteId[] = [];
      for (let i = 0; i < BLOOM_STEPS; i++) {
        const id = bloomFrame(slot.bloom, i);
        frames.push(id);
        jobs.set(id, { id, shape: shapeOf(kind), open: i / (BLOOM_STEPS - 1) });
      }
      blooms[slot.bloom] = { kind, mode: 'frames', steps: BLOOM_STEPS, frames, rest: { ...BLOOM_REST } };
    }
  }
  for (const id of SHARED_SPRITES) if (!jobs.has(id)) jobs.set(id, { id, shape: shapeOf(id), open: 1 });
  return { jobs: [...jobs.values()], blooms };
}

export function runPlaceholder(cache: Cache): string {
  const { jobs, blooms } = plan();
  const code = hashInputs(CODE, [String(PX_PER_UNIT)]);
  const catalog: Catalog = { sprites: {}, blooms };
  let drawn = 0;
  for (const j of jobs) {
    const { kind, size, pivot } = j.shape;
    catalog.sprites[j.id] = { size: [size[0], size[1]], pivot: [pivot[0], pivot[1]], sources: [PLACEHOLDER_SOURCE] };
    const out = [spritePng(j.id, 'sprite'), spritePng(j.id, 'normal')] as const;
    const key = `placeholder:${j.id}`;
    const hash = hashInputs([], [code, kind, String(size), String(j.open)]);
    if (cache.fresh(key, hash, out)) continue;
    const k = Math.min(PX_PER_UNIT, MAX_SIDE / Math.max(size[0], size[1]));
    const color = drawPlaceholder(kind, Math.max(8, Math.round(size[0] * k)), Math.max(8, Math.round(size[1] * k)), j.open);
    writeFile(out[0], encodePng(color));
    writeFile(out[1], encodePng(normalMap(color, { bevelPx: 6, lumaHeight: 0.15, strength: 5 })));
    cache.set(key, hash);
    drawn++;
  }
  writeJson(CATALOG, catalog);
  return `placeholder: ${jobs.length} sprites (${drawn} drawn, ${jobs.length - drawn} cached), ${Object.keys(blooms).length} blooms`;
}
