/**
 * Ground layout (cook/ART.md section 1, Path and Puddles): the path spline through (x, z) knots and the puddle centres,
 * plus the CPU bake of the path distance field the ground shader reads. Load time only.
 */
export interface GroundLayout {
  /** World rectangle of the ground plane: x from x0 to x1, z from z0 (far) to z1 (near). */
  x0: number; x1: number; z0: number; z1: number;
  /** World z of the wall foot (content/garden.json ground.wall.z): the ground darkens toward it and mists past it. */
  wallZ: number;
  /** Catmull-Rom knots as x, z pairs. */
  path: readonly number[];
  /** Puddle centres as x, z pairs (at most MAX_PUDDLES). */
  puddles: readonly number[];
}

export const MAX_PUDDLES = 12;

export const ART_LAYOUT: GroundLayout = {
  x0: -8, x1: 56, z0: -16, z1: 12, wallZ: -6,
  path: [
    -0.2, -4.6, 0.2, -2, 2, 0.6, 5, 1.2, 8, 0.2, 10, -0.6, 13, 0.4, 15, 0.9, 17.4, 1.3, 20.8, 1.2, 23.6, 1.0, 26, 0,
    28.5, -0.9, 30.3, -1.9, 32.2, -3.0, 33.5, -4.2, 35, -2.4, 36.5, -0.4, 39.5, 0.8, 42, 0.2, 44.2, -2.4, 45.2, -6,
  ],
  puddles: [0.9, -1.0, 5.6, 1.1, 9.4, -0.5, 10.2, 0.1, 15.8, 0.9, 29.2, -1.3, 37.2, 0.2, 41.2, 0.5, 43.2, -1.2],
};

/** Distance field resolution and range: 1 texel per TEXEL_M metres, distances stored in 1 cm steps up to 2.55 m. */
const TEXEL_M = 0.08;
const RANGE_M = 2.55;
const SAMPLES_PER_SPAN = 12;

export interface PathField { data: Uint8Array; w: number; h: number }

/** Uniform Catmull-Rom point on the span p1..p2 at t (0..1), written into out[0], out[1]. */
function catmull(k: readonly number[], i: number, t: number, out: Float64Array): void {
  const n = k.length / 2;
  const at = (j: number, c: number): number => k[Math.min(n - 1, Math.max(0, j)) * 2 + c] ?? 0;
  const t2 = t * t;
  const t3 = t2 * t;
  for (let c = 0; c < 2; c++) {
    const p0 = at(i - 1, c);
    const p1 = at(i, c);
    const p2 = at(i + 1, c);
    const p3 = at(i + 2, c);
    out[c] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
}

/**
 * Bakes the unsigned distance to the path centre line over the layout rectangle (R8, 1 cm per level).
 * Each polyline segment only touches texels within RANGE_M of it, and the inner loop compares squared distances (one
 * square root per texel at the end), so the bake stays a few milliseconds even on a throttled phone CPU.
 */
export function bakePathField(l: GroundLayout): PathField {
  const w = Math.ceil((l.x1 - l.x0) / TEXEL_M);
  const h = Math.ceil((l.z1 - l.z0) / TEXEL_M);
  const dist2 = new Float64Array(w * h).fill(RANGE_M * RANGE_M);
  const pts: number[] = [];
  const p = new Float64Array(2);
  const spans = l.path.length / 2 - 1;
  for (let i = 0; i < spans; i++) {
    for (let s = 0; s < SAMPLES_PER_SPAN; s++) {
      catmull(l.path, i, s / SAMPLES_PER_SPAN, p);
      pts.push(p[0] ?? 0, p[1] ?? 0);
    }
  }
  pts.push(l.path[l.path.length - 2] ?? 0, l.path[l.path.length - 1] ?? 0);
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i] ?? 0, az = pts[i + 1] ?? 0, bx = pts[i + 2] ?? 0, bz = pts[i + 3] ?? 0;
    const ex = bx - ax, ez = bz - az;
    const len2 = Math.max(ex * ex + ez * ez, 1e-9);
    const tx0 = Math.max(0, Math.floor((Math.min(ax, bx) - RANGE_M - l.x0) / TEXEL_M));
    const tx1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + RANGE_M - l.x0) / TEXEL_M));
    const tz0 = Math.max(0, Math.floor((Math.min(az, bz) - RANGE_M - l.z0) / TEXEL_M));
    const tz1 = Math.min(h - 1, Math.ceil((Math.max(az, bz) + RANGE_M - l.z0) / TEXEL_M));
    for (let tz = tz0; tz <= tz1; tz++) {
      const dz = l.z0 + (tz + 0.5) * TEXEL_M - az;
      const row = tz * w;
      for (let tx = tx0; tx <= tx1; tx++) {
        const dx = l.x0 + (tx + 0.5) * TEXEL_M - ax;
        const t = Math.min(1, Math.max(0, (dx * ex + dz * ez) / len2));
        const qx = dx - ex * t;
        const qz = dz - ez * t;
        const d2 = qx * qx + qz * qz;
        if (d2 < (dist2[row + tx] ?? 0)) dist2[row + tx] = d2;
      }
    }
  }
  const data = new Uint8Array(w * h);
  const toLevel = 255 / RANGE_M;
  for (let i = 0; i < data.length; i++) data[i] = Math.round(Math.fround(Math.sqrt(dist2[i] ?? 0)) * toLevel);
  return { data, w, h };
}

export const PATH_RANGE_M = RANGE_M;
