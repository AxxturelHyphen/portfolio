/**
 * The visitor: a small burlap doll with a big head, sewn together with thick white thread, a metal zip down its chest
 * and two shiny black button eyes, carrying a tin lantern (gl/doll.ts draws it, one mesh for doll and lantern). Real
 * geometry built once from lathes, boxes and tori in the doll's own frame (metres, ground point at the origin, facing
 * +z, its left at +x), every vertex tagged with its part. The gait (world/puppet.gait.ts) poses the parts on the 12 fps
 * tick: legs and arms swing opposite on the stride, the body leans and breathes, the head glances; the doll turns
 * toward where it walks once it has gone a step from where it stood (a nudge shorter than that turns nothing) and,
 * standing, turns three quarters to the lens. The lantern hangs from the carrying hand and
 * swings every frame. Posing writes into preallocated arrays: nothing is allocated per frame.
 */
import { BoxGeometry, ConeGeometry, Euler, LatheGeometry, Matrix4, TorusGeometry, Vector2, Vector3, type BufferGeometry } from 'three';
import { GAIT, LIFE, type Gait } from './puppet.gait.ts';
import { ANTICIPATE, IDLE, SETTLE, SIDE_POSES, type Pose } from './puppet.poses.ts';

export const FIGURE = {
  fps: GAIT.fps,
  /**
   * The doll is built a metre tall and drawn drawK times that, so it reads as clearly as a grown visitor would in the
   * follow framing: topM, its head top above the ground (m) at scale 1, drawn at portraitK on portrait screens.
   */
  drawK: 1.15, topM: 1.005 * 1.15, portraitK: 1.04,
  /** Swing gains on the pose tables' angles: stubby legs need a wider swing to read as a step. */
  legK: 1.7, armK: 1.5, lookDeg: 22,
  /** The carrying arm held forward (deg) and out; standing, the doll turns idleTurn (rad) from facing the lens. */
  carryDeg: 34, carryOutDeg: 10, freeOutDeg: 20, idleTurn: 0.4,
  /** Share of the way to the wanted heading taken each tick: a turn shows as a few stepped poses, like stop motion. */
  turnK: 0.45,
  /** The doll turns to its walk only once it has gone this far (m) from where it last stood (about a step); a still turns at once. */
  turnAfterM: 0.25,
} as const;

/** Paint kinds (doll.frag.glsl): burlap, cotton thread, bright metal, button, lantern glass, contact shadow. */
export const KIND = { burlap: 0, thread: 1, metal: 2, button: 3, glass: 4, shadow: 5 } as const;
const BURLAP = [0.37, 0.26, 0.16] as const;
const THREAD = [0.86, 0.83, 0.75] as const;
const DARK_THREAD = [0.07, 0.045, 0.03] as const;
const STEEL = [0.62, 0.62, 0.64] as const;
const TIN = [0.24, 0.22, 0.2] as const;
const BUTTON = [0.012, 0.011, 0.013] as const;
const GLASS = [1, 0.66, 0.3] as const;
const INK = [0.02, 0.018, 0.03] as const;

/** Parts in vertex order; the lantern last, so a frame re-poses and uploads only its range. */
const P = { body: 0, head: 1, armL: 2, armR: 3, legL: 4, legR: 5, ground: 6, lantern: 7 } as const;
const HIP = 0.22;
const LEG_X = 0.075;
const LEG_M = 0.22;
const SHOULDER = [0.15, 0.49] as const;
const ARM_M = 0.25;
const NECK = 0.56;
const HEAD = { y: 0.78, rx: 0.25, ry: 0.225 } as const;
/** The lantern below the grip (m before LANTERN_K): bail, cap, glass, base; the flame at flameY. */
const LANTERN_K = 1.3;
const FLAME_Y = -0.108 * LANTERN_K;
const DEG = Math.PI / 180;

