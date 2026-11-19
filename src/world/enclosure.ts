import type { AtlasManifest, CutoutBatch, QuadParams, SpriteRect } from '../types.ts';
import type { EnclosureData } from './layout.ts';
import { QUAD_FLAG, packPhase } from './quadflags.ts';
import { BORDER, COPING, PIER_PROUD, SHADE_JITTER, TILE_ORIGIN_X, WALL_TILE, cuts, hash01 } from './wall.ts';

/**
 * The closed garden of free roam (cook/ROAM_ART.md section 3, task 5): the back wall cut at its low stretches and at the
 * Salida door (a doorway under a stone lintel, so no sky opens over it), piers, two end walls facing inward and a low
 * coped kerb along the front. Every run gets a stone base
 * course (tile/wall-base) and a coping (tile/coping) over the wall stone, so the wall has a foot and a top edge. Three
 * batches, one per tile page, painted base, then wall stone, then coping. Built at load, only under free roam: the
 * rail keeps its own wall (wall.ts).
 */

/**
 * A straight run of wall from (x, z) along (cos yaw, -sin yaw), facing (sin yaw, cos yaw), len long and h high. Its stone
 * starts at `from`: 0 stands on the ground, above 0 is a lintel over an opening (no base course, a coped soffit).
 */
export interface Run { x: number; z: number; yaw: number; len: number; h: number; from: number; pier: boolean }

const BASE_TILE = 'tile/wall-base';
const COPING_TILE = 'tile/coping';
/** Flats overlap at their joins so the small yaw never opens a seam onto the sky. */
const OVERLAP = 0.4;
const PIER_W = 0.5;
/** Height of the Salida doorway under its lintel; the hedge behind it (enclosure.hedge.top) stands at least this high. */
export const DOOR_TOP = 2.3;
/** The base course stands a little proud of the face (a foot), the mossy stone darker than the wall. */
/**
 * It starts a little under the ground and is painted under the wall stone, which overlaps its top by `under`: no soft
 * tile edge is left at the foot or on the course line to catch the moon rim.
 */
const BASE = { proud: 0.04, sink: 0.06, under: 0.05, tint: [0.62, 0.64, 0.58] } as const;
/** The closed garden's stone: warmer than the rail's wall (wall.ts WALL_TINT) at about its value, so the darker dusk keeps the wall far. */
const STONE_TINT = [0.8, 0.74, 0.64] as const;
const DEG = Math.PI / 180;

/** Wall height on the back line at x: full, a low stretch, or 0 in the door gap. */
export function backHeightAt(e: EnclosureData, wallH: number, x: number): number {
  if (x > e.door[0] && x < e.door[1]) return 0;
  for (const [x0, x1, h] of e.low) if (x >= x0 && x <= x1) return h;
  return wallH;
}

/** Every run of the closed garden, back wall first, then piers, end walls and the front kerb (paint order). */
export function enclosureRuns(e: EnclosureData, wallZ: number, wallH: number, flatW: number): Run[] {
  const [x0, x1] = e.x;
  const cutsAt = [x0, ...e.low.flatMap(([a, b]) => [a, b]), ...e.door, x1].sort((a, b) => a - b);
  const runs: Run[] = [];
  let flip = 0;
  for (let i = 0; i + 1 < cutsAt.length; i++) {
    const a = cutsAt[i] as number;
    const b = cutsAt[i + 1] as number;
    const h = backHeightAt(e, wallH, (a + b) / 2);
    if (h <= 0 || b - a < 1e-3) continue;
    const n = Math.max(1, Math.round((b - a) / flatW));
    const w = (b - a) / n;
    for (let k = 0; k < n; k++) {
      // The stretch's own ends exactly, so a flat that meets the door gap is never pushed into it by rounding.
      const left = k === 0 ? a : a + k * w;
      const right = k === n - 1 ? b : a + (k + 1) * w;
      const from = left - (left > x0 && left !== e.door[1] ? OVERLAP / 2 : 0);
      const to = right + (right < x1 && right !== e.door[0] ? OVERLAP / 2 : 0);
      runs.push({ x: from, z: wallZ, yaw: (e.flatYaw[flip] ?? 0) * DEG, len: to - from, h, from: 0, pier: false });
      flip = 1 - flip;
    }
  }
  for (const px of e.piers) {
    const h = Math.max(backHeightAt(e, wallH, px - PIER_W), backHeightAt(e, wallH, px + PIER_W));
    runs.push({ x: px - PIER_W / 2, z: wallZ + PIER_PROUD, yaw: 0, len: PIER_W, h, from: 0, pier: true });
  }
  const [d0, d1] = e.door;
  runs.push({ x: d0 - OVERLAP / 2, z: wallZ, yaw: 0, len: d1 - d0 + OVERLAP, h: wallH, from: DOOR_TOP, pier: false });
  runs.push({ x: x0, z: e.front, yaw: 90 * DEG, len: e.front - wallZ, h: e.endH, from: 0, pier: false });
  runs.push({ x: x1, z: wallZ, yaw: -90 * DEG, len: e.front - wallZ, h: e.endH, from: 0, pier: false });
  runs.push({ x: x0, z: e.front, yaw: 0, len: x1 - x0, h: e.kerbH, from: 0, pier: false });
  for (const px of e.x) runs.push({ x: px - PIER_W / 2, z: e.front + PIER_PROUD, yaw: 0, len: PIER_W, h: e.endH, from: 0, pier: true });
  return runs;
}

