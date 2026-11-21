import { DataTexture, FrontSide, GLSL3, LessEqualDepth, NoBlending, RawShaderMaterial, RGBAFormat, SRGBColorSpace, Vector4 } from 'three';
import type { Texture } from 'three';
import type { AtlasManifest, AtlasTextures } from '../types.ts';
import { sharedUniforms } from './lights.ts';
import common from './shaders/common.glsl?raw';
import lights from './shaders/lights.glsl?raw';
import vertexBody from './shaders/solid.vert.glsl?raw';
import fragmentBody from './shaders/solid.frag.glsl?raw';
import { SOLID_TILES } from './solid.paint.ts';

/**
 * The lit paper solid: real geometry (gl/masonry.ts) painted with a stone tile of the shared atlas at its real scale and
 * lit like the cutouts round it (solid.frag.glsl), back faces culled, opaque and depth tested. One material draws every
 * kind of solid: each vertex carries its paint (gl/solid.paint.ts: the tile's slot, its tint, its scale, the top faces' lift,
 * the grotto rock's marks and a lantern glass's own warm light), so the walls, the grotto and the ground stones and props
 * merge into a few draws. It sits in the transparent list at its mesh's paint order, so it lands among the cutouts as the
 * iron gate does, and goes through the film pass with the rest of the scene. Both variants (merged, and instanced for
 * the swinging sign boards) are made before Gfx.warm() with stand-in textures, so their programs compile there;
 * bindSolidTiles hands them the tiles once the shared atlas is up (a texture swap, no recompile).
 */

/** The tile's outer texels fade in alpha on its page (world/wall.ts BORDER): the solid samples this share inside it. */
const INSET = 0.004;
/** How far the tile's normal map bends the face normal. */
const NORMAL_GAIN = 0.6;

/** Stand-ins until the atlas binds: the stone tile's mean colour (#626256) and a flat normal. */
function pixel(r: number, g: number, b: number, srgb: boolean): DataTexture {
  const t = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, RGBAFormat);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
const standInColor = pixel(98, 98, 86, true);
const standInNormal = pixel(128, 128, 255, false);

const made: RawShaderMaterial[] = [];

/** The solid material: merged geometry, or `instanced` pieces moved one by one (the sign boards). One of each, shared. */
export function solidMaterial(instanced = false): RawShaderMaterial {
  const key = instanced ? 'solid-instanced' : 'solid';
  const found = made.find((m) => m.name === key);
  if (found !== undefined) return found;
  const material = new RawShaderMaterial({
    name: key,
    defines: { TILES: SOLID_TILES.length, ...(instanced ? { INSTANCED: '' } : {}) },
    glslVersion: GLSL3,
    vertexShader: common + vertexBody,
    fragmentShader: common + lights + fragmentBody,
    uniforms: {
      ...sharedUniforms,
      uColor: { value: SOLID_TILES.map(() => standInColor) },
      uNormal: { value: SOLID_TILES.map(() => standInNormal) },
      uTileM: { value: SOLID_TILES.map(() => 1) },
      uRect: { value: SOLID_TILES.map(() => new Vector4(0, 0, 1, 1)) },
      uTile: { value: new Vector4(0, NORMAL_GAIN, INSET, 0) },
    },
    transparent: true,
    blending: NoBlending,
    side: FrontSide,
    depthTest: true,
    depthFunc: LessEqualDepth,
    depthWrite: true,
    // Opaque in the transparent list: one pass, never three's back-then-front pair.
    forceSinglePass: true,
  });
  made.push(material);
  return material;
}

/** Hands the solid materials their tiles from the shared atlas (load time); a tile missing from it keeps the stand-in. */
export function bindSolidTiles(atlas: { manifest: AtlasManifest; tex: AtlasTextures } | null): void {
  if (atlas === null) return;
  for (const material of made) {
    const u = material.uniforms;
    SOLID_TILES.forEach((tile, i) => {
      const rect = atlas.manifest.sprites[tile];
      const color = rect === undefined ? undefined : atlas.tex.color[rect.page];
      const normal = rect === undefined ? undefined : atlas.tex.normal[rect.page];
      if (rect === undefined || color === undefined || normal === undefined) return;
      (u['uColor']!.value as Texture[])[i] = color;
      (u['uNormal']!.value as Texture[])[i] = normal;
      (u['uTileM']!.value as number[])[i] = rect.size[0];
      (u['uRect']!.value as Vector4[])[i]!.fromArray(rect.uv);
    });
  }
}
