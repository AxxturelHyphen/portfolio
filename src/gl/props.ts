import { ConeGeometry, LatheGeometry, Matrix4, TorusGeometry, Vector2 } from 'three';
import type { BufferGeometry } from 'three';
import { terrainY } from '../core/terrain.ts';
import type { BenchSpot, PropSpot, SolidProps } from '../world/props.solid.ts';
import { BENCH_SEAT } from '../world/props.solid.ts';
import { hash01 } from '../world/wall.ts';
import { buildIronwork } from './ironwork.ts';
import { SolidBuilder } from './masonry.ts';
import type { SolidPaint } from './solid.paint.ts';

/**
 * Free roam's solid props as merged geometry, one builder per material (world/props.solid.ts says where they stand):
 * each standing lantern a turned iron foot under a square housing (base and top plates, four corner bars, a bar across
 * each face, four panes of warm glass, a pyramid cap and a ring), the pot a turned terracotta pot with its soil, the
 * bench a seat of two planks on four legs with aprons and stretchers. Lantern parts scale with the card's height they
 * replace, so the flame (world/lamps.ts, at LAMPS.flameOfHeight) stays inside the glass. Load time only.
 */

export type PropKind = 'iron' | 'glass' | 'clay' | 'wood' | 'gilt' | 'painted';
export type PropBuilders = Record<PropKind, SolidBuilder>;

/**
 * Each kind's tile of the shared atlas and tint (gl/solid.material.ts): blackened iron, the glass warm with a light of
 * its own matching the lantern cards' lit panes, red-brown fired clay, weathered brown painted wood, the Puerta gates'
 * old gilt iron and the obelisk's ink-blue painted timber (gl/ironwork.ts).
 */
export const PROP_LOOK: Readonly<Record<PropKind, SolidPaint>> = {
  iron: { tile: 'tile/rim', tint: [0.4, 0.37, 0.35] },
  glass: { tile: 'tile/paper', tint: [1, 0.82, 0.55], glow: [0.5, 0.28, 0.09] },
  clay: { tile: 'tile/paper', tint: [0.8, 0.45, 0.32] },
  wood: { tile: 'tile/paper', tint: [0.52, 0.4, 0.3] },
  gilt: { tile: 'tile/rim', tint: [0.66, 0.53, 0.3] },
  painted: { tile: 'tile/paper', tint: [0.2, 0.22, 0.28] },
};

/** One builder per kind, each holding its paint. */
export function propBuilders(): PropBuilders {
  const kinds = Object.keys(PROP_LOOK) as PropKind[];
  return Object.fromEntries(kinds.map((k) => [k, new SolidBuilder().paint(PROP_LOOK[k])])) as PropBuilders;
}

/** Lantern sizes (m) for a card 0.45 m tall: foot top, housing side and top, plate, bar and pane thickness, cap and ring. */
const LANTERN = { ref: 0.45, foot: 0.135, side: 0.16, top: 0.36, plate: 0.014, bar: 0.016, cross: 0.008, pane: 0.004, cap: 0.07, ring: [0.022, 0.005] } as const;
/** The turned foot's profile (radius, height), bottom to top, for the 0.45 m lantern. */
const FOOT = [[0, 0], [0.068, 0], [0.07, 0.012], [0.05, 0.024], [0.026, 0.04], [0.018, 0.07], [0.02, 0.1], [0.03, 0.115], [0.042, 0.13], [0, 0.135]] as const;
/** The pot's profile (radius, height) up the outside, over the rim and down the inside to the soil, for a 0.45 m card. */
const POT = { ref: 0.45, segments: 24, profile: [[0, 0], [0.135, 0], [0.142, 0.01], [0.188, 0.31], [0.205, 0.315], [0.21, 0.33], [0.21, 0.41], [0.2, 0.42], [0.185, 0.415], [0.178, 0.37], [0, 0.37]] } as const;
/** Bench sizes (m): seat thickness and depth, the gap between its two planks, legs, aprons, stretchers, inset of the legs. */
const BENCH = { seat: 0.045, depth: 0.34, gap: 0.01, leg: 0.05, apron: [0.06, 0.025], stretcher: 0.035, legIn: [0.12, 0.12], sink: 0.03 } as const;

const m = new Matrix4();
const turn = new Matrix4();

function lathe(profile: readonly (readonly [number, number])[], k: number, segments: number): LatheGeometry {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r * k, y * k)), segments);
}

/** A geometry placed at (x, y, z) turned by yaw about y, into the builder. */
function place(b: SolidBuilder, g: BufferGeometry, x: number, y: number, z: number, yaw: number): void {
  b.merge(g, m.makeRotationY(yaw).setPosition(x, y, z));
}

/** A box w by h by d whose bottom is centred at the local offset (u, v) from (x, z), all turned by yaw. */
function boxAt(b: SolidBuilder, s: PropSpot, base: number, u: number, v: number, y: number, w: number, h: number, d: number): void {
  const cos = Math.cos(s.yaw);
  const sin = Math.sin(s.yaw);
  b.box(s.x + u * cos + v * sin, base + y, s.z - u * sin + v * cos, w, h, d, s.yaw);
}