/** Lays one tile over bands of runs at its real scale; with no batch it only counts the quads (n). */
class RunTiler {
  readonly q: QuadParams;
  private readonly uv = new Float32Array(4);
  private readonly tint = new Float32Array(4);
  private batch: CutoutBatch | null = null;
  private rect: SpriteRect | null = null;
  n = 0;

  constructor() {
    this.tint[3] = 1;
    this.q = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0, py: 0, uv: this.uv, sway: 0, phase: packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.noShadow), lift: 0, facing: 0, tint: this.tint };
  }

  begin(rect: SpriteRect, batch: CutoutBatch | null): void {
    this.rect = rect;
    this.batch = batch;
    this.n = 0;
  }

  tile(r: Run, y0: number, y1: number, overhang: number, proud: number, tint: readonly number[], shade: number): void {
    const rect = this.rect;
    if (rect === null || y1 - y0 < 1e-3) return;
    const [tw, th] = rect.size;
    const ru = rect.uv;
    const du = ((ru[2] - ru[0]) * (1 - 2 * BORDER)) / tw;
    const dv = ((ru[3] - ru[1]) * (1 - 2 * BORDER)) / th;
    const u0 = ru[0] + (ru[2] - ru[0]) * BORDER;
    const v0 = ru[1] + (ru[3] - ru[1]) * BORDER;
    const cos = Math.cos(r.yaw);
    const sin = Math.sin(r.yaw);
    const bx = r.x + sin * proud - cos * overhang;
    const bz = r.z + cos * proud + sin * overhang;
    const ou = (Math.abs(sin) > 0.5 ? r.z : r.x) - overhang - TILE_ORIGIN_X;
    for (let c = 0; c < 3; c++) this.tint[c] = Math.min(1, (tint[c] ?? 1) * shade);
    this.q.facing = r.yaw;
    // Two whole periods keep a band that starts under the ground on positive tile offsets, rows mirrored as before.
    cuts(y1 - y0, y0 + 2 * th, th, (ra, rb, rt, odd) => {
      cuts(r.len + 2 * overhang, ou, tw, (a, b, t0) => {
        if (this.batch !== null) {
          this.q.x = bx + a * cos;
          this.q.z = bz - a * sin;
          this.q.y = y0 + ra;
          this.q.w = b - a;
          this.q.h = rb - ra;
          this.uv[0] = u0 + t0 * du;
          this.uv[2] = u0 + (t0 + b - a) * du;
          this.uv[1] = v0 + (odd ? th - rt : rt) * dv;
          this.uv[3] = v0 + (odd ? th - rt - (rb - ra) : rt + rb - ra) * dv;
          this.batch.writer.set(this.n, this.q);
        }
        this.n++;
      });
    });
  }
}

export interface EnclosureBatches { wall: CutoutBatch; base: CutoutBatch; coping: CutoutBatch }

/** The three enclosure batches (wall stone, base course, coping), or null when a tile is missing from the manifest. */
export function writeEnclosure(runs: readonly Run[], baseH: number, m: AtlasManifest, createBatch: (page: number, capacity: number) => CutoutBatch): EnclosureBatches | null {
  const wallRect = m.sprites[WALL_TILE];
  const baseRect = m.sprites[BASE_TILE];
  const copingRect = m.sprites[COPING_TILE];
  if (wallRect === undefined || baseRect === undefined || copingRect === undefined) return null;
  const t = new RunTiler();
  const pass = (rect: SpriteRect, batch: CutoutBatch | null, each: (r: Run, shade: number) => void): number => {
    t.begin(rect, batch);
    runs.forEach((r, i) => each(r, 1 + SHADE_JITTER * (2 * hash01(i, 0x71) - 1)));
    if (batch !== null) {
      batch.writer.count = t.n;
      batch.writer.commit(0, t.n);
    }
    return t.n;
  };
  const stone = (r: Run, shade: number): void => t.tile(r, Math.max(r.from, Math.min(baseH - BASE.under, r.h)), r.h, 0, 0, STONE_TINT, shade);
  const foot = (r: Run, shade: number): void => {
    if (r.from === 0) t.tile(r, -BASE.sink, Math.min(baseH, r.h), 0, r.pier ? 0 : BASE.proud, BASE.tint, shade);
  };
  const band = (r: Run, y: number, shade: number): void => t.tile(r, y - COPING.h * 0.5, y + COPING.h * 0.5, COPING.overhang, COPING.proud, COPING.tint, shade);
  const cap = (r: Run, shade: number): void => {
    band(r, r.h, shade);
    if (r.from > 0) band(r, r.from, shade);
  };
  const wall = createBatch(wallRect.page, pass(wallRect, null, stone));
  const base = createBatch(baseRect.page, pass(baseRect, null, foot));
  const coping = createBatch(copingRect.page, pass(copingRect, null, cap));
  pass(wallRect, wall, stone);
  pass(baseRect, base, foot);
  pass(copingRect, coping, cap);
  return { wall, base, coping };
}
