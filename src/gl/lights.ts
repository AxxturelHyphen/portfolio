import { Matrix4, Vector2, Vector3, Vector4 } from 'three';
import { linearHex } from './colour.ts';

/**
 * Uniforms shared by every gl program (cutouts, ground, sky, fireflies): one object per uniform, referenced (not copied)
 * by each material, so the camera and light rigs write them once per frame. Colours are linear.
 * Defaults are the Rosaleda night of cook/ART.md section 1 (sky #181634 / #5e506d, ambient #3a3550).
 *
 * Light roles (cook/ART.md section 1, Light):
 * - uMoonDir / uMoonColor: the soft key on the faces, from the upper left front (written by the world light rig).
 * - uMoonBack: the real moon behind the garden; it gives the rim on the moon side, the halo in the sky and the glint in
 *   the puddles. Each place sets where it hangs for its key frame (garden/place.ts eases it, so a walk never jumps).
 * - uCursor: the warm hand light; uGather: the focus light; uFly: up to 4 fireflies that light nearby paper.
 * - uFocusBack: the plane the far layers fall back behind (softer, darker), with its amount: the focused flower, or a
 *   bed's flowers at a lower rest amount, so a bed shot keeps its wall behind the hero without a focus.
 * - uHandThrow: how much of the hand light reaches the ground (0..1): a bed's composed rest light, or a real pointer.
 * - uEye: the camera on the ground plane (x, z, written with uViewProj) and the standee turn weight: 0 on the rail,
 *   1 under free roam (cook/ROAM_PLAN.md 3), so rail views never move.
 * - uVisitor: the roaming visitor's ground point (x, z); cards flagged `fade` turn to a trace while they cover it.
 * - uPart: the grotto's ivy curtain (centre x, z, half width, metres apart): its cards part as the visitor nears it.
 * - uLamp: lanterns burning with their own amber pool (flame xyz, strength), free roam only: lamp 0 is the lantern the
 *   visitor carries (it takes over from the hand light: uHandOn 0), lamps 1 to 5 the standing props nearest it in view.
 * - uInvite / uInvites: the project flowers' own soft warm pools (light xyz, strength) and how many burn, free roam
 *   only: the active bed's and its neighbours', always on, so each project reads as the brightest thing in its bed after the carried lantern.
 * - uActorRim: the extra moon rim on the actor batch (the visitor), so the figure reads as the protagonist; 0 elsewhere.
 * - uFill: a near-foreground lift under free roam (0 on the rail).
 * - uDepthCut: cutout fragments under this alpha are discarded so their soft edges write no depth (free roam: the scene
 *   target has a depth buffer); 0 on the rail, where nothing is discarded.
 */
export const FLY_LIGHTS = 4;
/** Lanterns with their own amber light (a fixed count in the shader, world/lamps.ts LAMPS.count): the carried one and five standing props. */
export const LAMP_LIGHTS = 6;
/** The project flowers' own warm pools (a fixed count in the shader, world/invites.ts INVITES.count). */
export const INVITE_LIGHTS = 6;

/** Shadow decals fall toward (+0.34 x, +0.94 z), length per unit of height (Rosaleda 0.5), opacity 30 %. */
const SHADOW_DECAL = { x: 0.34, z: 0.94, lengthPerHeight: 0.5, opacity: 0.3 } as const;

/**
 * Depth haze toward the wall: the place shadow, thickening past 3 m from the lens. Free roam sees the wall from 13 m, so
 * its haze is a paler, thinner dusk air that starts later (HAZE_START in the shaders, by uEye.z): the wall keeps its stone.
 */
const HAZE = { colour: '#100f17', density: 0.06 } as const;
const ROAM_HAZE = { colour: '#2a2940', density: 0.03 } as const;
function hazeOf(hex: string, density: number, out = new Vector4()): Vector4 {
  const c = linearHex(hex, new Vector3());
  return out.set(c.x, c.y, c.z, density);
}

