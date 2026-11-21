import { TERRAIN, type TerrainPond } from '../core/terrain.ts';
import { hash01 } from './wall.ts';

/**
 * Free roam's low solid stonework on the ground, as plain data for gl/masonry.ts: a rim of irregular stones round the
 * pond and a kerb of laid stones along the front of the raised planting bank, on its edge line (core/terrain.ts
 * TERRAIN.edging). Both stand on the ground they sit on and reach a little into it. Load time only.
 */

/** A stone of the pond rim or the kerb: its outline (x, z pairs, counter-clockwise seen from above), bottom and top. */
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

/**
 * Bank kerb: sample step along the path (m), its width, depth into the ground; each stone's length (least, spread), the
 * joint between stones, the corner chamfer (least, spread), and the jitter of its width, top and outline (m).
 */
const KERB = {
  step: 0.25, width: TERRAIN.edging[1], sink: 0.08, length: [0.3, 0.15], joint: 0.012, chamfer: [0.01, 0.012],
  widthJitter: 0.012, topJitter: 0.014, outlineJitter: 0.005,
} as const;

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

/** The bank share from which the kerb stands. */
const BANK_KEPT = 0.15;

/** How much of the raised bank stands at (x, z), 0 to 1 (ground.height.glsl bankKeep). */
function bankKeep(x: number, z: number, pond: TerrainPond | null): number {
  let keep = 1 - smooth(TERRAIN.bankFront[1], TERRAIN.bankFront[0], z);
  if (pond !== null) keep *= smooth(TERRAIN.pondClear[0], TERRAIN.pondClear[1], Math.hypot((x - pond.x) / pond.rx, (z - pond.z) / pond.rz));
  return keep;
}

/**
 * The kerb's runs: centre lines (x, z pairs) along both sides of the path at the edging's middle, kept only where the
 * bank stands and no other stretch of the path comes nearer.
 */
function bankKerbs(path: readonly (readonly [number, number])[], pond: TerrainPond | null): number[][] {
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
        if (bankKeep(x, z, pond) > BANK_KEPT && distTo(path, x, z) > mid - 0.02) run.push(x, z);
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

/** The point at arc length s along a line (x, z pairs) whose cumulative lengths are `at`. */
function pointAt(line: readonly number[], at: readonly number[], s: number): [number, number] {
  let i = 0;
  while (i + 2 < at.length && at[i + 1]! < s) i++;
  const f = Math.min(1, Math.max(0, (s - at[i]!) / (at[i + 1]! - at[i]! || 1)));
  return [line[i * 2]! + (line[i * 2 + 2]! - line[i * 2]!) * f, line[i * 2 + 1]! + (line[i * 2 + 3]! - line[i * 2 + 1]!) * f];
}

/**
 * The kerb as stones laid end to end along each run: each a chamfered block of slightly varied length, width, top and
 * outline from a fixed hash, a thin joint between them. Its top is the bank's height there plus the kerb's rise, so
 * the kerb sinks with the bank where it gives out.
 */
export function kerbStones(path: readonly (readonly [number, number])[], pond: TerrainPond | null): RimStone[] {
  const out: RimStone[] = [];
  let seed = 0;
  for (const line of bankKerbs(path, pond)) {
    const at = [0];
    for (let i = 2; i < line.length; i += 2) at.push(at[at.length - 1]! + Math.hypot(line[i]! - line[i - 2]!, line[i + 1]! - line[i - 1]!));
    const total = at[at.length - 1]!;
    let s0 = 0;
    while (s0 < total - 0.05) {
      const n = seed++;
      let s1 = s0 + KERB.length[0] + KERB.length[1] * hash01(n, 0x4b);
      // A short remainder joins its stone, or halves the pair when that would make a log.
      if (total - s1 < KERB.length[0] * 0.6) s1 = total - s0 > KERB.length[0] + KERB.length[1] ? (s0 + total) / 2 : total;
      const [ax, az] = pointAt(line, at, s0 + KERB.joint / 2);
      const [bx, bz] = pointAt(line, at, s1 - KERB.joint / 2);
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      const half = len / 2;
      const w = (KERB.width + KERB.widthJitter * (hash01(n, 0x2c) - 0.5) * 2) / 2;
      const c = KERB.chamfer[0] + KERB.chamfer[1] * hash01(n, 0x6e);
      const corners = [[-half + c, -w], [half - c, -w], [half, -w + c], [half, w - c], [half - c, w], [-half + c, w], [-half, w - c], [-half, -w + c]] as const;
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      const outline: number[] = [];
      corners.forEach(([u, v], k) => {
        const j = KERB.outlineJitter * (hash01(n * 8 + k, 0x19) - 0.5) * 2;
        outline.push(cx + ux * (u + j) - uz * v, cz + uz * (u + j) + ux * v);
      });
      const top = TERRAIN.bank * bankKeep(cx, cz, pond) + TERRAIN.edging[2] + KERB.topJitter * (hash01(n, 0x58) - 0.5) * 2;
      out.push({ outline: counterClockwise(outline), y0: -KERB.sink, y1: top });
      s0 = s1;
    }
  }
  return out;
}
