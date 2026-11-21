import { TERRAIN, type TerrainPond } from '../core/terrain.ts';
import { hash01 } from './wall.ts';

/**
 * Free roam's low solid stonework on the ground, as plain data for gl/masonry.ts: a rim of irregular stones round the
 * pond and a kerb along the front of the raised planting bank, where the ground shader paints the bank's edging
 * (core/terrain.ts TERRAIN.edging). Both stand on the ground they sit on and reach a little into it. Load time only.
 */

/** A stone of the pond rim: its outline (x, z pairs, counter-clockwise seen from above), bottom and top. */
export interface RimStone { outline: number[]; y0: number; y1: number }

/** The outline in counter-clockwise order seen from above (+y): reversed when its signed area says otherwise. */
export function counterClockwise(o: number[]): number[] {
  let area = 0;
  for (let i = 0; i < o.length; i += 2) {
    const j = (i + 2) % o.length;
    area += o[i + 1]! * o[j]! - o[i]! * o[j + 1]!;
  }
  if (area >= 0) return o;
  const r: number[] = [];
  for (let i = o.length - 2; i >= 0; i -= 2) r.push(o[i]!, o[i + 1]!);
  return r;
}

/** Pond rim: stones per metre of shore, the gap between them, how far each reaches inside and outside the shore line. */
const RIM = { perM: 2.2, gap: 0.035, inner: 0.1, outer: 0.2, sink: 0.06, top: [0.07, 0.13], corners: 7, jitter: 0.22 } as const;

/** The rim round the pond's ellipse: stones of slightly varied size, height and outline, from a fixed hash. */
export function pondRim(p: TerrainPond): RimStone[] {
  const n = Math.round((Math.PI * (3 * (p.rx + p.rz) - Math.sqrt((3 * p.rx + p.rz) * (p.rx + 3 * p.rz))) * RIM.perM));
  const out: RimStone[] = [];
  const at = (t: number, off: number): [number, number] => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    const nx = c / p.rx;
    const nz = s / p.rz;
    const l = Math.hypot(nx, nz);
    return [p.x + p.rx * c + (nx / l) * off, p.z + p.rz * s + (nz / l) * off];
  };
  for (let i = 0; i < n; i++) {
    const t0 = ((i + 0.5 * hash01(i, 0x31) * RIM.jitter) / n) * Math.PI * 2;
    const t1 = ((i + 1 + 0.5 * hash01(i + 1, 0x31) * RIM.jitter) / n) * Math.PI * 2;
    const mid = (t0 + t1) / 2;
    const [cx, cz] = at(mid, (RIM.outer - RIM.inner) / 2);
    // The stone is an irregular convex polygon inside the quad between its two shore angles, its gap taken off each end.
    const [ax, az] = at(t0, -RIM.inner);
    const [bx, bz] = at(t1, -RIM.inner);
    const [ex, ez] = at(t1, RIM.outer);
    const [fx, fz] = at(t0, RIM.outer);
    const quad = [ax, az, bx, bz, ex, ez, fx, fz];
    const outline: number[] = [];
    for (let k = 0; k < RIM.corners; k++) {
      const e = (k / RIM.corners) * 4;
      const j = Math.floor(e);
      const f = e - j;
      const px = quad[j * 2]! + (quad[((j + 1) % 4) * 2]! - quad[j * 2]!) * f;
      const pz = quad[j * 2 + 1]! + (quad[((j + 1) % 4) * 2 + 1]! - quad[j * 2 + 1]!) * f;
      const len = Math.hypot(px - cx, pz - cz) || 1;
      const shrink = RIM.gap / 2 + 0.03 * hash01(i * 13 + k, 0x5a) + (f < 0.05 ? 0.02 : 0);
      outline.push(px - ((px - cx) / len) * shrink, pz - ((pz - cz) / len) * shrink);
    }
    const h = RIM.top[0] + (RIM.top[1] - RIM.top[0]) * hash01(i, 0x77);
    out.push({ outline: counterClockwise(outline), y0: -RIM.sink, y1: h });
  }
  return out;
}

/** Bank kerb: sample step along the path (m), its width, top above the bank's soil and depth into the ground. */
const KERB = { step: 0.25, width: TERRAIN.edging[1], rise: 0.04, sink: 0.08 } as const;

/** Distance from (x, z) to the polyline. */
function distTo(pts: readonly (readonly [number, number])[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The bank share from which the kerb stands: the painted edging fades in about here. */
const BANK_KEPT = 0.15;

/** Whether the raised bank stands at (x, z) (ground.height.glsl bankKeep). */
function onBank(x: number, z: number, pond: TerrainPond | null): boolean {
  let keep = 1 - smooth(TERRAIN.bankFront[1], TERRAIN.bankFront[0], z);
  if (pond !== null) keep *= smooth(TERRAIN.pondClear[0], TERRAIN.pondClear[1], Math.hypot((x - pond.x) / pond.rx, (z - pond.z) / pond.rz));
  return keep > BANK_KEPT;
}

/**
 * The kerb's runs: centre lines (x, z pairs) along both sides of the path at the edging's middle, kept only where the
 * bank stands and no other stretch of the path comes nearer. Its top is the bank's height plus the rise.
 */
export function bankKerbs(path: readonly (readonly [number, number])[], pond: TerrainPond | null): number[][] {
  const mid = TERRAIN.edging[0] + TERRAIN.edging[1] / 2;
  const runs: number[][] = [];
  for (const side of [1, -1]) {
    let run: number[] = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const [ax, az] = path[i]!;
      const [bx, bz] = path[i + 1]!;
      const len = Math.hypot(bx - ax, bz - az);
      const nx = (-(bz - az) / len) * side;
      const nz = ((bx - ax) / len) * side;
      const steps = Math.max(1, Math.round(len / KERB.step));
      for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
        const x = ax + ((bx - ax) * k) / steps + nx * mid;
        const z = az + ((bz - az) * k) / steps + nz * mid;
        if (onBank(x, z, pond) && distTo(path, x, z) > mid - 0.02) run.push(x, z);
        else {
          if (run.length >= 4) runs.push(run);
          run = [];
        }
      }
    }
    if (run.length >= 4) runs.push(run);
  }
  return runs;
}

export const KERB_SHAPE = { width: KERB.width, top: TERRAIN.bank + KERB.rise, bottom: -KERB.sink } as const;