export const sharedUniforms = {
  uViewProj: { value: new Matrix4() },
  uCamPos: { value: new Vector3(0, 2.6, 4.6) },
  uEye: { value: new Vector3(0, 4.6, 0) },
  uVisitor: { value: new Float32Array(2) as Float32Array },
  uPart: { value: new Vector4(0, 0, 0, 0) },
  uCamRight: { value: new Vector3(1, 0, 0) },
  uCamUp: { value: new Vector3(0, 1, 0) },
  uTime: { value: 0 },
  uWind: { value: new Vector2(0, 0.5) },
  uCursor: { value: new Vector4(0, 0, 1, 2.5) },
  uCursorColor: { value: linearHex('#f6dfc0', new Vector3(), 5.0) },
  uGather: { value: new Vector4(0, 0, 0, 0) },
  uFocusBack: { value: new Vector4(0, 0, 0, 0) },
  uHandThrow: { value: 0 },
  uMoonDir: { value: new Vector3(-0.35, 0.8, 0.5).normalize() },
  uMoonColor: { value: linearHex('#b3aacb', new Vector3(), 1.1) },
  uMoonBack: { value: new Vector3(0, 0.15, -1).normalize() },
  uRimColor: { value: linearHex('#c9c4d8', new Vector3(), 0.6) },
  uSkyTop: { value: linearHex('#181634', new Vector3()) },
  uSkyHorizon: { value: linearHex('#5e506d', new Vector3()) },
  uAmbient: { value: linearHex('#3a3550', new Vector3()) },
  uShadowColor: { value: linearHex('#261e3d', new Vector3()) },
  uShadowDir: { value: new Vector4(SHADOW_DECAL.x, SHADOW_DECAL.z, SHADOW_DECAL.lengthPerHeight, SHADOW_DECAL.opacity) },
  uHaze: { value: hazeOf(HAZE.colour, HAZE.density) },
  uFly: { value: Array.from({ length: FLY_LIGHTS }, () => new Vector4()) },
  uFlyColor: { value: linearHex('#ffb766', new Vector3(), 1.4) },
  uHandOn: { value: 1 },
  uDepthCut: { value: 0 },
  uFill: { value: 0 },
  uLamp: { value: Array.from({ length: LAMP_LIGHTS }, () => new Vector4(0, 0, 0, 0)) },
  uLampColor: { value: linearHex('#f7ad4a', new Vector3(), 5.0) },
  uInvite: { value: Array.from({ length: INVITE_LIGHTS }, () => new Vector4(0, 0, 0, 0)) },
  uInvites: { value: 0 },
  uInviteColor: { value: linearHex('#f5c584', new Vector3(), 5.0) },
  uActorRim: { value: 0 },
};
export type SharedUniforms = typeof sharedUniforms;

const DEG = Math.PI / 180;

/** Places the real moon at an azimuth (degrees, negative is left of straight ahead) and elevation. No allocation. */
export function setMoon(azimuthDeg: number, elevationDeg: number): void {
  const el = elevationDeg * DEG;
  const az = azimuthDeg * DEG;
  sharedUniforms.uMoonBack.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
}

/** Turns the standees toward the eye (1, free roam) or keeps every cutout on its hinge (0, the rail). */
export function setStandeeTurn(weight: number): void {
  sharedUniforms.uEye.value.z = weight;
}

/**
 * Free roam's light: the scene target has a depth buffer and the cutouts' faint edges must not write it, and the hand
 * light hands its pool to the carried lantern (lamp 0): one light, not two stacked. uCursor keeps moving with the
 * visitor for what follows it (edges, bent leaves, the moth).
 */
const DEPTH_CUT = 0.02;
/** The near-foreground lift under free roam (lights.glsl fillAt), so ground the lanterns miss is never crushed black. */
const ROAM_FILL = 1;
/** Free roam's dusk key and rim (cook/ROAM_LOOK.md B): the walker's wider view needs more moon on the beds than the rail. */
const ROAM_MOON = { colour: '#b3aacb', strength: 1.15 } as const;
const ROAM_RIM = { colour: '#c9c4d8', strength: 0.65 } as const;
export function setRoamLight(): void {
  sharedUniforms.uDepthCut.value = DEPTH_CUT;
  sharedUniforms.uFill.value = ROAM_FILL;
  sharedUniforms.uHandOn.value = 0;
  linearHex(ROAM_MOON.colour, sharedUniforms.uMoonColor.value, ROAM_MOON.strength);
  linearHex(ROAM_RIM.colour, sharedUniforms.uRimColor.value, ROAM_RIM.strength);
  hazeOf(ROAM_HAZE.colour, ROAM_HAZE.density, sharedUniforms.uHaze.value);
}

/** Copies the lamp list (LAMP_LIGHTS vec4s: flame xyz, strength) into uLamp. No allocation. */
export function writeLamps(lamps: Float32Array): void {
  const u = sharedUniforms.uLamp.value;
  for (let i = 0; i < LAMP_LIGHTS; i++) u[i]!.fromArray(lamps, i * 4);
}

/**
 * Copies the lit flowers' pools (of INVITE_LIGHTS vec4s: light xyz, strength) to the front of uInvite and their count
 * into uInvites, so the shader loops over the lit ones only. No allocation.
 */
export function writeInvites(invites: Float32Array): void {
  const u = sharedUniforms.uInvite.value;
  let n = 0;
  for (let i = 0; i < INVITE_LIGHTS; i++) if (invites[i * 4 + 3]! > 0) u[n++]!.fromArray(invites, i * 4);
  sharedUniforms.uInvites.value = n;
}

/** Points uVisitor at the visitor's own [x, z] array: three uploads it with each frame, no copy per frame. */
export function carryVisitor(pos: Float32Array): void {
  sharedUniforms.uVisitor.value = pos;
}

/** One place's light (cook/ART.md section 1 table), as sRGB hexes; garden/place.ts parses and eases them. */
export interface PlaceLight {
  skyTop: string; skyHorizon: string; ambient: string; shadow: string; shadowLength: number;
  /** Where the moon hangs for this place's key frame: azimuth and elevation in degrees. */
  moon: readonly [number, number];
}
setMoon(-10, 7);
