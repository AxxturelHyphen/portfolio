// The Rosaleda of cook/ART.md section 2.2 for the gl-look page: 30 cutouts in their value groups (L lit, M mixed 45 %
// toward the place shadow, D mixed 70 % toward it), wall flats behind, grass clumps along the path edges.
import { QUAD_FLAG } from '../../../src/gl/instances.ts';

export interface Placement { sprite: string; x: number; z: number; h: number; yaw: number; tint: number[]; y?: number; sway?: number; flags?: number; lift?: number; flip?: boolean }

const L = [1, 1, 1, 1];
const M = [0.62, 0.58, 0.68, 1];
const D = [0.36, 0.32, 0.44, 1];
const GRASS = [0.5, 0.52, 0.5, 1];

const PATH: [number, number][] = [[5, 1.2], [8, 0.2], [10, -0.6], [13, 0.4], [15, 0.9], [17.4, 1.3]];
function pathZ(x: number): number {
  for (let i = 0; i + 1 < PATH.length; i++) {
    const a = PATH[i], b = PATH[i + 1];
    if (a !== undefined && b !== undefined && x <= b[0]) return a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return 0;
}

const clumps: Placement[] = [];
const CLUMP_X = [6.4, 7.3, 8.4, 9.2, 10.9, 12.2, 13.6, 14.7, 6.9, 9.9, 11.6, 14.1, 15.3];
CLUMP_X.forEach((x, i) => {
  const side = i < 8 ? -0.85 : 0.85;
  clumps.push({ sprite: 'grass', x, z: pathZ(x) + side + (i % 3) * 0.08, h: 0.32 + (i % 4) * 0.06, yaw: (i % 2 ? 6 : -9), tint: GRASS, sway: 0.05, flags: QUAD_FLAG.fullRate, lift: 0.2, flip: i % 2 === 0 });
});

export const PLACEMENTS: Placement[] = [
  { sprite: 'rambler', x: 12.4, z: -5.6, h: 2.4, yaw: -10, tint: M, sway: 0.01 },
  { sprite: 'cane', x: 10.3, z: -5.7, h: 1.6, yaw: 8, tint: D, flip: true },
  { sprite: 'thorn', x: 8.0, z: -5.7, h: 2.2, yaw: 12, tint: D, flags: QUAD_FLAG.noLean },
  { sprite: 'ivy', x: 9.1, z: -5.85, h: 1.3, yaw: 12, tint: D, flags: QUAD_FLAG.noLean, sway: 0.008 },
  { sprite: 'ivy', x: 14.0, z: -5.85, h: 1.1, yaw: -12, tint: D, flags: QUAD_FLAG.noLean, flip: true, sway: 0.008 },
  { sprite: 'pompon', x: 8.0, z: -3.6, h: 1.3, yaw: 10, tint: M },
  { sprite: 'damask', x: 11.0, z: -4.4, h: 1.6, yaw: -6, tint: M },
  { sprite: 'gallica', x: 12.7, z: -3.8, h: 1.5, yaw: -12, tint: D },
  { sprite: 'buttercup', x: 14.6, z: -3.0, h: 0.8, yaw: 4, tint: D },
  { sprite: 'poppy', x: 15.6, z: -1.9, h: 1.0, yaw: -8, tint: D },
  { sprite: 'roseB', x: 8.7, z: -2.2, h: 1.3, yaw: 7, tint: M },
  { sprite: 'hero', x: 11.6, z: -1.5, h: 2.1, yaw: -4, tint: L, lift: 0.8 },
  { sprite: 'buttercup', x: 6.2, z: -1.4, h: 0.8, yaw: 9, tint: D, flip: true },
  { sprite: 'poppy', x: 13.3, z: -2.0, h: 0.9, yaw: 5, tint: M, flip: true },
  { sprite: 'thorn', x: 8.9, z: 1.6, h: 1.5, yaw: 0, tint: [0.22, 0.2, 0.3, 1], flags: QUAD_FLAG.noShadow },
  { sprite: 'ivy', x: 12.6, z: 1.7, h: 1.2, yaw: 0, tint: [0.22, 0.2, 0.3, 1], flags: QUAD_FLAG.noShadow, flip: true },
  { sprite: 'cane', x: 16.4, z: -2.4, h: 1.5, yaw: -5, tint: D },
  ...clumps,
];

/** Wall flats 2.4 m wide at z -6 (toy theatre flats alternately yawed -5 and +4 degrees), mixed toward #261e3d. */
export const WALL = [1.2, 3.6, 6.0, 8.4, 10.8, 13.2, 15.6, 18.0, 20.4].map((x, i) => ({
  x, z: -6 + (i % 2) * 0.08, h: 2.3, yaw: ((i % 2 ? 4 : -5) * Math.PI) / 180,
  uv: [(i % 5) * 0.17, 0.1 + (i % 2) * 0.3, (i % 5) * 0.17 + 0.3, 0.38 + (i % 2) * 0.3], tint: [0.34, 0.31, 0.42, 1],
}));
