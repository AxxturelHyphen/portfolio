import type { TerrainField, TerrainRect } from '../core/terrain.ts';
import { counterClockwise } from './solids.ts';

/**
 * Free roam's path slabs as real stones (gl/slabs.ts builds them): the very flagstones the ground shader paints
 * (shaders/ground.frag.glsl flagstone, onPathOf), traced on the CPU so the stones stand where the painted path lay. A
 * slab is a cell of the warped Voronoi pattern whose centre lies on the path; its outline is found by rays from its
 * seed out to where the cell gives way to the joint between slabs or to the path's reach. Plain data. Load time only.
 */

/** The shader's flagstone constants (ground.frag.glsl): path half width, stone size and the farthest a stone reaches. */
const HALF_WIDTH = 0.55;
const CELL = 0.42;
const STONE_REACH = HALF_WIDTH + CELL * 0.6;
/**
 * The outline: rays per stone, their march step and longest reach (m), the bisection steps, and the joint (F2 - F1 in
 * metres, about twice the distance to the cell's border) the outline keeps back from the painted gap's middle.
 */
const TRACE = { rays: 14, step: 0.025, reach: 0.45, bisect: 6, joint: 0.018 };

/** A stone: its outline (x, z pairs, counter-clockwise seen from above) and the seed it was traced from. */
export interface Slab { outline: number[]; x: number; z: number; id: number }

const fract = (x: number): number => x - Math.floor(x);

function hash12(x: number, y: number): number {
  let a = fract(x * 0.1031);
  let b = fract(y * 0.1031);
  let c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}

/** hash22 of common.glsl, written into out. */
function hash22(x: number, y: number, out: Float64Array): void {
  let a = fract(x * 0.1031);
  let b = fract(y * 0.103);
  let c = fract(x * 0.0973);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  out[0] = fract((a + b) * c);
  out[1] = fract((a + c) * b);
}

function valueNoise(x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash12(i, j) + (hash12(i + 1, j) - hash12(i, j)) * ux;
  const b = hash12(i, j + 1) + (hash12(i + 1, j + 1) - hash12(i, j + 1)) * ux;
  return a + (b - a) * uy;
}

const h = new Float64Array(2);
/** The flagstone cell at world (x, z): out = [border (F2 - F1, cells), cell i, cell j]. */
function flagstone(x: number, z: number, out: Float64Array): void {
  const px = x / CELL + 0.22 * (valueNoise(x * 3.1, z * 3.1) - 0.5);
  const pz = z / CELL + 0.22 * (valueNoise(x * 3.1 + 17, z * 3.1 + 17) - 0.5);
  const i = Math.floor(px);
  const j = Math.floor(pz);
  let d1 = 8;
  let d2 = 8;
  for (let gy = -1; gy <= 1; gy++) {
    for (let gx = -1; gx <= 1; gx++) {
      hash22(i + gx, j + gy, h);
      const ox = gx + 0.15 + 0.7 * h[0]! - (px - i);
      const oz = gy + 0.15 + 0.7 * h[1]! - (pz - j);
      const d = ox * ox + oz * oz;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        out[1] = i + gx;
        out[2] = j + gy;
      } else if (d < d2) d2 = d;
    }
  }
  out[0] = Math.sqrt(d2) - Math.sqrt(d1);
}

/** The path field bilinearly sampled at (x, z) in metres, as the shader's linear filter reads it. */
function pathDist(f: TerrainField, r: TerrainRect, x: number, z: number): number {
  const u = Math.min(f.w - 1, Math.max(0, ((x - r.x0) / (r.x1 - r.x0)) * f.w - 0.5));
  const v = Math.min(f.h - 1, Math.max(0, ((z - r.z0) / (r.z1 - r.z0)) * f.h - 0.5));
  const i = Math.min(f.w - 2, Math.floor(u));
  const j = Math.min(f.h - 2, Math.floor(v));
  const a = u - i;
  const b = v - j;
  const o = j * f.w + i;
  const top = f.data[o]! * (1 - a) + f.data[o + 1]! * a;
  const bottom = f.data[o + f.w]! * (1 - a) + f.data[o + f.w + 1]! * a;
  return (top * (1 - b) + bottom * b) * 0.01;
}

/**
 * Every slab of the path over the baked path field `f` over the rectangle `r` (core/terrain.ts terrainField and
 * terrainRect, the field the ground shader reads).
 */
export function pathSlabs(f: TerrainField, r: TerrainRect): Slab[] {
  const cell = new Float64Array(3);
  const out: Slab[] = [];
  const inside = (i: number, j: number, x: number, z: number): boolean => {
    if (pathDist(f, r, x, z) >= STONE_REACH) return false;
    flagstone(x, z, cell);
    return cell[1] === i && cell[2] === j && cell[0]! * CELL > TRACE.joint;
  };
  for (let j = Math.floor(r.z0 / CELL); j <= Math.ceil(r.z1 / CELL); j++) {
    for (let i = Math.floor(r.x0 / CELL); i <= Math.ceil(r.x1 / CELL); i++) {
      if (pathDist(f, r, (i + 0.5) * CELL, (j + 0.5) * CELL) >= HALF_WIDTH) continue;
      // The seed in world space: the warp is undone by a few fixed-point steps (it moves a seed under 5 cm).
      hash22(i, j, h);
      const sx = i + 0.15 + 0.7 * h[0]!;
      const sz = j + 0.15 + 0.7 * h[1]!;
      let x = sx * CELL;
      let z = sz * CELL;
      for (let k = 0; k < 4; k++) {
        const wx = 0.22 * (valueNoise(x * 3.1, z * 3.1) - 0.5);
        const wz = 0.22 * (valueNoise(x * 3.1 + 17, z * 3.1 + 17) - 0.5);
        x = (sx - wx) * CELL;
        z = (sz - wz) * CELL;
      }
      if (!inside(i, j, x, z)) continue;
      const outline: number[] = [];
      for (let k = 0; k < TRACE.rays; k++) {
        const a = (k / TRACE.rays) * Math.PI * 2;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        let lo = 0;
        let hi = TRACE.reach;
        for (let t = TRACE.step; t <= TRACE.reach; t += TRACE.step) {
          if (inside(i, j, x + dx * t, z + dz * t)) lo = t;
          else {
            hi = t;
            break;
          }
        }
        for (let b = 0; b < TRACE.bisect && hi < TRACE.reach; b++) {
          const m = (lo + hi) / 2;
          if (inside(i, j, x + dx * m, z + dz * m)) lo = m;
          else hi = m;
        }
        outline.push(x + dx * lo, z + dz * lo);
      }
      out.push({ outline: counterClockwise(outline), x, z, id: out.length });
    }
  }
  return out;
}