const BODY = [[0, 0.17], [0.09, 0.18], [0.145, 0.22], [0.168, 0.29], [0.162, 0.37], [0.14, 0.45], [0.105, 0.52], [0.07, 0.56], [0, 0.575]] as const;
const LIMB = (len: number, r: number): number[][] => [[0, -len], [r * 0.55, -len + 0.005], [r * 0.9, -len + 0.022], [r, -len + 0.06], [r * 0.97, -0.03],
  [r * 0.75, 0.01], [0, 0.02]];

export interface Doll {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  /** rgb and kind per vertex. */
  readonly paint: Float32Array;
  /** The burlap's weave coordinates (m), or the shadow's radius share. */
  readonly fab: Float32Array;
  readonly index: Uint16Array;
  /** First vertex of the lantern: a frame that only swings it re-poses from here. */
  readonly lanternFrom: number;
  /** Ground point, lift (m, before scale), heading (rad, local +z toward world (sin, cos)) and scale. */
  readonly root: { x: number; z: number; lift: number; heading: number; k: number };
  /** World xyz of the carrying hand's grip and of the flame, after pose() and hang(). */
  readonly grip: Float32Array;
  readonly flame: Float32Array;
  /**
   * Poses the body for the gait at (x, z), scale k, carrying on `carrySide` (-1 its left from behind), the carrying arm
   * turned by `swayDeg` with the lantern; the lens at `yaw`. True when the body was re-posed (a tick, or still frames).
   */
  pose(g: Gait, x: number, z: number, k: number, carrySide: number, swayDeg: number, yaw: number, still: boolean): boolean;
  /** Hangs the lantern from the grip at pendulum `angle` (rad, its foot toward screen right) in the plane facing the lens. */
  hang(angle: number, yaw: number): void;
}

interface Built { pos: number[]; nor: number[]; paint: number[]; fab: number[]; index: number[]; part: number[] }
const frame = new Matrix4();
const ax = new Vector3();
const ay = new Vector3();
const az = new Vector3();

/** Appends `geo` placed by `m` as part `part`, painted `rgb` of `kind`; `fab` gives each placed vertex its weave coordinates. */
function add(b: Built, geo: BufferGeometry, m: Matrix4, part: number, rgb: readonly number[], kind: number, fab?: (p: Vector3) => [number, number]): void {
  geo.applyMatrix4(m);
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const base = b.pos.length / 3;
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    b.pos.push(p.x, p.y, p.z);
    b.nor.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    b.paint.push(rgb[0]!, rgb[1]!, rgb[2]!, kind);
    b.fab.push(...(fab === undefined ? [0, 0] : fab(p)));
    b.part.push(part);
  }
  const idx = geo.getIndex();
  if (idx !== null) for (let i = 0; i < idx.count; i++) b.index.push(base + idx.getX(i));
  else for (let i = 0; i < pos.count; i++) b.index.push(base + i);
  geo.dispose();
}

/** A frame at `p` whose local y runs along `y` and local z as near `hint` as it can. */
function at(p: Vector3, y: Vector3, hint: Vector3): Matrix4 {
  ay.copy(y).normalize();
  az.copy(hint).addScaledVector(ay, -hint.dot(ay)).normalize();
  ax.crossVectors(ay, az);
  return frame.makeBasis(ax, ay, az).setPosition(p);
}

const lathe = (pts: readonly (readonly number[])[], segs: number): LatheGeometry => new LatheGeometry(pts.map(([r, y]) => new Vector2(r, y)), segs);
/** A half ellipse turned about y: a sphere (rx = ry), an egg, or a dome when it only sweeps `to` of the half turn. */
const dome = (rx: number, ry: number, segs: number, rings: number, to = 1): LatheGeometry =>
  lathe(Array.from({ length: rings + 1 }, (_, i) => [rx * Math.sin((Math.PI * i * to) / rings), -ry * Math.cos((Math.PI * i * to) / rings)]), segs);
