import type { Leash } from './pet.leash.ts';

/**
 * Where the following cat goes (world/pet.ts moves and poses it): a step or two behind the visitor and to one side,
 * never on them and never much nearer the lens than they are, inside the garden's walls and out of the pond. Nothing
 * turns or swaps on a small move: the visitor's way is read only once they have walked HEAD_M from where it was last
 * read, the side swaps only when the cat is clearly on the other one, the cat sets off only once its spot is START_M
 * away and its card turns only after FLIP_M of travel the other way. The back wall keeps it out of the grotto's room:
 * it waits at the mouth until the visitor comes out (an open project or the Herbario holds the visitor, and so the
 * cat, still). Falling LAG_M behind and catching up asks for a chirp, at most every CHIRP_S.
 * Pure math on its own state: no allocation per step.
 */

/** Metres: behind and beside the visitor, at most this much nearer the lens, the gap kept off them, the walls' margin and the pond's. */
const SPOT = { behind: 1.1, beside: 0.6, lensward: 0.4, clear: 0.55, wall: 0.45, pond: 0.5 } as const;
/** Metres: the visitor's walk that sets its way, the cat's distance to its spot that sets it off and that counts as there. */
const HEAD_M = 0.35;
const START_M = 0.5;
const ARRIVE_M = 0.06;
/** Metres: the cat's travel against its card before the card turns; the visitor must be this far to one side for it to turn to them. */
const FLIP_M = 0.3;
const TURN_TO_M = 0.4;
/** Metres: the swap of sides needs the cat this far past the visitor's line. */
const SWAP_M = 0.6;
/** Pace (m/s) at its spot and when far (beyond FAR_M), so it keeps up with a 3.2 m/s walk. */
const PACE = { near: 2.2, far: 4.4 } as const;
const FAR_M = 2.5;
/** A chirp: fallen this far behind, caught up within CAUGHT_M, at most every CHIRP_S seconds. */
const LAG_M = 4;
const CAUGHT_M = 1.8;
const CHIRP_S = 20;

export interface Follow {
  /** Where the cat stands (x, z) and the x way its card faces (+1 or -1); written by start() and step() only. */
  x: number;
  z: number;
  dir: number;
  moving: boolean;
  /** Seconds it has stood still. */
  still: number;
  /** Starts following from (x, z), its card facing `dir`, with the visitor at (vx, vz). */
  start(x: number, z: number, dir: number, vx: number, vz: number): void;
  /** One step of dt seconds at time t with the visitor at (vx, vz); returns the metres walked. */
  step(vx: number, vz: number, dt: number, t: number): number;
}

export function createFollow(leash: Leash): Follow {
  let side = 1;
  let against = 0;
  /** The visitor's way (unit) and where it was last read. */
  let hx = 0;
  let hz = 1;
  let ax = 0;
  let az = 0;
  let lagging = false;
  let chirpAt = -Infinity;

  /** Moves (px, pz) into the garden and out of the pond; writes the result to `out`. */
  const out = { x: 0, z: 0 };
  function keepIn(px: number, pz: number): void {
    const a = leash.area;
    out.x = px;
    out.z = pz;
    if (a === null) return;
    const p = a.pond;
    const ex = (px - p.x) / (p.rx + SPOT.pond);
    const ez = (pz - p.z) / (p.rz + SPOT.pond);
    const e = Math.hypot(ex, ez);
    if (e < 1) {
      out.x = p.x + (e > 1e-4 ? ex / e : 0) * (p.rx + SPOT.pond);
      out.z = p.z + (e > 1e-4 ? ez / e : 1) * (p.rz + SPOT.pond);
    }
    out.x = Math.min(a.maxX - SPOT.wall, Math.max(a.minX + SPOT.wall, out.x));
    out.z = Math.min(a.front - SPOT.wall, Math.max(a.back + SPOT.wall, out.z));
  }

  const f: Follow = {
    x: 0,
    z: 0,
    dir: 1,
    moving: false,
    still: 0,
    start(x0, z0, dir0, vx, vz) {
      f.x = x0;
      f.z = z0;
      f.dir = dir0;
      f.moving = false;
      f.still = 0;
      against = 0;
      const d = Math.hypot(vx - x0, vz - z0);
      hx = d > 1e-3 ? (vx - x0) / d : 0;
      hz = d > 1e-3 ? (vz - z0) / d : 1;
      ax = vx;
      az = vz;
      side = (x0 - vx) * -hz + (z0 - vz) * hx >= 0 ? 1 : -1;
    },
    step(vx, vz, dt, t) {
      const walked = Math.hypot(vx - ax, vz - az);
      if (walked > HEAD_M) {
        hx = (vx - ax) / walked;
        hz = (vz - az) / walked;
        ax = vx;
        az = vz;
      }
      const across = (f.x - vx) * -hz + (f.z - vz) * hx;
      if (across * side < -SWAP_M) side = -side;
      keepIn(vx - hx * SPOT.behind - hz * side * SPOT.beside, Math.min(vz + SPOT.lensward, vz - hz * SPOT.behind + hx * side * SPOT.beside));
      const tx = out.x;
      const tz = out.z;
      const gap = Math.hypot(vx - f.x, vz - f.z);
      if (gap > LAG_M) lagging = true;
      else if (lagging && gap < CAUGHT_M) {
        lagging = false;
        if (t - chirpAt >= CHIRP_S) {
          chirpAt = t;
          leash.chirps += 1;
        }
      }
      const d = Math.hypot(tx - f.x, tz - f.z);
      if (!f.moving && d > START_M) f.moving = true;
      else if (f.moving && d < ARRIVE_M) {
        f.moving = false;
        if (Math.abs(vx - f.x) > TURN_TO_M) f.dir = Math.sign(vx - f.x);
      }
      if (!f.moving) {
        f.still += dt;
        return 0;
      }
      f.still = 0;
      const pace = PACE.near + (PACE.far - PACE.near) * Math.min(1, Math.max(0, (d - START_M) / (FAR_M - START_M)));
      const k = Math.min(1, (pace * dt) / d);
      let nx = f.x + (tx - f.x) * k;
      let nz = f.z + (tz - f.z) * k;
      const off = Math.hypot(nx - vx, nz - vz);
      if (off < SPOT.clear && off > 1e-4) {
        nx = vx + ((nx - vx) / off) * SPOT.clear;
        nz = vz + ((nz - vz) / off) * SPOT.clear;
      }
      keepIn(nx, nz);
      const dx = out.x - f.x;
      const moved = Math.hypot(dx, out.z - f.z);
      against = Math.sign(dx) === -f.dir ? against + Math.abs(dx) : 0;
      if (against > FLIP_M) {
        f.dir = -f.dir;
        against = 0;
      }
      f.x = out.x;
      f.z = out.z;
      return moved;
    },
  };
  return f;
}
