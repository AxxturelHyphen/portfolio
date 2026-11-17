import type { AtlasManifest, SpriteId, SpriteRect } from '../types.ts';

/**
 * Sprite lookup for 3D placements (cook/ART.md section 5 names). Ids on the shared pages (sh/, v/, w/) are looked up
 * in the shared manifest first, every other id in the bed's own; either may have packed it. A missing id draws
 * nothing: no disc, no stand-in (cook/R02_FINDINGS.md 5). Misses are counted by the caller, never silent.
 */

export type AtlasKey = 'bed' | 'shared';
export interface Resolved { from: AtlasKey; rect: SpriteRect }

const SHARED_PREFIX = /^(sh|v|w)\//;

export function resolveSprite(id: SpriteId, bed: AtlasManifest, shared: AtlasManifest | null): Resolved | null {
  const order: [AtlasKey, AtlasManifest | null][] = SHARED_PREFIX.test(id) ? [['shared', shared], ['bed', bed]] : [['bed', bed], ['shared', shared]];
  for (const [from, m] of order) {
    const rect = m?.sprites[id];
    if (rect !== undefined) return { from, rect };
  }
  return null;
}

/** World width and height of a placement: its h (or w) at scale 1 times scale, the sprite's own aspect kept. */
export function placedSize(rect: SpriteRect, h: number | undefined, w: number | undefined, scale: number, out: [number, number]): [number, number] {
  const aspect = rect.size[0] / Math.max(1e-6, rect.size[1]);
  const height = h !== undefined ? h : w !== undefined ? w / aspect : rect.size[1];
  out[1] = height * scale;
  out[0] = height * aspect * scale;
  return out;
}
