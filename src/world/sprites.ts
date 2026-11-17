import type { AtlasManifest, SpriteId, SpriteRect } from '../types.ts';
import type { SizeClass } from './layout.ts';

/**
 * Sprite lookup for 3D placements (cook/ART.md section 5 names). Ids on the shared pages (sh/, v/, w/) are looked up
 * in the shared manifest first, every other id in the bed's own; either may have packed it. A missing id falls back to
 * the manifest's `placeholder` sprite, else to a stand-in from the bed's own sprites picked by size class, so a scene
 * always draws while the pipeline is still cutting plates. Fallbacks are counted, never silent.
 */

export type AtlasKey = 'bed' | 'shared';
export interface Resolved { from: AtlasKey; rect: SpriteRect; placeholder: boolean }

const SHARED_PREFIX = /^(sh|v|w)\//;
const PLACEHOLDER = 'placeholder';
const CLASS_RANK: Record<SizeClass, number> = { hero: 0, large: 0.25, medium: 0.5, small: 1 };

/** Wider than this, a stand-in (a wall band, a path strip) would blow up when fitted to a cutout's height. */
const STAND_IN_MAX_ASPECT = 1.5;

/** Bed sprites that may stand in for a missing one: upright, not a bloom frame, tallest first. Built once per manifest. */
export function standIns(m: AtlasManifest): SpriteId[] {
  const frames = new Set<string>();
  for (const b of Object.values(m.blooms)) for (const f of b.frames ?? []) frames.add(f);
  const upright = (id: SpriteId): boolean => {
    const r = m.sprites[id];
    return r !== undefined && r.size[0] <= r.size[1] * STAND_IN_MAX_ASPECT;
  };
  return Object.keys(m.sprites).filter((id) => !frames.has(id) && upright(id)).sort((a, b) => (m.sprites[b]?.size[1] ?? 0) - (m.sprites[a]?.size[1] ?? 0));
}

export function resolveSprite(id: SpriteId, size: SizeClass, bed: AtlasManifest, shared: AtlasManifest | null, stand: readonly SpriteId[]): Resolved | null {
  const order: [AtlasKey, AtlasManifest | null][] = SHARED_PREFIX.test(id) ? [['shared', shared], ['bed', bed]] : [['bed', bed], ['shared', shared]];
  for (const [from, m] of order) {
    const rect = m?.sprites[id];
    if (rect !== undefined) return { from, rect, placeholder: false };
  }
  for (const [from, m] of order) {
    const rect = m?.sprites[PLACEHOLDER];
    if (rect !== undefined) return { from, rect, placeholder: true };
  }
  if (stand.length === 0) return null;
  const pick = stand[Math.round(CLASS_RANK[size] * (stand.length - 1))] as SpriteId;
  const rect = bed.sprites[pick];
  return rect === undefined ? null : { from: 'bed', rect, placeholder: true };
}

/** World width and height of a placement: its h (or w) at scale 1 times scale, the sprite's own aspect kept. */
export function placedSize(rect: SpriteRect, h: number | undefined, w: number | undefined, scale: number, out: [number, number]): [number, number] {
  const aspect = rect.size[0] / Math.max(1e-6, rect.size[1]);
  const height = h !== undefined ? h : w !== undefined ? w / aspect : rect.size[1];
  out[1] = height * scale;
  out[0] = height * aspect * scale;
  return out;
}
