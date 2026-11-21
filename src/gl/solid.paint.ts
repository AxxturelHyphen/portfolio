/**
 * How a solid is painted (gl/solid.material.ts draws it): plain data, so the builders (gl/masonry.ts) and their unit
 * tests never load a shader.
 */

/** The tiles a solid may be painted with, in slot order (solid.frag.glsl samples slot i from uColor[i], uNormal[i]). */
export const SOLID_TILES = ['tile/wall', 'tile/wall-base', 'tile/coping', 'tile/moss', 'tile/kerb', 'tile/rim', 'tile/paper'] as const;
export type SolidTile = (typeof SOLID_TILES)[number];

type Rgb = readonly [number, number, number];

/**
 * A tile's own look on top of its caller's tint: a factor on the tint and how much its top faces lift (0 none). The
 * kerb is pale grey garden stone set in the ground: its tops catch the lantern as the path slabs do.
 */
const TILE_LOOK: Readonly<Partial<Record<SolidTile, { pale: Rgb; top: number }>>> = {
  'tile/kerb': { pale: [1.42, 1.38, 1.4], top: 0.45 },
};

/**
 * How a solid is painted: an atlas tile under a tint; glow, a warm light of its own (a lantern's glass); rock, the tile
 * laid this many times its real size with the grotto's hand-made marks (solid.frag.glsl: strata, facet tones, pencil
 * hatching in the shade).
 */
export interface SolidPaint { tile: SolidTile; tint: Rgb; glow?: Rgb; rock?: number }

/** One vertex's paint as attributes: aTint (rgb), aLook (slot, tile scale, top lift, rock), aGlow (rgb). */
export interface PaintAttributes { tint: [number, number, number]; look: [number, number, number, number]; glow: [number, number, number] }

export function solidPaint(p: SolidPaint): PaintAttributes {
  const look = TILE_LOOK[p.tile];
  const pale = look?.pale ?? [1, 1, 1];
  const rock = p.rock ?? 0;
  return {
    tint: [p.tint[0] * pale[0], p.tint[1] * pale[1], p.tint[2] * pale[2]],
    look: [SOLID_TILES.indexOf(p.tile), rock > 0 ? rock : 1, look?.top ?? 0, rock > 0 ? 1 : 0],
    glow: [...(p.glow ?? [0, 0, 0])],
  };
}
