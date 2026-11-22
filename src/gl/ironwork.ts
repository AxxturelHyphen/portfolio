import { BoxGeometry, CatmullRomCurve3, ConeGeometry, CylinderGeometry, Matrix4, Quaternion, TubeGeometry, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { terrainY } from '../core/terrain.ts';
import type { GateSpot, TrellisSpot } from '../world/props.solid.ts';
import type { SolidBuilder } from './masonry.ts';

/**
 * The Puerta's two gilt gate leaves and the Rosaleda's ladder obelisk as merged geometry (world/props.solid.ts says
 * where they stand), in place of their cards. A leaf is a frame of square stiles and flat rails, round pickets ending in
 * spears through a curved crest rail rising to the hinge side, and its cast scrollwork drawn as tubes swept along
 * spirals: two C-scrolls in the lower panel and two small ones under the crest. The obelisk is four square legs leaning
 * in to a capped top, laddered with rungs on every face. Every piece is placed by its end points in the piece's own
 * frame (no mirrored matrix, so no face turns inside out). Load time only.
 */

/**
 * Leaf proportions of its height (the card's 338 by 800 plate): width, the crest rail's height at the meeting edge and
 * its rise to the hinge, the foot, panel and middle rails; sections (m): stile, rail (tall, deep), picket, crest and
 * scroll tubes, the spear (radius, length) and how far a picket passes the crest (share of the height); `pivot` is where
 * across its width each card stood on its point (the plates' pivots), so the leaf stands where its card stood.
 */
const GATE = {
  aspect: 0.42, crest: [0.74, 0.14], foot: 0.03, panel: 0.31, mid: 0.66, pickets: 7,
  stile: 0.034, rail: [0.03, 0.016], picket: 0.009, crestTube: 0.012, scroll: 0.008, spear: [0.02, 0.07], past: 0.05,
  pivot: { left: 0.61, right: 0.42 },
} as const;
/** Obelisk sizes (m): its top's half width and depth, the cap, the legs and rungs, and the rung spacing on its faces. */
const TRELLIS = { top: [0.05, 0.035], cap: 0.12, leg: 0.045, rung: 0.022, step: 0.15, sideStep: 0.3, height: 0.95 } as const;

const UP = new Vector3(0, 1, 0);
const a = new Vector3();
const c = new Vector3();
const dir = new Vector3();
const mid = new Vector3();
const q = new Quaternion();
const scale = new Vector3();
const local = new Matrix4();
const world = new Matrix4();

interface Parts { box: BoxGeometry; rod: CylinderGeometry; cone: ConeGeometry }

/** A unit piece stretched from `from` to `to` in the frame (w across, d through; a rod's or cone's radii), into the builder. */
function span(b: SolidBuilder, g: BufferGeometry, frame: Matrix4, from: Vector3, to: Vector3, w: number, d: number): void {
  dir.subVectors(to, from);
  const len = dir.length();
  q.setFromUnitVectors(UP, dir.divideScalar(len));
  local.compose(mid.addVectors(from, to).multiplyScalar(0.5), q, scale.set(w, len, d));
  b.merge(g, world.multiplyMatrices(frame, local));
}

/** A tube of radius r through the points (x, y pairs in the frame's plane). */
function tube(b: SolidBuilder, frame: Matrix4, pts: readonly number[], r: number): void {
  const curve = new CatmullRomCurve3(Array.from({ length: pts.length / 2 }, (_, i) => new Vector3(pts[i * 2], pts[i * 2 + 1], 0)));
  const g = new TubeGeometry(curve, (pts.length / 2) * 2, r, 5, false);
  b.merge(g, frame);
  g.dispose();
}

/** A spiral about (cu, cv) from radius R inward over `turns`, starting at angle a0 and turning `turn` (+1 or -1) ways. */
function spiral(cu: number, cv: number, R: number, a0: number, turn: number, turns: number): number[] {
  const pts: number[] = [];
  const n = Math.ceil(turns * 12);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = a0 + turn * t * turns * Math.PI * 2;
    const r = R * (1 - 0.72 * t);
    pts.push(cu + r * Math.cos(ang), cv + r * Math.sin(ang));
  }
  return pts;
}

