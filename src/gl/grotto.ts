import { ConeGeometry, IcosahedronGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { terrainY } from '../core/terrain.ts';
import { rng } from '../world/groundplan.ts';
import { DOME, GROTTO, grottoRocks, type Rock } from '../world/grotto.ts';
import type { SolidBuilder } from './masonry.ts';
import type { SolidPaint } from './solid.paint.ts';

/**
 * The grotto chamber as faceted rock (world/grotto.ts lays it out): the dome's inner shell, the floor running on from
 * the lawn at the terrain's height with a hollow for the puddle and rising into the dome's foot, and the boulders and
 * stalactites, all on the shared lit solid material, so the carried lantern's pool lights them. Flat shaded: every
 * triangle carries its own face normal. The shell and the floor go into the builder that paints before the beds' cards
 * (they lie behind everything in the chamber and the cards' contact shadows lie on the floor); the rocks into the one
 * that paints after the cards, depth tested, so they stand among them. Load time only; the low tier builds the same room
 * with fewer facets.
 */

/**
 * Damp stone in the night's violet blue, the floor a shade darker, a little moss only where the floor rises into the
 * dome's foot: the warm lantern pool lights the chamber, not the moon. The rock is the garden wall's stone laid large
 * (rock: times the tile's size) with the hand-made marks of solid.frag.glsl ROCK; the floor a calm sandstone, laid large.
 */
const ROCK: SolidPaint = { tile: 'tile/wall', tint: [0.46, 0.5, 0.78], rock: 1.7 };
const FLOOR: SolidPaint = { tile: 'tile/coping', tint: [0.24, 0.29, 0.54], rock: 1.4 };
const MOSS: SolidPaint = { tile: 'tile/moss', tint: [0.3, 0.34, 0.48], rock: 1.5 };
/** The floor turns to moss where it has risen this share of the way into the dome's foot. */
const MOSS_FROM = 0.35;
/** Facets per tier: the dome's azimuth and elevation steps, the floor's grid, the rocks' subdivision. */
const DETAIL = { high: { az: 24, el: 8, floor: 26, rock: 1 }, low: { az: 14, el: 5, floor: 12, rock: 0 } } as const;
/** The floor stands this far over the terrain so the closed ground under it never shows through. */
const FLOOR_LIFT = 0.012;
/** How far the dome's facets push out (never in, so the chamber only grows) and the hollow's depth (m). */
const BULGE = 0.34;
const HOLLOW = 0.035;
/**
 * The shell's lowest ring (m): just under the floor's top, never deeper, since the closed ground draws no depth there and
 * a shell edge under it would show through the lawn below the wall.
 */
const SHELL_FOOT = 0.06;

const n = new Vector3();
const e = new Vector3();

/** One flat triangle p q r (counter-clockwise seen from the side it faces). */
function facet(out: SolidBuilder, p: Vector3, q: Vector3, r: Vector3): void {
  n.subVectors(q, p).cross(e.subVectors(r, p)).normalize();
  const i = out.vertex(p.x, p.y, p.z, n.x, n.y, n.z);
  out.vertex(q.x, q.y, q.z, n.x, n.y, n.z);
  out.vertex(r.x, r.y, r.z, n.x, n.y, n.z);
  out.triangle(i, i + 1, i + 2);
}

/** The dome's grid point at azimuth step i and elevation step j, pushed out by its own bulge, squashed onto `front`. */
function domePoint(i: number, j: number, az: number, el: number, bulge: Float32Array, out: Vector3): Vector3 {
  const phi = (i / az) * Math.PI * 2;
  const lo = Math.asin((SHELL_FOOT - DOME.y) / DOME.ry);
  const theta = lo + (j / el) * (Math.PI / 2 - lo);
  const k = 1 + (j === el ? 0 : bulge[(i % az) * (el + 1) + j]!);
  out.set(DOME.x + DOME.rx * k * Math.cos(theta) * Math.sin(phi), DOME.y + DOME.ry * Math.sin(theta) * (j === el ? 1 : k), DOME.z + DOME.rz * k * Math.cos(theta) * Math.cos(phi));
  out.z = Math.min(out.z, DOME.front);
  return out;
}

/** The dome's inner shell: faces toward its centre, those wholly on the front plane (inside the wall) left out. */
function dome(out: SolidBuilder, az: number, el: number): void {
  const rand = rng(23);
  const bulge = new Float32Array(az * (el + 1)).map(() => rand() * BULGE / DOME.rx);
  const p = new Vector3();
  const q = new Vector3();
  const r = new Vector3();
  const s = new Vector3();
  for (let i = 0; i < az; i++) {
    for (let j = 0; j < el; j++) {
      domePoint(i, j, az, el, bulge, p);
      domePoint(i + 1, j, az, el, bulge, q);
      domePoint(i + 1, j + 1, az, el, bulge, r);
      domePoint(i, j + 1, az, el, bulge, s);
      const buried = (v: Vector3): boolean => v.z >= DOME.front;
      if (!(buried(p) && buried(r) && buried(s))) facet(out, p, s, r);
      if (!(buried(p) && buried(q) && buried(r))) facet(out, p, r, q);
    }
  }
}

/** How far (x, z) has risen into the dome's foot, 0 on the open floor to 1 at the wall. */
function footOf(x: number, z: number): number {
  const u = (x - DOME.x) / DOME.rx;
  const w = (z - DOME.z) / DOME.rz;
  return Math.min(1, Math.max(0, (Math.sqrt(u * u + w * w) - 0.8) / 0.25));
}

/** The floor's height at (x, z): the terrain, rising into the dome's foot, dipping into the puddle's hollow. */
function floorY(x: number, z: number, jitter: number): number {
  const t = footOf(x, z);
  const p = GROTTO.puddle;
  const d = Math.hypot(x - p.x, (z - p.z) * 1.25) / p.r;
  const hollow = d < 1.4 ? HOLLOW * (1 - Math.min(1, d) ** 2) : 0;
  return terrainY(x, z) + FLOOR_LIFT + t * t * (0.16 + jitter * 0.08) + jitter * 0.012 * t - hollow;
}

/** The floor's facets: stone on the open floor, moss at the dome's foot. */
function floor(out: SolidBuilder, cells: number): void {
  const f = GROTTO.floor;
  const nx = cells;
  const nz = Math.round((cells * (f.z1 - f.z0)) / (f.x1 - f.x0));
  const rand = rng(31);
  const jit = new Float32Array((nx + 1) * (nz + 1)).map(() => rand());
  const at = (i: number, j: number, v: Vector3): Vector3 => {
    const x = f.x0 + ((f.x1 - f.x0) * i) / nx;
    const z = f.z0 + ((f.z1 - f.z0) * j) / nz;
    return v.set(x, floorY(x, z, jit[j * (nx + 1) + i]!), z);
  };
  const p = new Vector3();
  const q = new Vector3();
  const r = new Vector3();
  const s = new Vector3();
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      at(i, j, p);
      at(i + 1, j, q);
      at(i + 1, j + 1, r);
      at(i, j + 1, s);
      out.paint(footOf((p.x + r.x) / 2, (p.z + r.z) / 2) >= MOSS_FROM ? MOSS : FLOOR);
      facet(out, p, s, r);
      facet(out, p, r, q);
    }
  }
}

