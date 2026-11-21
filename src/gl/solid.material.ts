import { DataTexture, FrontSide, GLSL3, LessEqualDepth, NoBlending, RawShaderMaterial, RGBAFormat, SRGBColorSpace, Vector3, Vector4 } from 'three';
import type { AtlasManifest, AtlasTextures } from '../types.ts';
import { sharedUniforms } from './lights.ts';
import common from './shaders/common.glsl?raw';
import lights from './shaders/lights.glsl?raw';
import vertexBody from './shaders/solid.vert.glsl?raw';
import fragmentBody from './shaders/solid.frag.glsl?raw';

/**
 * The lit paper solid: real geometry (gl/masonry.ts) painted with a stone tile of the shared atlas at its real scale and
 * lit like the cutouts round it (solid.frag.glsl), a lantern's glass with a warm light of its own, back faces culled, opaque and depth tested. It sits in the transparent
 * list at its mesh's paint order, so it lands among the cutouts as the iron gate does, and goes through the film pass
 * with the rest of the scene. Every material is made before Gfx.warm() with a stand-in texture, so its program compiles
 * there; bindSolidTiles hands them their tiles once the shared atlas is up (a texture swap, no recompile).
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

interface Made { tile: string; material: RawShaderMaterial }
const made: Made[] = [];

type Rgb = readonly [number, number, number];

/**
 * A tile's own look on top of its caller's tint: a factor on the tint and how much its top faces lift (0 none). The
 * kerb is pale grey garden stone set in the ground: its tops catch the lantern as the path slabs do.
 */
const TILE_LOOK: Readonly<Record<string, { pale: Rgb; top: number }>> = {
  'tile/kerb': { pale: [1.42, 1.38, 1.4], top: 0.45 },
};
/** A material's extras: a warm light of its own (a lantern's glass), and instancing (pieces moved one by one). */
export interface SolidOptions { glow?: Rgb; instanced?: boolean }

/**
 * The solid material for one atlas tile (e.g. 'tile/wall') under a tint; one per tile, tint and options, shared by
 * every caller.
 */
export function solidMaterial(tile: string, tint: Rgb, options: SolidOptions = {}): RawShaderMaterial {
  const glow = options.glow ?? [0, 0, 0];
  const look = TILE_LOOK[tile];
  const instanced = options.instanced === true;
  const key = `${tile}|${tint.join(',')}|${glow.join(',')}|${instanced ? 'i' : ''}`;
  const found = made.find((m) => m.material.name === key);
  if (found !== undefined) return found.material;
  const material = new RawShaderMaterial({
    name: key,
    defines: instanced ? { INSTANCED: '' } : {},
    glslVersion: GLSL3,
    vertexShader: common + vertexBody,
    fragmentShader: common + lights + fragmentBody,
    uniforms: {
      ...sharedUniforms,
      uColor: { value: standInColor },
      uNormal: { value: standInNormal },
      uTile: { value: new Vector4(1, NORMAL_GAIN, INSET, look?.top ?? 0) },
      uRect: { value: new Vector4(0, 0, 1, 1) },
      uTint: { value: new Vector3(...tint).multiply(new Vector3(...(look?.pale ?? [1, 1, 1]))) },
      uGlow: { value: new Vector3(...glow) },
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
  made.push({ tile, material });
  return material;
}

/** Hands every solid material its tile from the shared atlas (load time); a tile missing from it keeps the stand-in. */
export function bindSolidTiles(atlas: { manifest: AtlasManifest; tex: AtlasTextures } | null): void {
  if (atlas === null) return;
  for (const { tile, material } of made) {
    const rect = atlas.manifest.sprites[tile];
    const color = rect === undefined ? undefined : atlas.tex.color[rect.page];
    const normal = rect === undefined ? undefined : atlas.tex.normal[rect.page];
    if (rect === undefined || color === undefined || normal === undefined) continue;
    const u = material.uniforms;
    u['uColor']!.value = color;
    u['uNormal']!.value = normal;
    (u['uTile']!.value as Vector4).x = rect.size[0];
    (u['uRect']!.value as Vector4).fromArray(rect.uv);
  }
}