function gateLeaf(b: SolidBuilder, s: GateSpot, p: Parts): void {
  const G = GATE;
  const H = s.h;
  const half = (H * G.aspect) / 2;
  const frame = new Matrix4().makeRotationY(s.yaw).setPosition(s.x, s.y + terrainY(s.x, s.z), s.z);
  // t runs from the meeting edge (-half) to the hinge edge (+half); u lays it out on the leaf about its card's pivot.
  const shift = (0.5 - (s.side < 0 ? G.pivot.left : G.pivot.right)) * 2 * half;
  const u = (t: number): number => shift + s.side * t;
  const crestAt = (t: number): number => H * (G.crest[0] + G.crest[1] * ((t + half) / (2 * half)) ** 2);
  const inner = half - G.stile / 2;
  for (const t of [-inner, inner]) span(b, p.box, frame, a.set(u(t), 0, 0), c.set(u(t), crestAt(t) + H * (t > 0 ? 0.08 : 0.03), 0), G.stile, G.stile);
  for (const v of [G.foot, G.panel, G.mid]) span(b, p.box, frame, a.set(u(-inner), H * v, 0), c.set(u(inner), H * v, 0), G.rail[0], G.rail[1]);
  const crest: number[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = -inner + (2 * inner * i) / 10;
    crest.push(u(t), crestAt(t));
  }
  tube(b, frame, crest, G.crestTube);
  for (let k = 1; k <= G.pickets; k++) {
    const t = -inner + (2 * inner * k) / (G.pickets + 1);
    const top = crestAt(t) + H * G.past;
    span(b, p.rod, frame, a.set(u(t), H * G.panel, 0), c.set(u(t), top, 0), G.picket, G.picket);
    span(b, p.cone, frame, a.set(u(t), top, 0), c.set(u(t), top + G.spear[1], 0), G.spear[0], G.spear[0]);
  }
  // The lower panel's two C-scrolls curl toward each other from the panel rail; two small ones hang under the crest.
  const lowV = (H * (G.foot + G.panel)) / 2;
  const R = Math.min(half / 2, (H * (G.panel - G.foot)) / 2) * 0.85;
  for (const side of [-1, 1]) {
    const at = u((side * half) / 2);
    tube(b, frame, spiral(at, lowV, R, Math.PI / 2, -side * s.side, 1.6), G.scroll);
  }
  for (const t of [half * 0.15, half * 0.6]) tube(b, frame, spiral(u(t), crestAt(t) - H * 0.045, H * 0.03, Math.PI / 2, s.side, 1.4), G.scroll);
}

function trellis(b: SolidBuilder, s: TrellisSpot, p: Parts): void {
  const T = TRELLIS;
  const H = s.h * T.height;
  const frame = new Matrix4().makeRotationY(s.yaw).setPosition(s.x, s.y + terrainY(s.x, s.z), s.z);
  const bx = s.w / 2 - T.leg;
  const bz = s.d / 2 - T.leg;
  const hx = (v: number): number => bx + ((T.top[0] - bx) * v) / H;
  const hz = (v: number): number => bz + ((T.top[1] - bz) * v) / H;
  for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) span(b, p.box, frame, a.set(i * bx, 0, j * bz), c.set(i * T.top[0], H, j * T.top[1]), T.leg, T.leg);
  let n = 0;
  for (let v = T.step; v < H - T.step / 2; v += T.step, n++) {
    for (const j of [-1, 1]) span(b, p.box, frame, a.set(-hx(v), v, j * hz(v)), c.set(hx(v), v, j * hz(v)), T.rung, T.rung);
    if (n % Math.round(T.sideStep / T.step) !== 0) continue;
    for (const i of [-1, 1]) span(b, p.box, frame, a.set(i * hx(v), v, -hz(v)), c.set(i * hx(v), v, hz(v)), T.rung, T.rung);
  }
  span(b, p.cone, frame, a.set(0, H, 0), c.set(0, H + T.cap, 0), T.top[0] * 2.2, T.top[0] * 2.2);
}

/** Every gate leaf into `gilt` and every obelisk into `painted`. */
export function buildIronwork(gates: readonly GateSpot[], trellises: readonly TrellisSpot[], gilt: SolidBuilder, painted: SolidBuilder): void {
  if (gates.length === 0 && trellises.length === 0) return;
  // Unit pieces centred on their axis, one metre along y; span() stretches them between two points.
  const p: Parts = { box: new BoxGeometry(1, 1, 1), rod: new CylinderGeometry(1, 1, 1, 6, 1, true), cone: new ConeGeometry(1, 1, 6) };
  for (const s of gates) gateLeaf(gilt, s, p);
  for (const s of trellises) trellis(painted, s, p);
  for (const g of Object.values(p)) g.dispose();
}