/** A faceted rock unit shape per kind, its corners nudged so no two boulders read alike. */
function rockShape(rock: Rock, detail: number, seed: number): BufferGeometry {
  const g = rock.kind === 'boulder' ? new IcosahedronGeometry(1, detail) : new ConeGeometry(1, 1, 5 + detail, 1).rotateX(Math.PI).translate(0, -0.5, 0);
  const p = g.getAttribute('position');
  const rand = rng(seed);
  const nudge = new Map<string, number>();
  const a = new Vector3();
  for (let i = 0; i < p.count; i++) {
    a.fromBufferAttribute(p, i);
    const key = `${a.x.toFixed(3)},${a.y.toFixed(3)},${a.z.toFixed(3)}`;
    let k = nudge.get(key);
    if (k === undefined) {
      k = 0.86 + rand() * 0.24;
      nudge.set(key, k);
    }
    if (rock.kind === 'boulder') a.multiplyScalar(k);
    else a.set(a.x * k, a.y, a.z * k);
    p.setXYZ(i, a.x, a.y, a.z);
  }
  const flat = g.index === null ? g : g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

function rocks(out: SolidBuilder, low: boolean, detail: number): void {
  const m = new Matrix4();
  const turn = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const at = new Vector3();
  const size = new Vector3();
  grottoRocks(low).forEach((rock, i) => {
    const shape = rockShape(rock, detail, 101 + i);
    turn.setFromAxisAngle(up, rock.yaw);
    at.set(rock.x, rock.y, rock.z);
    if (rock.kind === 'boulder') size.set(rock.sx, rock.sy, rock.sz);
    else size.set(rock.sx, rock.sy, rock.sx);
    out.merge(shape, m.compose(at, turn, size));
    shape.dispose();
  });
}

/** The grotto's solids into two builders: the shell and floor into `back`, the rocks into `front`. Free roam only, after the terrain is set. */
export function grottoSolids(low: boolean, back: SolidBuilder, front: SolidBuilder): void {
  const d = low ? DETAIL.low : DETAIL.high;
  dome(back.paint(ROCK), d.az, d.el);
  floor(back, d.floor);
  rocks(front.paint(ROCK), low, d.rock);
}
