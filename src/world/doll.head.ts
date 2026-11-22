/**
 * The doll's head (world/doll.ts): a stuffed burlap sack, not a ball. A flat crown with two soft corners where the
 * cloth is gathered, cheeks and jaw full low on the head, two panels puffed either side of a welted seam that runs over
 * the crown from ear to ear and down the back, a little lopsided and dented where the stuffing settled. Sewn over it:
 * cross stitches along both seams, a mouth of uneven stitches and a patch held on by a blanket stitch.
 */
import { TorusGeometry, Vector3 } from 'three';
import { add, at, BURLAP, DARK_THREAD, dome, jitter, KIND, PATCH, stitch, strip, THREAD, THREAD_R, vert, type Built } from './doll.sew.ts';

/** The sack's middle height and half sizes (m): across, front to back, up to the crown, down to the jaw. */
export const HEAD = { y: 0.79, rx: 0.262, rz: 0.222, top: 0.205, bottom: 0.235 } as const;
/** Superellipse powers: the girth a rounded square seen from above, the crown flatter than the jaw. */
const SQUARE = 2.5;
const CROWN = 3.2;
const JAW = 2.6;
/**
 * Bumps on the sack's radius at unit directions, as [x, y, z, gain, spread²]: the two gathered corners at the crown
 * seam's ends and dents where the stuffing settled.
 */
const BUMPS = [
  [0.76, 0.65, 0, 0.15, 0.025], [-0.76, 0.65, 0, 0.13, 0.025],
  [0.45, 0.72, 0.53, -0.035, 0.05], [-0.74, 0.12, -0.66, -0.03, 0.04],
] as const;
const COLS = 32;
const ROWS = 18;
/** The crown seam's ends below the ears (rad of elevation), the welt's half width and the height of its top (m). */
const EAR_E = -0.25;
const WELT_W = 0.008;
const WELT_H = 0.004;
const EYE_A = 0.42;
const EYE_E = 0.04;
const BUTTON = [0.012, 0.011, 0.013] as const;

const sq = (v: number): number => v * v;
function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** The sack's surface at azimuth a (from the face toward the doll's left, +x) and elevation e, into out (doll frame). */
export function headPoint(a: number, e: number, out: Vector3): Vector3 {
  const dx = Math.cos(e) * Math.sin(a);
  const dy = Math.sin(e);
  const dz = Math.cos(e) * Math.cos(a);
  const pow = dy > 0 ? CROWN : JAW;
  const girth = (Math.abs(dx / HEAD.rx) ** SQUARE + Math.abs(dz / HEAD.rz) ** SQUARE) ** (1 / SQUARE);
  let r = (girth ** pow + Math.abs(dy / (dy > 0 ? HEAD.top : HEAD.bottom)) ** pow) ** (-1 / pow);
  // The panels puff out between the seams and are pulled in along them.
  r *= 1 - 0.045 * Math.exp(-sq(dz / 0.14)) * smooth(-0.35, -0.05, dy) - 0.04 * Math.exp(-sq(dx / 0.14)) * smooth(0.05, -0.3, dz);
  for (const [bx, by, bz, gain, spread] of BUMPS) r *= 1 + gain * Math.exp(-(sq(dx - bx) + sq(dy - by) + sq(dz - bz)) / spread);
  // Lopsided: the doll's left fuller up top.
  r *= 1 + 0.035 * dx * (dy + 0.2);
  const y = r * dy;
  // Cheeks and jaw full low on the head, the crown a little narrower.
  const t = y / HEAD.top;
  const wide = 1 + 0.08 * Math.exp(-sq((t + 0.45) / 0.4)) - 0.05 * smooth(0.35, 1, t);
  return out.set(r * dx * wide, HEAD.y + y, r * dz * (1 + (wide - 1) * 0.5));
}

const pa = new Vector3();
const pb = new Vector3();
const pe = new Vector3();
/** The surface at (a, e) into p and its outward normal, from the surface's slopes, into n (a pole takes it from just beside itself). */
function headAt(a: number, e: number, p: Vector3, n: Vector3): Vector3 {
  const ec = Math.min(Math.max(e, -1.54), 1.54);
  headPoint(a + 1e-3, ec, pa).sub(headPoint(a - 1e-3, ec, pb));
  headPoint(a, ec + 1e-3, pe).sub(headPoint(a, ec - 1e-3, pb));
  n.crossVectors(pa, pe).normalize();
  return headPoint(a, e, p);
}

