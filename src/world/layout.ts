import type { BedId, BedScene, GardenLayout, Layer, Placement, Slot } from '../types.ts';

/**
 * The 3D world data of cook/ART.md sections 1 and 2, as world reads content/garden.json and content/beds/*.json.
 * It extends the frozen types of src/types.ts with fields the frozen ones leave out (extra JSON fields are kept by the
 * static imports). Units: metres, world coordinates everywhere (x along the garden, y up, z toward the camera, ground at
 * y 0). Angles in the JSON are degrees.
 */

/** One camera key on the raised rail; pitch, yaw and fov in degrees (fov vertical). */
export interface RailKey { x: number; y: number; z: number; pitch: number; yaw: number; fov: number; bed?: BedId }

/** Mobile portrait: every key at this height, pushed back by dz, at this pitch and fov, yaw 0. */
export interface RailPortrait { y: number; dz: number; pitch: number; fov: number }

/** A film pose (stills and the low drops), degrees. */
export interface FilmPose { x: number; y: number; z: number; pitch: number; yaw: number; fov: number }

/** off: beds whose stop is not on the rail (the grotto, behind the wall), with their pose. */
export interface RailData { keys: RailKey[]; portrait: RailPortrait; yawLeadDeg: number; off: Partial<Record<BedId, FilmPose>> }

/** Ground and wall plan (ART section 1, "Ground" and "Wall"). Points are (x, z). */
export interface GroundData {
  path: { points: [number, number][]; width: number; spur: [number, number][] };
  puddles: [number, number][];
  /** The pond ellipse on the ground plane (centre and semi-axes). */
  pond: { x: number; z: number; rx: number; rz: number };
  /** Garden length along x, metres. */
  length: number;
  wall: { z: number; h: number; flatW: number; flatYaw: [number, number]; piers: number[]; low: [number, number, number][] };
  /** Contact shadow length (times the cutout height) per place, keyed by the bed whose stretch of x it falls in. */
  shadowLength: Record<BedId, number>;
  /** Unit (x, z) direction every contact shadow falls toward. */
  shadowDir: [number, number];
  clumps: { high: number; low: number };
}

export interface WorldLayout extends GardenLayout {
  rail: RailData;
  film: Record<string, FilmPose>;
  ground: GroundData;
}

export type SizeClass = 'hero' | 'large' | 'medium' | 'small';
export type ValueGroup = 'L' | 'M' | 'D';
export type Foot = 'sprays' | 'pot' | 'clump' | 'none';

/**
 * A cutout standing at a true 3D position. `h` (or `w` when only the width is known) is the world size at scale 1;
 * `scale` stays a plain multiplier (the pipeline's bed check requires it). hinge: yaw in degrees, plus turns the right
 * edge toward the camera. lean: degrees back (8 for standing cutouts, 0 for architecture and hanging things).
 * flat: lies on the ground. wing: a near mask that fades while the camera walks fast.
 */
export interface Placement3 extends Placement {
  z: number;
  h?: number;
  w?: number;
  hinge: number;
  lean: number;
  size: SizeClass;
  group: ValueGroup;
  foot: Foot;
  shadow: boolean;
  react: boolean;
  flat?: boolean;
  wing?: boolean;
}

export interface Layer3 extends Layer { items: Placement3[] }

/** Slots carry a hinge too (the flower turns from it toward the camera on focus). */
export interface Slot3 extends Slot { hinge: number }

/** shade: the place shadow colour (hex) that groups M and D are mixed toward. */
export interface BedScene3 extends BedScene { layers: Layer3[]; slots: Slot3[]; shade: string }

export const DEG = Math.PI / 180;
