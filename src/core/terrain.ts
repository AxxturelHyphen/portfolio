/**
 * The free-roam ground's height (cook/PLAN_3D.md F3): the path's slabs stand a few cm proud of the soil and the planted
 * ground north of the path is a raised bank behind a low tile edging, kept off the pond rim. gl's ground shader draws
 * the same surface (shaders/ground.height.glsl, fed TERRAIN as uniforms); this copy lifts every cutout onto it
 * (gl/instances.ts) and lands taps on it (world/camera.ts). Zero until set, so the rail stays flat. Pure, no allocation.
 */
export const TERRAIN = {
  /** Slab top above the soil (m), and the path distance over which the slabs give out (stones reach 0.8 m). */
  slab: 0.03, slabEdge: [0.6, 0.8],
  /** Bank height (m), the world z where its front starts rising and where it is full, its ramp behind the edging (m). */
  bank: 0.12, bankFront: [-0.95, -1.25], ramp: 0.3,
  /** Edging: distance from the path centre to its face, its width, its rise above the bank (m). */
  edging: [0.82, 0.11, 0.025],
  /** The bank gives out between these multiples of the pond's semi-axes. */
  pondClear: [1.15, 1.45],
} as const;

/** Distance field levels per metre (gl/ground.layout.ts RANGE_M: 1 cm per level). */
const LEVEL_M = 0.01;

export interface TerrainField { readonly data: Uint8Array; readonly w: number; readonly h: number }
export interface TerrainRect { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }
export interface TerrainPond { readonly x: number; readonly z: number; readonly rx: number; readonly rz: number }

let field: TerrainField | null = null;
let rect: TerrainRect = { x0: 0, z0: 0, x1: 1, z1: 1 };
let pond: TerrainPond | null = null;

/** Load time, roam only: the baked path distance field over `r` and the pond the bank keeps clear of. */
export function setTerrain(f: TerrainField, r: TerrainRect, p: TerrainPond | null): void {
  field = f;
  rect = r;
  pond = p;
}

export const terrainField = (): TerrainField | null => field;
export const terrainRect = (): TerrainRect => rect;
export const terrainPond = (): TerrainPond | null => pond;

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The field bilinearly sampled at (x, z), as the shader's linear filter reads it. */
function pathDistAt(f: TerrainField, x: number, z: number): number {
  const u = Math.min(f.w - 1, Math.max(0, ((x - rect.x0) / (rect.x1 - rect.x0)) * f.w - 0.5));
  const v = Math.min(f.h - 1, Math.max(0, ((z - rect.z0) / (rect.z1 - rect.z0)) * f.h - 0.5));
  const i = Math.min(f.w - 2, Math.floor(u));
  const j = Math.min(f.h - 2, Math.floor(v));
  const a = u - i;
  const b = v - j;
  const o = j * f.w + i;
  const top = (f.data[o] ?? 0) * (1 - a) + (f.data[o + 1] ?? 0) * a;
  const bottom = (f.data[o + f.w] ?? 0) * (1 - a) + (f.data[o + f.w + 1] ?? 0) * a;
  return (top * (1 - b) + bottom * b) * LEVEL_M;
}

/** Ground height at (x, z): the slabs' top on the path, the bank behind its edging, 0 elsewhere and on the rail. */
export function terrainY(x: number, z: number): number {
  if (field === null) return 0;
  const pd = pathDistAt(field, x, z);
  const back = TERRAIN.edging[0] + TERRAIN.edging[1] - 0.02;
  let keep = 1 - smooth(TERRAIN.bankFront[1], TERRAIN.bankFront[0], z);
  if (pond !== null) keep *= smooth(TERRAIN.pondClear[0], TERRAIN.pondClear[1], Math.hypot((x - pond.x) / pond.rx, (z - pond.z) / pond.rz));
  return TERRAIN.slab * (1 - smooth(TERRAIN.slabEdge[0], TERRAIN.slabEdge[1], pd)) + TERRAIN.bank * keep * smooth(back, back + TERRAIN.ramp, pd);
}
