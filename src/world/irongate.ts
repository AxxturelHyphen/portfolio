import { terrainY } from '../core/terrain.ts';
import type { GateGeometry } from '../gl/irongate.ts';

/**
 * La Salida's wrought-iron gate, forged in code for the doorway in the back wall (enclosure.ts): two leaves on hinge
 * pins at the jambs, square stiles and pickets ending in spears, and flat bar rails under an arched top rail. Every
 * piece is one bar swept along a path in the leaf's plane, square or flat in section; the shader shades it per face.
 * The vertices are the shut gate in world space; the leaf id tells the shader which pin a vertex turns about (-1 the
 * left leaf, 1 the right). Load time only.
 */

/** Pin to jamb, the gap where the leaves meet, and how far the pins stand inside the opening from the wall face (m). */
const GAP = 0.03;
const MEET = 0.012;
const PIN_IN = 0.08;
/** Bar sections (m): stiles, pickets and rails (height, depth). */
const STILE = 0.03;
const PICKET = 0.016;
const RAIL = [0.03, 0.014] as const;
/** Heights (m over the threshold): the straight rails, the arch at the pin and its rise to the middle. */
const RAILS = [0.1, 0.32, 1.2] as const;
const ARCH = [1.44, 0.18] as const;
const PICKETS = 5;
/** Every upright passes the arch by SPEAR[0] and ends in a spear SPEAR[1] tall and SPEAR[2] wider than its bar. */
const SPEAR = [0.09, 0.1, 0.024] as const;
const SPEAR_TAPER = [0.45, 1, 0.05] as const;
/** Corner signs (across the path, through the leaf) round a bar's section, in order. */
const CORNER = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const;

/** The gate for the door gap [d0, d1] in the back wall at `wallZ`, standing on the ground there. */
export function ironGateOf([d0, d1]: readonly [number, number], wallZ: number): GateGeometry {
  const z = wallZ - PIN_IN;
  const y = terrainY((d0 + d1) / 2, z);
  const hinge: [number, number, number] = [d0 + GAP, d1 - GAP, z];
  const w = (d1 - d0) / 2 - GAP - MEET / 2;
  const bay = (w - 2 * STILE) / (PICKETS + 1);
  const pos: number[] = [];
  const leaf: number[] = [];
  const idx: number[] = [];
  let x = 0;
  let sgn = 1;

  /** Sweeps a bar `bw` across and `d` deep along the (u, v) points, its section scaled by `taper` at each point. */
  const bar = (pts: readonly number[], bw: number, d: number, taper?: readonly number[]): void => {
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1) * 2;
      const b = Math.min(n - 1, i + 1) * 2;
      const s = (taper?.[i] ?? 1) / 2;
      const l = Math.hypot(pts[b]! - pts[a]!, pts[b + 1]! - pts[a + 1]!) / bw / s;
      const o = leaf.length;
      for (const [c, k] of CORNER) {
        pos.push(x + sgn * (pts[i * 2]! + (c * (pts[a + 1]! - pts[b + 1]!)) / l), y + pts[i * 2 + 1]! + (c * (pts[b]! - pts[a]!)) / l, z + k * d * s);
        leaf.push(-sgn);
      }
      for (let f = 0; i > 0 && f < 4; f++) {
        const g = (f + 1) % 4;
        idx.push(o - 4 + f, o - 4 + g, o + g, o - 4 + f, o + g, o + f);
      }
    }
  };
  const arch = (u: number): number => ARCH[0] + ARCH[1] * Math.sin((Math.PI / 2) * Math.min(1, u / w));
  /** A vertical bar from `v0` past the arch, ending in a spear. */
  const upright = (u: number, v0: number, size: number): void => {
    const head = arch(u) + SPEAR[0];
    bar([u, v0, u, head], size, size);
    bar([u, head, u, head + SPEAR[1] * 0.35, u, head + SPEAR[1]], size + SPEAR[2], size, SPEAR_TAPER);
  };

  for (const side of [1, -1]) {
    x = side > 0 ? hinge[0] : hinge[1];
    sgn = side;
    upright(STILE / 2, 0, STILE);
    upright(w - STILE / 2, 0, STILE);
    for (const v of RAILS) bar([STILE, v, w - STILE, v], RAIL[0], RAIL[1]);
    const arc: number[] = [];
    for (let i = 0; i <= 12; i++) {
      const u = STILE + ((w - 2 * STILE) * i) / 12;
      arc.push(u, arch(u));
    }
    bar(arc, RAIL[0], RAIL[1]);
    for (let k = 1; k <= PICKETS; k++) upright(STILE + bay * k, RAILS[0], PICKET);
  }
  return { position: new Float32Array(pos), leaf: new Float32Array(leaf), index: new Uint32Array(idx), hinge };
}
