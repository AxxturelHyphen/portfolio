import { Matrix4, Vector2, Vector3, Vector4 } from 'three';
import { linearHex } from './colour.ts';

/**
 * Uniforms shared by every gl program (cutouts, ground, sky, fireflies): one object per uniform, referenced (not copied)
 * by each material, so the camera and light rigs write them once per frame. Colours are linear.
 * Defaults are the Rosaleda night of cook/ART.md section 1 (sky #181634 / #5e506d, ambient #3a3550).
 *
 * Light roles (cook/ART.md section 1, Light):
 * - uMoonDir / uMoonColor: the soft key on the faces, from the upper left front (written by the world light rig).
 * - uMoonBack: the real moon, low behind the garden at azimuth -10 degrees; it gives the rim on the moon side, the
 *   halo in the sky and the glint in the puddles. It sinks from 9 to 4 degrees with the camera x (setMoonByX).
 * - uCursor: the warm hand light; uGather: the focus light; uFly: up to 4 fireflies that light nearby paper.
 */
export const FLY_LIGHTS = 4;

/** Moon azimuth and its elevation at the gate and at the exit (cook/ART.md section 1). */
const MOON = { azimuthDeg: -10, elevationGateDeg: 9, elevationExitDeg: 4, gateX: 0, exitX: 45 } as const;
/** Shadow decals fall toward (+0.34 x, +0.94 z), length per unit of height (Rosaleda 0.5), opacity 18 %. */
const SHADOW_DECAL = { x: 0.34, z: 0.94, lengthPerHeight: 0.5, opacity: 0.18 } as const;

/** Depth haze toward the wall: the place shadow, thickening past 3 m from the lens. */
const HAZE = { colour: '#1b1838', density: 0.06 } as const;
function hazeOf(hex: string, density: number): Vector4 {
  const c = linearHex(hex, new Vector3());
  return new Vector4(c.x, c.y, c.z, density);
}

export const sharedUniforms = {
  uViewProj: { value: new Matrix4() },
  uCamPos: { value: new Vector3(0, 2.6, 4.6) },
  uCamRight: { value: new Vector3(1, 0, 0) },
  uCamUp: { value: new Vector3(0, 1, 0) },
  uTime: { value: 0 },
  uWind: { value: new Vector2(0, 0.5) },
  uCursor: { value: new Vector4(0, 0, 1, 2.5) },
  uCursorColor: { value: linearHex('#ffd6ab', new Vector3(), 2.2) },
  uGather: { value: new Vector4(0, 0, 0, 0) },
  uMoonDir: { value: new Vector3(-0.35, 0.8, 0.5).normalize() },
  uMoonColor: { value: linearHex('#b3aacb', new Vector3(), 1.1) },
  uMoonBack: { value: new Vector3(0, 0.15, -1).normalize() },
  uRimColor: { value: linearHex('#f1d7b4', new Vector3(), 0.6) },
  uSkyTop: { value: linearHex('#181634', new Vector3()) },
  uSkyHorizon: { value: linearHex('#5e506d', new Vector3()) },
  uAmbient: { value: linearHex('#3a3550', new Vector3()) },
  uShadowColor: { value: linearHex('#261e3d', new Vector3()) },
  uShadowDir: { value: new Vector4(SHADOW_DECAL.x, SHADOW_DECAL.z, SHADOW_DECAL.lengthPerHeight, SHADOW_DECAL.opacity) },
  uHaze: { value: hazeOf(HAZE.colour, HAZE.density) },
  uFly: { value: Array.from({ length: FLY_LIGHTS }, () => new Vector4()) },
  uFlyColor: { value: linearHex('#ffb766', new Vector3(), 1.4) },
};
export type SharedUniforms = typeof sharedUniforms;

const DEG = Math.PI / 180;

/** Places the real moon for a camera at world x: a fixed azimuth, sinking toward the exit. No allocation. */
export function setMoonByX(x: number): void {
  const t = Math.min(1, Math.max(0, (x - MOON.gateX) / (MOON.exitX - MOON.gateX)));
  const el = (MOON.elevationGateDeg + (MOON.elevationExitDeg - MOON.elevationGateDeg) * t) * DEG;
  const az = MOON.azimuthDeg * DEG;
  sharedUniforms.uMoonBack.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
}

/** One place's light (cook/ART.md section 1 table), as sRGB hexes; garden/place.ts parses and eases them. */
export interface PlaceLight { skyTop: string; skyHorizon: string; ambient: string; shadow: string; shadowLength: number }
setMoonByX(10);