function lantern(p: PropBuilders, s: PropSpot, foot: BufferGeometry, cap: BufferGeometry, ring: BufferGeometry): void {
  const k = s.h / LANTERN.ref;
  const base = s.y + terrainY(s.x, s.z);
  const L = LANTERN;
  const side = L.side * k;
  const half = side / 2;
  const plate = L.plate * k;
  const tall = (L.top - L.foot) * k;
  const y0 = L.foot * k;
  place(p.iron, foot, s.x, base, s.z, s.yaw);
  boxAt(p.iron, s, base, 0, 0, y0, side + 2 * plate, plate, side + 2 * plate);
  boxAt(p.iron, s, base, 0, 0, y0 + tall - plate, side + 2 * plate, plate, side + 2 * plate);
  const bar = L.bar * k;
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) boxAt(p.iron, s, base, u * (half - bar / 2), v * (half - bar / 2), y0, bar, tall, bar);
  const cross = L.cross * k;
  const pane = L.pane * k;
  const glassH = tall - 2 * plate;
  const midY = y0 + tall * 0.55;
  for (const [u, v, across] of [[0, 1, true], [0, -1, true], [1, 0, false], [-1, 0, false]] as const) {
    const w = across ? side - 2 * bar : pane;
    const d = across ? pane : side - 2 * bar;
    boxAt(p.glass, s, base, u * (half - bar / 2), v * (half - bar / 2), y0 + plate, w, glassH, d);
    boxAt(p.iron, s, base, u * (half + cross / 2), v * (half + cross / 2), midY, across ? side : cross, cross, across ? cross : side);
  }
  place(p.iron, cap, s.x, base + y0 + tall, s.z, s.yaw);
  place(p.iron, ring, s.x, base + y0 + tall + L.cap * k + L.ring[0] * k, s.z, s.yaw);
}

function bench(p: PropBuilders, b: BenchSpot, n: number): void {
  const B = BENCH;
  const cx = (b.x0 + b.x1) / 2;
  const len = b.x1 - b.x0;
  const ground = Math.min(terrainY(b.x0, b.z - B.depth / 2), terrainY(b.x1, b.z - B.depth / 2), terrainY(b.x0, b.z + B.depth / 2), terrainY(b.x1, b.z + B.depth / 2));
  const seatY = ground + BENCH_SEAT - B.seat;
  const plank = (B.depth - B.gap) / 2;
  for (const side of [-1, 1]) {
    const lift = 0.004 * (hash01(n * 2 + side, 0x3d) - 0.5);
    p.wood.box(cx, seatY + lift, b.z + side * (plank + B.gap) / 2, len, B.seat, plank, 0.004 * side);
  }
  const legH = BENCH_SEAT - B.seat + B.sink;
  const lx = len / 2 - B.legIn[0];
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const w = B.leg * (0.92 + 0.16 * hash01(n * 4 + u + 2 * v, 0x2f));
    p.wood.box(cx + u * lx, ground - B.sink, b.z + v * B.legIn[1], w, legH, w, 0.03 * u * v);
  }
  for (const v of [-1, 1]) p.wood.box(cx, seatY - B.apron[0], b.z + v * (B.legIn[1] + B.leg / 2 - B.apron[1] / 2), 2 * lx, B.apron[0], B.apron[1], 0);
  for (const u of [-1, 1]) p.wood.box(cx + u * lx, ground + 0.12, b.z, B.stretcher, B.stretcher, 2 * B.legIn[1], 0);
}

/** Every solid prop into its material's builder. */
export function buildProps(props: SolidProps, p: PropBuilders): void {
  for (const s of props.lanterns) {
    const k = s.h / LANTERN.ref;
    const foot = lathe(FOOT, k, 10);
    // A four-sided cone turned an eighth fits the square housing; flat faces need their own normals.
    const cap = new ConeGeometry(((LANTERN.side + 2 * LANTERN.plate) * k) / Math.SQRT2, LANTERN.cap * k, 4, 1).toNonIndexed();
    cap.applyMatrix4(turn.makeRotationY(Math.PI / 4).setPosition(0, (LANTERN.cap * k) / 2, 0));
    cap.computeVertexNormals();
    const ring = new TorusGeometry(LANTERN.ring[0] * k, LANTERN.ring[1] * k, 5, 12);
    lantern(p, s, foot, cap, ring);
    for (const g of [foot, cap, ring]) g.dispose();
  }
  for (const s of props.pots) {
    const g = lathe(POT.profile, s.h / POT.ref, POT.segments);
    place(p.clay, g, s.x, s.y + terrainY(s.x, s.z), s.z, s.yaw);
    g.dispose();
  }
  props.benches.forEach((b, n) => bench(p, b, n));
  buildIronwork(props.gates, props.trellises, p.gilt, p.painted);
}
