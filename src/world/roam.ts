/**
 * The visitor of free roam (cook/ROAM_PLAN.md section 3, P1): a 0.3 m circle on the ground plane with a smooth
 * velocity, driven by held directions, a walk target (click or tap) or an assisted move along the garden path. It
 * collides with the walkable rectangle and the pond ellipse by pushing out along the contact normal and removing the
 * normal velocity, so it slides along edges. A walk target whose straight line crosses the pond goes round it by the
 * nearer side, one that runs into a solid prop goes round it (detour.ts) and one inside a prop stops at its face; a target
 * the body cannot reach is given up once it stalls. No allocation per frame.
 */
import type { BedId } from '../types.ts';
import { ROAM } from '../core/motion.ts';
import { detour, reachOf } from './detour.ts';

/** Where the visitor may stand: the rectangle its body stays inside, the pond it never enters, the path (x, z) by x. */
export interface WalkArea {
  minX: number; maxX: number; minZ: number; maxZ: number;
  pond: { x: number; z: number; rx: number; rz: number };
  path: readonly (readonly [number, number])[];
  /** Rectangles the body stays out of, as x0, z0, x1, z1 per box (tall cards' hidden strips, occluders.ts). */
  blocks?: Float32Array;
  /** Solid props' boxes (occluders.ts propBlocks), same layout: the body stays out and walk targets steer round them. */
  props?: Float32Array;
}

/** Held direction bits, on screen: turned by the camera's orbit yaw into the world (setYaw). */
export const HOLD = { left: 1, right: 2, up: 4, down: 8 } as const;

/** Waypoints round the pond sit this far out, in units of the body-inflated semi-axes. */
const ROUTE_MARGIN = 1.15;
/** A walk target is given up once the body has crawled under `mps` for `s` seconds (a wall or a card in the way). */
const STALL = { mps: 0.05, s: 0.3 } as const;
const ACCEL = ROAM.speed / ROAM.toSpeedS;
const DECEL = ROAM.speed / ROAM.toStopS;

export interface Visitor {
  /** [x, z] in metres (the light and the follow camera read it by reference). */
  readonly pos: Float32Array;
  /** [vx, vz] in m/s. */
  readonly vel: Float32Array;
  /** True while a key is held, a walk target is pending or an assisted move runs. */
  readonly busy: boolean;
  /** True while an assisted move (signpost, plan, history) carries the visitor. */
  readonly assisted: boolean;
  setHeld(bits: number): void;
  /** Scales the walking speed and the push to it (a brisk walk, the stick pushed part way); 1 is ROAM.speed. */
  setPace(k: number): void;
  /** The camera's yaw (radians, positive toward +x): up walks away from the camera, right to its right. */
  setYaw(yaw: number): void;
  walkTo(x: number, z: number): void;
  place(x: number, z: number): void;
  /** Starts an assisted move to (x, z) along the path (world/assist.ts walks it); steering cancels it. */
  assist(x: number, z: number): void;
  /**
   * Puts the assisted visitor at x on the path, its offset off the path blended by u (the share of the way done); a
   * jump (the cut of a long walk) keeps the walking velocity. At u 1 it lands on (x, z) of assist() and ends.
   */
  assistAt(x: number, u: number, dt: number, jumped: boolean): void;
  /** Ends any assisted move or walk target where the visitor is. */
  halt(): void;
  step(dt: number): void;
}

/** z of the path polyline at x (points sorted by x); clamped to its ends. */
export function pathZ(points: readonly (readonly [number, number])[], x: number): number {
  const first = points[0];
  if (first === undefined) return 0;
  if (x <= first[0]) return first[1];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (x <= b[0]) return a[1] + ((b[1] - a[1]) * (x - a[0])) / Math.max(1e-6, b[0] - a[0]);
  }
  return points[points.length - 1]![1];
}