/** Moves q onto the cloth in the direction it lies from the head's middle, with the normal there in n. */
function snap(q: Vector3, n: Vector3): Vector3 {
  const a = Math.atan2(q.x, q.z);
  const e = Math.atan2(q.y - HEAD.y, Math.hypot(q.x, q.z));
  return headAt(a, e, q, n);
}

/** The crown seam at s in [-1, 1]: from below the right ear (-1) over the crown to below the left (1). */
function crownSeam(s: number, out: Vector3, n: Vector3): Vector3 {
  const a = s < 0 ? -Math.PI / 2 : Math.PI / 2;
  const e = Math.PI / 2 - Math.abs(s) * (Math.PI / 2 - EAR_E);
  return headAt(a, e, out, n);
}

/** The sack itself: a grid over azimuth and elevation, its weave coordinates the girth and height. */
function sack(b: Built, part: number): void {
  const base = b.pos.length / 3;
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i <= COLS; i++) {
    const a = -Math.PI + (2 * Math.PI * i) / COLS;
    for (let j = 0; j <= ROWS; j++) {
      const e = -Math.PI / 2 + (Math.PI * j) / ROWS;
      vert(b, part, headAt(a, e, p, n), n, BURLAP, KIND.burlap, a * HEAD.rx, p.y);
    }
  }
  strip(b, base, COLS + 1, ROWS + 1);
}

/** The seams as paths over t in [0, 1], each with its welt's strands and its cross stitches: ear to ear over the crown, down the back. */
const SEAMS: readonly (readonly [(t: number, p: Vector3, n: Vector3) => Vector3, number, number])[] = [
  [(t, p, n) => crownSeam(2 * t - 1, p, n), 16, 12],
  [(t, p, n) => headAt(Math.PI, 1.5 - 2.45 * t, p, n), 6, 5],
];

/**
 * Each seam's welt, the ridge where two edges are turned in and sewn (a run of fat burlap strands half sunk into the
 * cloth), and the uneven cross stitches over it.
 */
function seams(b: Built, part: number): void {
  const c = new Vector3();
  const n = new Vector3();
  const t = new Vector3();
  const s = new Vector3();
  const a = new Vector3();
  const z = new Vector3();
  const m = new Vector3();
  /** A stitch across the seam at c (normal n, seam along t), turned `turn` from square across it, `len` long. */
  const across = (turn: number, len: number, rise: number): void => {
    s.crossVectors(t, n).normalize().multiplyScalar(Math.cos(turn)).addScaledVector(t, Math.sin(turn)).multiplyScalar(len / 2);
    snap(a.copy(c).sub(s), m);
    snap(z.copy(c).add(s), m);
    stitch(b, part, a, z, n, THREAD, THREAD_R, rise);
  };
  let k = 100;
  for (const [path, strands, crosses] of SEAMS) {
    path(0, a, n);
    for (let i = 1; i <= strands; i++) {
      path(i / strands, z, n);
      stitch(b, part, a, z, n, BURLAP, WELT_W, -1.2 * WELT_W, KIND.burlap);
      a.copy(z);
    }
    for (let i = 0; i < crosses; i++) {
      const at = (i + 0.5) / crosses + 0.015 * jitter(k++);
      path(at, c, n);
      path(at + 0.005, t, m).sub(path(at - 0.005, s, m)).normalize();
      const len = 0.044 + 0.008 * jitter(k++);
      across(Math.PI / 4 + 0.15 * jitter(k++), len, 0.75 * WELT_H);
      across(-Math.PI / 4 + 0.15 * jitter(k++), len * (1 + 0.1 * jitter(k++)), 0.75 * WELT_H + THREAD_R);
    }
  }
}

