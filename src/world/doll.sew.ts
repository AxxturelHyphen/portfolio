/**
 * The doll's sewing kit (world/doll.ts): the builder that gathers its one mesh, the paint kinds and colours, and the
 * thread itself. A stitch is a strand of twisted cotton standing proud of the cloth and dipping into a hole at each end
 * (doll.frag.glsl darkens the hole and the twist's grooves from its weave coordinates: share along it, share round it).
 */
import { LatheGeometry, Matrix4, Vector2, Vector3, type BufferGeometry } from 'three';

/** Paint kinds (doll.frag.glsl): burlap, cotton thread, bright metal, button, lantern glass, contact shadow. */
export const KIND = { burlap: 0, thread: 1, metal: 2, button: 3, glass: 4, shadow: 5 } as const;
export const BURLAP = [0.37, 0.26, 0.16] as const;
export const PATCH = [0.5, 0.37, 0.22] as const;
export const THREAD = [0.8, 0.74, 0.61] as const;
export const DARK_THREAD = [0.07, 0.045, 0.03] as const;
/** The thread's radius (m): thick, so a stitch reads at walking distance. */
export const THREAD_R = 0.0052;

export interface Built { pos: number[]; nor: number[]; paint: number[]; fab: number[]; index: number[]; part: number[] }

const frame = new Matrix4();
const ax = new Vector3();
const ay = new Vector3();
const az = new Vector3();
const dir = new Vector3();
const side = new Vector3();
const up = new Vector3();
const c = new Vector3();
const q = new Vector3();
const at3 = new Vector3();

/** Appends one vertex of part `part`, painted `rgb` of `kind`, with weave coordinates (u, v). */
export function vert(b: Built, part: number, p: Vector3, n: Vector3, rgb: readonly number[], kind: number, u: number, v: number): void {
  b.pos.push(p.x, p.y, p.z);
  b.nor.push(n.x, n.y, n.z);
  b.paint.push(rgb[0]!, rgb[1]!, rgb[2]!, kind);
  b.fab.push(u, v);
  b.part.push(part);
}

/** Appends `geo` placed by `m` as part `part`, painted `rgb` of `kind`; `fab` gives each placed vertex its weave coordinates. */
export function add(b: Built, geo: BufferGeometry, m: Matrix4, part: number, rgb: readonly number[], kind: number, fab?: (p: Vector3) => [number, number]): void {
  geo.applyMatrix4(m);
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const base = b.pos.length / 3;
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const [u, v] = fab === undefined ? [0, 0] : fab(p);
    vert(b, part, p, n.fromBufferAttribute(nor, i), rgb, kind, u, v);
  }
  const idx = geo.getIndex();
  if (idx !== null) for (let i = 0; i < idx.count; i++) b.index.push(base + idx.getX(i));
  else for (let i = 0; i < pos.count; i++) b.index.push(base + i);
  geo.dispose();
}

/** A frame at `p` whose local y runs along `y` and local z as near `hint` as it can. */
export function at(p: Vector3, y: Vector3, hint: Vector3): Matrix4 {
  ay.copy(y).normalize();
  az.copy(hint).addScaledVector(ay, -hint.dot(ay)).normalize();
  ax.crossVectors(ay, az);
  return frame.makeBasis(ax, ay, az).setPosition(p);
}

export const lathe = (pts: readonly (readonly number[])[], segs: number): LatheGeometry => new LatheGeometry(pts.map(([r, y]) => new Vector2(r, y)), segs);
/** A half ellipse turned about y: a sphere (rx = ry), an egg, or a dome when it only sweeps `to` of the half turn. */
export const dome = (rx: number, ry: number, segs: number, rings: number, to = 1): LatheGeometry =>
  lathe(Array.from({ length: rings + 1 }, (_, i) => [rx * Math.sin((Math.PI * i * to) / rings), -ry * Math.cos((Math.PI * i * to) / rings)]), segs);

/** A repeatable jitter in [-1, 1] for draw n: the stitches' uneven lengths and angles, the same every build. */
export function jitter(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return 2 * (s - Math.floor(s)) - 1;
}

/** Quads between `rings` rings of `per` vertices from `base`, wound outward when the rings turn from side toward up. */
export function strip(b: Built, base: number, rings: number, per: number): void {
  for (let i = 0; i < rings - 1; i++) {
    for (let k = 0; k < per - 1; k++) {
      const v = base + i * per + k;
      b.index.push(v, v + per, v + 1, v + 1, v + per, v + per + 1);
    }
  }
}

/** The thread's rings along a stitch: share of its length, lift (in radii) and radius (share); the ends sink into holes. */
const RINGS = [[0, -0.45, 0.85], [0.25, 0.7, 1], [0.75, 0.7, 1], [1, -0.45, 0.85]] as const;

/**
 * One stitch from a to z over cloth of normal n: a rounded three-sided strand of radius r whose middle stands `rise`
 * (m) higher still, to pass over a welt or another stitch. Fat, sunk into the cloth and painted burlap, a run of them
 * is a welt.
 */
export function stitch(b: Built, part: number, a: Vector3, z: Vector3, n: Vector3, rgb: readonly number[], r = THREAD_R, rise = 0, kind: number = KIND.thread): void {
  dir.subVectors(z, a);
  const len = dir.length();
  dir.divideScalar(len);
  side.crossVectors(dir, n).normalize();
  up.crossVectors(side, dir);
  const base = b.pos.length / 3;
  for (const [s, lift, k] of RINGS) {
    const end = s === 0 ? -1 : s === 1 ? 1 : 0;
    c.copy(a).addScaledVector(dir, len * s).addScaledVector(up, lift * r + (end === 0 ? rise : 0));
    for (let j = 0; j <= 3; j++) {
      const th = Math.PI / 2 + (2 * Math.PI * j) / 3;
      q.copy(side).multiplyScalar(Math.cos(th)).addScaledVector(up, Math.sin(th));
      const x = c.x + q.x * r * k, y = c.y + q.y * r * k, w = c.z + q.z * r * k;
      q.addScaledVector(dir, 0.8 * end).normalize();
      vert(b, part, at3.set(x, y, w), q, rgb, kind, s, j / 3);
    }
  }
  strip(b, base, RINGS.length, 4);
}