/** Weave coordinates on a part turned about the vertical through (cx, cz): its girth at radius r, and height. */
const cyl = (cx: number, cz: number, r: number) => (p: Vector3): [number, number] => [Math.atan2(p.x - cx, p.z - cz) * r, p.y];

/** The body's radius at height y (m) and its slope, from the turned profile. */
function bodyAt(y: number): [number, number] {
  for (let i = 1; i < BODY.length; i++) {
    const [r0, y0] = BODY[i - 1]!;
    const [r1, y1] = BODY[i]!;
    if (y <= y1) return [r0 + ((r1 - r0) * (y - y0)) / (y1 - y0), (r1 - r0) / (y1 - y0)];
  }
  return [0, 0];
}

function build(): Built {
  const b: Built = { pos: [], nor: [], paint: [], fab: [], index: [], part: [] };
  const m = new Matrix4();
  const p = new Vector3();
  const n = new Vector3();
  const t = new Vector3();
  const up = new Vector3(0, 1, 0);
  const bar = (part: number, rgb: readonly number[] = THREAD, len = 0.028): void =>
    add(b, new BoxGeometry(0.009, len, 0.009), at(p.addScaledVector(n, 0.002), t, n), part, rgb, KIND.thread);

  // The contact shadow first in the index, so the doll draws over it.
  add(b, lathe([[0.26, 0.003], [0, 0.003]], 18), m.identity(), P.ground, INK, KIND.shadow, (q) => [Math.hypot(q.x, q.z) / 0.26, 0]);
  add(b, lathe(BODY, 20), m.identity(), P.body, BURLAP, KIND.burlap, cyl(0, 0, 0.16));
  add(b, dome(HEAD.rx, HEAD.ry, 22, 14), m.makeTranslation(0, HEAD.y, 0), P.head, BURLAP, KIND.burlap, cyl(0, 0, HEAD.rx));
  for (const [part, sx] of [[P.armL, 1], [P.armR, -1]] as const) {
    add(b, lathe(LIMB(ARM_M, 0.048), 12), m.makeTranslation(sx * SHOULDER[0], SHOULDER[1], 0), part, BURLAP, KIND.burlap, cyl(sx * SHOULDER[0], 0, 0.048));
  }
  for (const [part, sx] of [[P.legL, 1], [P.legR, -1]] as const) {
    add(b, lathe(LIMB(LEG_M, 0.064), 12), m.makeTranslation(sx * LEG_X, HIP, 0), part, BURLAP, KIND.burlap, cyl(sx * LEG_X, 0, 0.064));
  }

  /** A point on the head at azimuth a (from the face toward +x) and elevation e, its normal, and its tangent along e. */
  const headAt = (a: number, e: number): void => {
    p.set(HEAD.rx * Math.cos(e) * Math.sin(a), HEAD.y + HEAD.ry * Math.sin(e), HEAD.rx * Math.cos(e) * Math.cos(a));
    n.set((p.x / HEAD.rx) / HEAD.rx, ((p.y - HEAD.y) / HEAD.ry) / HEAD.ry, (p.z / HEAD.rx) / HEAD.rx).normalize();
    t.set(-HEAD.rx * Math.sin(e) * Math.sin(a), HEAD.ry * Math.cos(e), -HEAD.rx * Math.sin(e) * Math.cos(a));
  };
  // The seam over the crown from ear to ear, the neck seam, and the seams down the body's sides and back.
  for (let i = 0; i < 17; i++) {
    const s = -1.35 + (2.7 * i) / 16;
    p.set(HEAD.rx * Math.sin(s), HEAD.y + HEAD.ry * Math.cos(s), 0);
    n.set(Math.sin(s) / HEAD.rx, Math.cos(s) / HEAD.ry, 0).normalize();
    t.set(0, 0, 1);
    bar(P.head);
  }
  for (let i = 0; i < 12; i++) {
    headAt((2 * Math.PI * i) / 12, -1.1);
    bar(P.head);
  }
  for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
    for (let i = 0; i < 7; i++) {
      const y = 0.25 + (0.26 * i) / 6;
      const [r, dr] = bodyAt(y);
      p.set(r * Math.sin(a), y, r * Math.cos(a));
      n.set(Math.sin(a), -dr, Math.cos(a)).normalize();
      t.set(Math.cos(a), 0, -Math.sin(a));
      bar(P.body);
    }
  }
  // The cuff seams at the wrists and ankles.
  for (const [part, sx, sy, d, r] of [[P.armL, SHOULDER[0], SHOULDER[1], 0.19, 0.048], [P.armR, -SHOULDER[0], SHOULDER[1], 0.19, 0.048],
    [P.legL, LEG_X, HIP, 0.15, 0.064], [P.legR, -LEG_X, HIP, 0.15, 0.064]] as const) {
    for (let i = 0; i < 7; i++) {
      const a = (2 * Math.PI * (i + 0.5)) / 7;
      n.set(Math.sin(a), 0, Math.cos(a));
      p.set(sx + r * n.x, sy - d, r * n.z);
      t.copy(up);
      bar(part);
    }
  }
  // The zip down the chest: dark tape, steel teeth either side in turn, the slider and its pull at the top.
  for (let i = 0; i < 24; i++) {
    const y = 0.265 + i * 0.0095;
    const [r, dr] = bodyAt(y);
    n.set(0, -dr, 1).normalize();
    t.set(0, 1, dr).normalize();
    p.set(0, y, r);
    add(b, new BoxGeometry(0.034, 0.0098, 0.004), at(p, t, n), P.body, DARK_THREAD, KIND.thread);
    p.set(i % 2 === 0 ? 0.004 : -0.004, y, r).addScaledVector(n, 0.003);
    add(b, new BoxGeometry(0.013, 0.0055, 0.005), at(p, t, n), P.body, STEEL, KIND.metal);
  }
  {
    const y = 0.5;
    const [r, dr] = bodyAt(y);
    n.set(0, -dr, 1).normalize();
    t.set(0, 1, dr).normalize();
    p.set(0, y, r).addScaledVector(n, 0.006);
    add(b, new BoxGeometry(0.022, 0.022, 0.01), at(p, t, n), P.body, STEEL, KIND.metal);
    p.addScaledVector(t, -0.026).addScaledVector(n, 0.006);
    add(b, new BoxGeometry(0.013, 0.036, 0.004), at(p, t, n), P.body, STEEL, KIND.metal);
  }
  // Two black buttons for eyes, each in its rim, and a small stitched smile.
  for (const a of [0.42, -0.42]) {
    headAt(a, 0.04);
    add(b, dome(0.046, 0.022, 16, 6, 0.5), at(p.addScaledVector(n, 0.006), t.copy(n).negate(), up), P.head, BUTTON, KIND.button);
    add(b, new TorusGeometry(0.043, 0.007, 6, 18), at(p.addScaledVector(n, -0.004), up, n), P.head, BUTTON, KIND.button);
  }
  for (let i = 0; i < 5; i++) {
    const s = (i - 2) / 2;
    headAt(s * 0.3, -0.36 + 0.09 * s * s);
    t.set(Math.cos(s * 0.3), 0.3 * s, -Math.sin(s * 0.3));
    bar(P.head, DARK_THREAD, 0.022);
  }
  // The tin lantern under the grip: its bail, cap, glass between four bars, and base.
  const L = new Matrix4().makeScale(LANTERN_K, LANTERN_K, LANTERN_K);
  const lan = (geo: BufferGeometry, y: number, rgb: readonly number[], kind: number): void => add(b, geo, m.makeTranslation(0, y * LANTERN_K, 0).multiply(L), P.lantern, rgb, kind);
  lan(new TorusGeometry(0.028, 0.004, 5, 12, Math.PI), -0.028, TIN, KIND.metal);
  lan(new ConeGeometry(0.05, 0.035, 12), -0.0475, TIN, KIND.metal);
  lan(lathe([[0, -0.15], [0.036, -0.15], [0.038, -0.065], [0, -0.065]], 12), 0, GLASS, KIND.glass);
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI * (i + 0.5)) / 2;
    lan(new BoxGeometry(0.007, 0.085, 0.007).translate(0.039 * Math.sin(a), 0, 0.039 * Math.cos(a)), -0.1075, TIN, KIND.metal);
  }
  lan(lathe([[0, -0.165], [0.048, -0.165], [0.05, -0.15], [0, -0.15]], 12), 0, TIN, KIND.metal);
  return b;
}