/** Two black buttons for eyes, each in its rim, and a mouth of uneven stitches. */
function face(b: Built, part: number): void {
  const p = new Vector3();
  const n = new Vector3();
  const t = new Vector3();
  const a = new Vector3();
  const z = new Vector3();
  const up = new Vector3(0, 1, 0);
  for (const ea of [EYE_A, -EYE_A]) {
    headAt(ea, EYE_E, p, n);
    add(b, dome(0.046, 0.022, 16, 6, 0.5), at(t.copy(p).addScaledVector(n, 0.006), z.copy(n).negate(), up), part, BUTTON, KIND.button);
    add(b, new TorusGeometry(0.043, 0.007, 5, 14), at(t.copy(p).addScaledVector(n, 0.002), up, n), part, BUTTON, KIND.button);
  }
  let k = 200;
  for (let i = 0; i < 7; i++) {
    const s = (i - 3) / 3 + 0.04 * jitter(k++);
    const az = s * 0.3;
    const el = -0.36 + 0.08 * s * s;
    const tilt = 0.05 * jitter(k++);
    const half = 0.065 + 0.022 * jitter(k++);
    headPoint(az + tilt, el - half, a);
    headPoint(az - tilt, el + half + 0.01 * jitter(k++), z);
    headAt(az, el, t, n);
    stitch(b, part, a, z, n, DARK_THREAD, THREAD_R * 0.8);
  }
}

/** The patch's place (rad of azimuth and elevation), half size and lift off the cloth (m). */
const PATCH_A = 0.9;
const PATCH_E = 0.4;
const PATCH_HALF = 0.05;
const PATCH_LIFT = 0.004;
/** The patch's turn on the cloth: cos and sin of 0.18 rad. */
const TURN = [0.984, 0.179] as const;

/** A square of lighter burlap sewn over the doll's left brow, its weave turned with it, held by a blanket stitch. */
function patch(b: Built, part: number): void {
  const n = new Vector3();
  /** The cloth at patch coordinates (u, v) (m, about 0.24 m of cloth to the radian there), lifted `lift`; its normal in n. */
  const onCloth = (u: number, v: number, lift: number, out: Vector3): Vector3 => {
    const a = PATCH_A + (u * TURN[0] - v * TURN[1]) / 0.24;
    const e = PATCH_E + (u * TURN[1] + v * TURN[0]) / 0.24;
    return headAt(a, e, out, n).addScaledVector(n, lift);
  };
  const h = PATCH_HALF;
  const base = b.pos.length / 3;
  const p = new Vector3();
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      const u = -h + (h * i) / 2;
      const v = -h + (h * j) / 2;
      // Stuffed a little in the middle, its cut edge sewn down flat onto the cloth.
      vert(b, part, onCloth(u, v, i % 4 === 0 || j % 4 === 0 ? 0.001 : PATCH_LIFT, p), n, PATCH, KIND.burlap, u, v);
    }
  }
  strip(b, base, 5, 5);
  // The blanket stitch: legs square to each edge from inside the patch to just past it, joined along the edge.
  const feet: [number, number][] = [];
  const a = new Vector3();
  const z = new Vector3();
  let k = 300;
  for (const [su, sv, eu, ev] of [[-h, -h, 1, 0], [h, -h, 0, 1], [h, h, -1, 0], [-h, h, 0, -1]] as const) {
    for (const along of [1 / 6, 1 / 2, 5 / 6]) {
      const d = 2 * h * along + 0.006 * jitter(k++);
      const deep = 0.014 + 0.004 * jitter(k++);
      const u = su + eu * d;
      const v = sv + ev * d;
      onCloth(u - ev * deep, v + eu * deep, PATCH_LIFT, a);
      feet.push([u + ev * 0.005, v - eu * 0.005]);
      stitch(b, part, a, onCloth(u + ev * 0.005, v - eu * 0.005, 0, z), n, THREAD, THREAD_R * 0.85, 0.002);
    }
  }
  feet.forEach(([u, v], i) => {
    const [nu, nv] = feet[(i + 1) % feet.length]!;
    onCloth(u, v, 0, a);
    onCloth(nu, nv, 0, z);
    onCloth((u + nu) / 2, (v + nv) / 2, 0, p);
    stitch(b, part, a, z, n, THREAD, THREAD_R * 0.85);
  });
}

/** Builds the head as part `part`: the sack, its seams, face and patch. */
export function buildHead(b: Built, part: number): void {
  sack(b, part);
  seams(b, part);
  face(b, part);
  patch(b, part);
}