/** The bed nearest by x, keeping `current` until another is nearer by more than twice the hysteresis. */
export function nearestBed(x: number, current: BedId | null, beds: readonly BedId[], anchorOf: (b: BedId) => number): BedId | null {
  let best: BedId | null = null;
  let bestD = Infinity;
  for (let i = 0; i < beds.length; i++) {
    const b = beds[i]!;
    const d = Math.abs(x - anchorOf(b));
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (current === null || best === null || !beds.includes(current)) return best;
  return Math.abs(x - anchorOf(current)) - bestD > 2 * ROAM.bedHysteresisM ? best : current;
}

/** Streaming lookahead: the bed ahead is wanted once the visitor is this near its edge, walking at least this fast. */
export const HEADING = { withinM: 6, minSpeed: 0.2 } as const;

/** The first bed whose x range starts ahead of x in direction dir (+1 or -1), if its edge is within `within` metres. */
export function bedAhead(x: number, dir: number, beds: readonly BedId[], boundsOf: (b: BedId) => readonly [number, number], within: number): BedId | null {
  let best: BedId | null = null;
  let bestD = Infinity;
  for (let i = 0; i < beds.length; i++) {
    const b = beds[i]!;
    const [x0, x1] = boundsOf(b);
    const d = dir > 0 ? x0 - x : x - x1;
    if (d > 0 && d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return bestD <= within ? best : null;
}

export function createVisitor(area: WalkArea, x0: number, z0: number): Visitor {
  const pos = new Float32Array([x0, z0]);
  const vel = new Float32Array(2);
  const r = ROAM.radius;
  const pa = area.pond.rx + r;
  const pb = area.pond.rz + r;
  let held = 0;
  let pace = 1;
  let cosYaw = 1;
  let sinYaw = 0;
  let hasTarget = false;
  let tx = 0;
  let tz = 0;
  /** Which way round the pond the current target goes: +1 or -1 in the angle of the pond's normalised frame. */
  let side = 1;
  let stalledS = 0;
  let assisting = false;
  let toX = 0;
  let toZ = 0;
  let pathOff0 = 0;
  let pathOff1 = 0;
  const aim = new Float32Array(2);
  const want = new Float32Array(2);
  const pathOf = (x: number): number => pathZ(area.path, x);

  const nx = (x: number): number => (x - area.pond.x) / pa;
  const nz = (z: number): number => (z - area.pond.z) / pb;

  /** Pushes the body out of each box by the shortest way, removing velocity into it. */
  function pushOutOf(b: Float32Array | undefined): void {
    if (b === undefined) return;
    for (let i = 0; i + 3 < b.length; i += 4) {
      const x0 = b[i]! - r;
      const z0 = b[i + 1]! - r;
      const x1 = b[i + 2]! + r;
      const z1 = b[i + 3]! + r;
      const x = pos[0]!;
      const z = pos[1]!;
      if (x <= x0 || x >= x1 || z <= z0 || z >= z1) continue;
      const dl = x - x0;
      const dr = x1 - x;
      const dn = z - z0;
      const ds = z1 - z;
      const m = Math.min(dl, dr, dn, ds);
      if (m === dl) { pos[0] = x0; if (vel[0]! > 0) vel[0] = 0; }
      else if (m === dr) { pos[0] = x1; if (vel[0]! < 0) vel[0] = 0; }
      else if (m === dn) { pos[1] = z0; if (vel[1]! > 0) vel[1] = 0; }
      else { pos[1] = z1; if (vel[1]! < 0) vel[1] = 0; }
    }
  }

  /** Pushes the body inside the rectangle and out of the pond and the blocked boxes, removing velocity into each. */
  function collide(): void {
    for (let pass = 0; pass < ROAM.passes; pass++) {
      const lx = area.minX + r;
      const hx = area.maxX - r;
      const lz = area.minZ + r;
      const hz = area.maxZ - r;
      if (pos[0]! < lx) { pos[0] = lx; if (vel[0]! < 0) vel[0] = 0; }
      if (pos[0]! > hx) { pos[0] = hx; if (vel[0]! > 0) vel[0] = 0; }
      if (pos[1]! < lz) { pos[1] = lz; if (vel[1]! < 0) vel[1] = 0; }
      if (pos[1]! > hz) { pos[1] = hz; if (vel[1]! > 0) vel[1] = 0; }
      pushOutOf(area.blocks);
      pushOutOf(area.props);
      const qx = nx(pos[0]!);
      const qz = nz(pos[1]!);
      const q = Math.hypot(qx, qz);
      if (q >= 1) continue;
      const ux = q > 1e-9 ? qx / q : 0;
      const uz = q > 1e-9 ? qz / q : 1;
      pos[0] = area.pond.x + ux * pa;
      pos[1] = area.pond.z + uz * pb;
      const gx = ux / pa;
      const gz = uz / pb;
      const g = Math.hypot(gx, gz);
      const into = (vel[0]! * gx + vel[1]! * gz) / g;
      if (into < 0) {
        vel[0] = vel[0]! - (into * gx) / g;
        vel[1] = vel[1]! - (into * gz) / g;
      }
    }
  }

  /** Puts a walk target where the body can stand: inside the rectangle, outside the pond. */
  function settleTarget(): void {
    tx = Math.min(area.maxX - r, Math.max(area.minX + r, tx));
    tz = Math.min(area.maxZ - r, Math.max(area.minZ + r, tz));
    const qx = nx(tx);
    const qz = nz(tz);
    const q = Math.hypot(qx, qz);
    if (q >= 1) return;
    const k = q > 1e-9 ? 1.001 / q : 0;
    tx = area.pond.x + (q > 1e-9 ? qx * k : 0) * pa;
    tz = area.pond.z + (q > 1e-9 ? qz * k : 1.001) * pb;
  }

  /** True when the straight line from the visitor to the target crosses the body-inflated pond. */
  function crossesPond(): boolean {
    const px = nx(pos[0]!);
    const pz = nz(pos[1]!);
    const dx = nx(tx) - px;
    const dz = nz(tz) - pz;
    const dd = dx * dx + dz * dz;
    if (dd < 1e-12) return false;
    const s = -(px * dx + pz * dz) / dd;
    if (s <= 0 || s >= 1) return false;
    return Math.hypot(px + s * dx, pz + s * dz) < 1;
  }

  /** Writes into aim the point to head for: the target, a tangent point round the pond or a corner round a prop. */
  function aimPoint(): void {
    if (!crossesPond()) {
      aim[0] = tx;
      aim[1] = tz;
      if (area.props !== undefined) detour(area.props, r, area, pos[0]!, pos[1]!, tx, tz, aim);
      return;
    }
    const px = nx(pos[0]!);
    const pz = nz(pos[1]!);
    const len = Math.hypot(px, pz);
    const a = Math.atan2(pz, px) + side * (len > ROUTE_MARGIN ? Math.acos(ROUTE_MARGIN / len) : Math.PI / 2);
    aim[0] = area.pond.x + Math.cos(a) * ROUTE_MARGIN * pa;
    aim[1] = area.pond.z + Math.sin(a) * ROUTE_MARGIN * pb;
  }

  /** The velocity the visitor wants now (m/s), written into want. */
  function desire(): void {
    want[0] = 0;
    want[1] = 0;
    if (held !== 0) {
      const dx = (held & HOLD.right ? 1 : 0) - (held & HOLD.left ? 1 : 0);
      const dz = (held & HOLD.down ? 1 : 0) - (held & HOLD.up ? 1 : 0);
      const d = Math.hypot(dx, dz);
      if (d > 0) {
        want[0] = ((dx * cosYaw - dz * sinYaw) / d) * ROAM.speed * pace;
        want[1] = ((dx * sinYaw + dz * cosYaw) / d) * ROAM.speed * pace;
      }
      return;
    }
    if (!hasTarget) return;
    const left = Math.hypot(tx - pos[0]!, tz - pos[1]!);
    if (left < ROAM.arriveM) {
      hasTarget = false;
      return;
    }
    aimPoint();
    const ax = aim[0]! - pos[0]!;
    const az = aim[1]! - pos[1]!;
    const d = Math.hypot(ax, az);
    if (d < 1e-6) return;
    const speed = Math.min(ROAM.speed * pace, Math.sqrt(2 * DECEL * left));
    want[0] = (ax / d) * speed;
    want[1] = (az / d) * speed;
  }

  function accelerate(h: number): void {
    const dx = want[0]! - vel[0]!;
    const dz = want[1]! - vel[1]!;
    const d = Math.hypot(dx, dz);
    const max = (want[0] === 0 && want[1] === 0 ? DECEL : ACCEL * pace) * h;
    if (d <= max) {
      vel[0] = want[0]!;
      vel[1] = want[1]!;
      return;
    }
    vel[0] = vel[0]! + (dx / d) * max;
    vel[1] = vel[1]! + (dz / d) * max;
  }

  return {
    pos,
    vel,
    get busy() {
      return held !== 0 || hasTarget || assisting || vel[0] !== 0 || vel[1] !== 0;
    },
    get assisted() {
      return assisting;
    },
    setHeld(bits) {
      held = bits;
      if (bits !== 0) {
        hasTarget = false;
        assisting = false;
      }
    },
    setPace(k) {
      pace = k;
    },
    setYaw(yaw) {
      cosYaw = Math.cos(yaw);
      sinYaw = Math.sin(yaw);
    },
    walkTo(x, z) {
      assisting = false;
      hasTarget = true;
      stalledS = 0;
      tx = x;
      tz = z;
      settleTarget();
      if (area.props !== undefined) {
        const s = reachOf(area.props, r, pos[0]!, pos[1]!, tx, tz);
        tx = pos[0]! + (tx - pos[0]!) * s;
        tz = pos[1]! + (tz - pos[1]!) * s;
      }
      const px = nx(pos[0]!);
      const pz = nz(pos[1]!);
      const cross = px * nz(tz) - pz * nx(tx);
      side = cross > 0 ? 1 : cross < 0 ? -1 : pos[0]! >= tx ? 1 : -1;
    },
    place(x, z) {
      pos[0] = x;
      pos[1] = z;
      vel[0] = 0;
      vel[1] = 0;
      hasTarget = false;
      assisting = false;
      collide();
    },
    assist(x, z) {
      hasTarget = false;
      assisting = true;
      toX = x;
      toZ = z;
      pathOff0 = pos[1]! - pathOf(pos[0]!);
      pathOff1 = toZ - pathOf(toX);
    },
    assistAt(x, k, dt, jumped) {
      if (!assisting) return;
      const u = Math.min(1, Math.max(0, k));
      const ax = u >= 1 ? toX : x;
      const z = u >= 1 ? toZ : pathOf(ax) + pathOff0 * (1 - u) + pathOff1 * u;
      if (dt > 0 && !jumped) {
        vel[0] = (ax - pos[0]!) / dt;
        vel[1] = (z - pos[1]!) / dt;
      }
      pos[0] = ax;
      pos[1] = z;
      collide();
      if (u >= 1) {
        assisting = false;
        vel[0] = 0;
        vel[1] = 0;
      }
    },
    halt() {
      hasTarget = false;
      assisting = false;
    },
    step(dt) {
      if (assisting || dt <= 0) return;
      const n = Math.ceil(dt / ROAM.maxStepS);
      const h = dt / n;
      const x0 = pos[0]!;
      const z0 = pos[1]!;
      for (let i = 0; i < n; i++) {
        desire();
        accelerate(h);
        pos[0] = pos[0]! + vel[0]! * h;
        pos[1] = pos[1]! + vel[1]! * h;
        collide();
      }
      // The ground actually covered, not the velocity: wedged between the pond and a box corner, each push-out removes
      // only the speed into its own shape, so the body keeps a velocity while it stands still.
      stalledS = hasTarget && Math.hypot(pos[0]! - x0, pos[1]! - z0) / dt < STALL.mps ? stalledS + dt : 0;
      if (stalledS > STALL.s) hasTarget = false;
    },
  };
}