/** The pose table entry: the profile walk, whose angles are the swing seen from the side. */
function poseOf(g: Gait): Pose {
  if (g.idle) return IDLE;
  if (g.settle > 0) return SETTLE.side;
  if (g.cue > 0) return ANTICIPATE.side;
  return SIDE_POSES[g.pose % SIDE_POSES.length]!;
}

const wrapPi = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

export function createDoll(): Doll {
  const b = build();
  const rest = new Float32Array(b.pos);
  const restN = new Float32Array(b.nor);
  const part = new Uint8Array(b.part);
  const position = new Float32Array(rest);
  const normal = new Float32Array(restN);
  const lanternFrom = b.part.indexOf(P.lantern);
  const M = Array.from({ length: P.lantern + 1 }, () => new Matrix4());
  const tmp = new Matrix4();
  const euler = new Euler(0, 0, 0, 'ZXY');
  const v = new Vector3();
  const axis = new Vector3();
  const root = { x: 0, z: 0, lift: 0, heading: Math.PI, k: 1 };
  const grip = new Float32Array(3);
  const flame = new Float32Array(3);
  /** The grip in the doll's frame, as last posed. */
  const gripAt = new Vector3();
  let walkHeading = Math.PI;
  let restX = 0;
  let restZ = 0;
  let tick = -1;

  /** out = T(p) R(x, y, z) T(-p): a turn about the pivot p. */
  function about(out: Matrix4, px: number, py: number, pz: number, x: number, y: number, z: number): Matrix4 {
    out.makeRotationFromEuler(euler.set(x, y, z));
    v.set(-px, -py, -pz).applyMatrix4(out);
    return out.setPosition(v.x + px, v.y + py, v.z + pz);
  }
  /** Writes part vertices [from, to) posed by their part's matrix. */
  function write(from: number, to: number): void {
    for (let i = from; i < to; i++) {
      const e = M[part[i]!]!.elements;
      const j = i * 3;
      const x = rest[j]!, y = rest[j + 1]!, z = rest[j + 2]!;
      position[j] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      position[j + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      position[j + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
      const nx = restN[j]!, ny = restN[j + 1]!, nz = restN[j + 2]!;
      normal[j] = e[0]! * nx + e[4]! * ny + e[8]! * nz;
      normal[j + 1] = e[1]! * nx + e[5]! * ny + e[9]! * nz;
      normal[j + 2] = e[2]! * nx + e[6]! * ny + e[10]! * nz;
    }
  }
  /** Local point q to world, by the root, into out. */
  function toWorld(out: Float32Array, q: Vector3): void {
    const c = Math.cos(root.heading);
    const s = Math.sin(root.heading);
    out[0] = root.x + root.k * (q.x * c + q.z * s);
    out[1] = root.k * (q.y + root.lift);
    out[2] = root.z + root.k * (q.z * c - q.x * s);
  }

  return {
    position, normal, paint: new Float32Array(b.paint), fab: new Float32Array(b.fab), index: new Uint16Array(b.index), lanternFrom, root, grip, flame,
    pose(g, x, z, k, carrySide, swayDeg, yaw, still) {
      root.x = x;
      root.z = z;
      root.k = k * FIGURE.drawK;
      if (g.idle) {
        restX = x;
        restZ = z;
      }
      const walking = !g.idle && (still || Math.hypot(x - restX, z - restZ) > FIGURE.turnAfterM);
      if (walking && g.speed > GAIT.viewFrom) walkHeading = Math.PI - g.heading;
      const want = walking ? walkHeading : -yaw + carrySide * FIGURE.idleTurn;
      const fresh = still || g.tick !== tick;
      if (still) root.heading = want;
      else if (fresh) root.heading = wrapPi(root.heading + wrapPi(want - root.heading) * FIGURE.turnK);
      if (!fresh) {
        toWorld(grip, v.copy(gripAt));
        return false;
      }
      tick = g.tick;
      const p = poseOf(g);
      const drop = p.drop * 0.6;
      // The body leans into the walk, banks, turns with the idle shift and breathes about the hips.
      about(M[P.body]!, 0, HIP, 0, g.lean * DEG, g.shift * 3 * DEG, -g.bank * 0.5 * DEG);
      tmp.makeScale(1, 1 + g.breath * LIFE.breathK, 1);
      tmp.elements[13] = HIP * -g.breath * LIFE.breathK;
      M[P.body]!.multiply(tmp);
      M[P.body]!.elements[13]! -= drop;
      euler.order = 'YXZ';
      about(M[P.head]!, 0, NECK, 0, p.head * DEG, -g.look * FIGURE.lookDeg * DEG, 0).premultiply(M[P.body]!);
      euler.order = 'ZXY';
      // The legs swing about the hips and lift on the passing poses; the free arm swings against the leg on its side.
      const hipL = -p.hipA * FIGURE.legK * DEG;
      const hipR = -p.hipB * FIGURE.legK * DEG;
      about(M[P.legL]!, LEG_X, HIP, 0, hipL, 0, 0).elements[13]! += p.footA * 0.6;
      about(M[P.legR]!, -LEG_X, HIP, 0, hipR, 0, 0).elements[13]! += p.footB * 0.6;
      const carry = carrySide < 0 ? P.armL : P.armR;
      const free = carry === P.armL ? P.armR : P.armL;
      const freeX = free === P.armL ? 1 : -1;
      about(M[free]!, freeX * SHOULDER[0], SHOULDER[1], 0, (free === P.armL ? -hipL : -hipR) * (FIGURE.armK / FIGURE.legK), 0, freeX * FIGURE.freeOutDeg * DEG)
        .premultiply(M[P.body]!);
      const lift = (p.carry + g.lift * LIFE.liftDeg + swayDeg) * DEG;
      about(M[carry]!, -freeX * SHOULDER[0], SHOULDER[1], 0, -FIGURE.carryDeg * DEG - lift, 0, -freeX * FIGURE.carryOutDeg * DEG).premultiply(M[P.body]!);
      // Grounded on the lower sole.
      const sole = (a: number, up: number): number => up - LEG_M * (1 - Math.cos(a));
      root.lift = -Math.min(sole(hipL, p.footA * 0.6), sole(hipR, p.footB * 0.6));
      write(0, lanternFrom);
      gripAt.set(-freeX * SHOULDER[0], SHOULDER[1] - ARM_M + 0.035, 0.02).applyMatrix4(M[carry]!);
      toWorld(grip, v.copy(gripAt));
      return true;
    },
    hang(angle, yaw) {
      // The lens's axis in the doll's frame: the pendulum swings across the screen.
      axis.set(-Math.sin(yaw), 0, Math.cos(yaw)).applyAxisAngle(ay.set(0, 1, 0), -root.heading);
      M[P.lantern]!.makeRotationAxis(axis, angle).setPosition(gripAt);
      write(lanternFrom, part.length);
      toWorld(flame, v.set(0, FLAME_Y, 0).applyMatrix4(M[P.lantern]!));
    },
  };
}
