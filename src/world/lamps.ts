/**
 * The lanterns that burn with their own amber light under free roam (cook/ROAM_PLAN.md 3, P5; cook/ROAM_LOOK.md C):
 * lamp 0 is the lantern the visitor carries, lamps 1 to 5 the standing lantern props nearest the visitor on screen,
 * picked from the active bed and its neighbours (the low tier lights two of them). Each lamp is a vec4 (flame xyz,
 * strength) in one flat array, the layout of the shader's uLamp[6].
 */
import { follow } from '../core/motion.ts';
import { terrainY } from '../core/terrain.ts';
import type { BedId } from '../types.ts';
import type { BedScene3 } from './layout.ts';
import { builtIn } from './mode.ts';

export const LAMPS = {
  /** Lamps in the shader: the carried lantern and up to `standing` props. */
  count: 6,
  standing: 5,
  /** Standing lamps the low tier lights (the shader loop skips dark ones). */
  standingLow: 2,
  /** Standing lanterns found round the active bed (its own and both neighbours'). */
  candidates: 12,
  prefix: 'sh/lantern',
  /** The flame sits at this share of a standing prop's height (the candle inside the cage). */
  flameOfHeight: 0.55,
  defaultH: 0.4,
  /** A standing lamp lights up and dims on this follower as it enters or leaves the pick, so no pool pops. */
  fadeTauS: 0.35,
  /** A lamp slot hands its flame over to a nearer lantern once it has dimmed under this strength. */
  handOver: 0.04,
} as const;

/** The standing lanterns round the active bed and which lamp slot each one burns in. Allocated once. */
export interface LampPool {
  /** Flame xyz of each found lantern, LAMPS.candidates vec3s. */
  readonly at: Float32Array;
  n: number;
  /** Per lamp slot (lamps 1..standing): the lantern burning in it, or -1. */
  readonly slot: Int8Array;
  /** Per lantern: the slot it burns in, or -1. */
  readonly held: Int8Array;
  readonly want: Uint8Array;
}

export function createLampPool(): LampPool {
  return {
    at: new Float32Array(LAMPS.candidates * 3),
    n: 0,
    slot: new Int8Array(LAMPS.standing).fill(-1),
    held: new Int8Array(LAMPS.candidates).fill(-1),
    want: new Uint8Array(LAMPS.candidates),
  };
}

/**
 * Collects the flames of the standing lantern props free roam builds in `scenes` (the active bed and its neighbours),
 * at most LAMPS.candidates, lifted onto the ground they stand on (core/terrain.ts, as gl/instances.ts lifts the props).
 * A lantern already burning in `lamps` keeps its slot and strength, so a bed change never pops a pool; the rest of the
 * slots go dark. Runs on a bed change, never per frame. Returns how many were found.
 */
export function findLamps(scenes: readonly (BedScene3 | null)[], pool: LampPool, lamps: Float32Array): number {
  let n = 0;
  for (const scene of scenes) {
    if (scene === null) continue;
    for (const layer of scene.layers) {
      for (const it of layer.items) {
        if (n >= LAMPS.candidates || !it.sprite.startsWith(LAMPS.prefix) || !builtIn(it, 'roam')) continue;
        pool.at[n * 3] = it.x;
        pool.at[n * 3 + 1] = it.y + terrainY(it.x, it.z) + (it.h ?? LAMPS.defaultH) * it.scale * LAMPS.flameOfHeight;
        pool.at[n * 3 + 2] = it.z;
        n++;
      }
    }
  }
  pool.n = n;
  pool.held.fill(-1);
  for (let j = 0; j < LAMPS.standing; j++) {
    const o = (j + 1) * 4;
    let keep = -1;
    for (let c = 0; c < n && lamps[o + 3]! > 0; c++) {
      if (pool.held[c] === -1 && pool.at[c * 3] === lamps[o] && pool.at[c * 3 + 1] === lamps[o + 1] && pool.at[c * 3 + 2] === lamps[o + 2]) keep = c;
    }
    pool.slot[j] = keep;
    if (keep >= 0) pool.held[keep] = j;
    else lamps[o + 3] = 0;
  }
  return n;
}

/** The beds whose lanterns may burn while the visitor is in `bed`: it and its neighbours along the path (the grotto alone). */
export function lampBedsOf(order: readonly BedId[], bed: BedId): BedId[] {
  if (bed === 'gruta') return [bed];
  const path = order.filter((b) => b !== 'gruta');
  const i = path.indexOf(bed);
  return path.slice(Math.max(0, i - 1), i + 2);
}

/** Whether a world point is on screen (the rig's projection). */
export type OnScreen = (x: number, y: number, z: number) => boolean;

/** Marks in pool.want the `budget` lanterns nearest the visitor's ground point (cx, cz) that are on screen. */
function pickNearest(pool: LampPool, cx: number, cz: number, budget: number, onScreen: OnScreen): void {
  const { at, want } = pool;
  for (let c = 0; c < pool.n; c++) want[c] = onScreen(at[c * 3]!, at[c * 3 + 1]!, at[c * 3 + 2]!) ? 2 : 0;
  for (let k = 0; k < budget; k++) {
    let best = -1;
    let bestD = Infinity;
    for (let c = 0; c < pool.n; c++) {
      if (want[c] !== 2) continue;
      const d = (at[c * 3]! - cx) ** 2 + (at[c * 3 + 2]! - cz) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best < 0) break;
    want[best] = 1;
  }
}

/**
 * One frame of the lamp list: the carried flame (strength 1) first, then up to `budget` standing lamps, the lanterns
 * nearest the visitor on screen. A slot whose lantern drops out of the pick dims and then hands over to the next one,
 * so pools fade in and out and never pop (snapped under frozen time). `out` gets LAMPS.count vec4s. No allocation.
 */
export function stepLamps(out: Float32Array, cx: number, cy: number, cz: number, pool: LampPool, budget: number,
  onScreen: OnScreen, dt: number, snap: boolean): void {
  out[0] = cx;
  out[1] = cy;
  out[2] = cz;
  out[3] = 1;
  pickNearest(pool, cx, cz, budget, onScreen);
  const { slot, held, want, at } = pool;
  for (let j = 0; j < LAMPS.standing; j++) {
    const c = slot[j]!;
    const o = (j + 1) * 4;
    if (c >= 0 && (want[c] !== 1 || j >= budget) && (snap || out[o + 3]! < LAMPS.handOver)) {
      held[c] = -1;
      slot[j] = -1;
      out[o + 3] = 0;
    }
  }
  for (let c = 0; c < pool.n; c++) {
    if (want[c] !== 1 || held[c] !== -1) continue;
    let free = -1;
    for (let j = budget - 1; j >= 0; j--) if (slot[j] === -1) free = j;
    if (free < 0) break;
    slot[free] = c;
    held[c] = free;
    const o = (free + 1) * 4;
    out[o] = at[c * 3]!;
    out[o + 1] = at[c * 3 + 1]!;
    out[o + 2] = at[c * 3 + 2]!;
    out[o + 3] = 0;
  }
  for (let j = 0; j < LAMPS.standing; j++) {
    const c = slot[j]!;
    const o = (j + 1) * 4;
    const target = c >= 0 && want[c] === 1 && j < budget ? 1 : 0;
    out[o + 3] = snap ? target : follow(out[o + 3]!, target, LAMPS.fadeTauS, dt);
  }
}
