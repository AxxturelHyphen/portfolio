import { channelsSettled } from '../core/loop.ts';
import type { Clock, Machine } from '../types.ts';
import { setGateSwing } from '../world/gates.ts';
import type { RigPose } from '../world/rail.ts';

/**
 * The opening of a first visit under free roam: once the cold start has come down to the gate, the iron gates of La
 * Puerta swing open on their hinges (world/gates.ts), the follow camera glides in from a little higher and further back
 * to its place behind the visitor, and the visitor's lantern catches at the end. Any key, click, tap, navigation or opened project lands it at once;
 * reduced motion, frozen time and a returning visitor start at the end. Until it ends the drive counts as busy, so the
 * first visit's plate waits for it. No allocation per frame.
 */

export const ARRIVAL = {
  /** The camera's glide in (s) and how much higher (m) and further back (m) it starts. */
  glideS: 3,
  upM: 1.6,
  backM: 2.4,
  /** The gates' swing: when it starts and how long it lasts (s from the start of the opening). */
  gateFromS: 0.15,
  gateS: 2.6,
  /** The lantern catching: when and how long (s). */
  flameFromS: 2.35,
  flameS: 0.65,
  /** The longest the opening waits for the gate to come in (s) before it lets go and ends. */
  waitS: 12,
  /** localStorage key: the opening has played in this browser. */
  seenKey: 'jardin.arrived',
} as const;

export interface Arrival {
  /** True until the opening has ended (played, skipped or never wanted). */
  readonly busy: boolean;
  /** The carried lantern's strength share (0 dark, 1 burning), with the flicker of a wick catching. */
  readonly flame: number;
  /**
   * One frame of the garden being shown: `ready` once the cold start has come down (the clock starts then), `still`
   * under reduced motion or frozen time (the opening ends at once).
   */
  step(dt: number, ready: boolean, still: boolean): void;
  /** Lands the opening at once (a project opened: on phones its panel pauses the loop that would step it). */
  skip(): void;
  /** Lifts and pulls back a follow pose by what is left of the glide. */
  shape(pose: RigPose): void;
  /** Writes the carried lantern's strength (lamp 0) into a lamp list while the opening plays; returns the list. */
  carried(lamps: Float32Array): Float32Array;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

function seen(): boolean {
  try {
    return globalThis.localStorage?.getItem(ARRIVAL.seenKey) === '1';
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    globalThis.localStorage?.setItem(ARRIVAL.seenKey, '1');
  } catch {
    /* storage blocked: the opening plays again next visit */
  }
}

/** `wanted`: the visit may open with it (free roam, no still, no project deep link); a returning visitor never sees it. */
export function createArrival(wanted: boolean): Arrival {
  let done = !wanted || seen();
  let t = 0;
  let waited = 0;
  let glide = done ? 1 : 0;
  let flame = done ? 1 : 0;
  const listen = new AbortController();

  function end(): void {
    if (done) return;
    done = true;
    glide = 1;
    flame = 1;
    setGateSwing(1);
    listen.abort();
    remember();
  }

  if (!done) {
    setGateSwing(0);
    const opts = { capture: true, passive: true, signal: listen.signal };
    window.addEventListener('keydown', end, opts);
    window.addEventListener('pointerdown', end, opts);
    window.addEventListener('hashchange', end, opts);
  }

  return {
    skip: end,
    get busy() {
      return !done;
    },
    get flame() {
      return flame;
    },
    step(dt, ready, still) {
      if (done) return;
      if (still) {
        end();
        return;
      }
      if (!ready && t === 0) {
        waited += dt;
        if (waited >= ARRIVAL.waitS) end();
        return;
      }
      t += dt;
      glide = easeInOut(clamp01(t / ARRIVAL.glideS));
      setGateSwing(clamp01((t - ARRIVAL.gateFromS) / ARRIVAL.gateS));
      const u = clamp01((t - ARRIVAL.flameFromS) / ARRIVAL.flameS);
      flame = u * u * (3 - 2 * u) * (1 + 0.4 * Math.sin(u * 37) * Math.sin(u * 11) * (1 - u));
      if (t >= Math.max(ARRIVAL.glideS, ARRIVAL.gateFromS + ARRIVAL.gateS, ARRIVAL.flameFromS + ARRIVAL.flameS)) end();
    },
    shape(pose) {
      const k = 1 - glide;
      if (k === 0) return;
      pose.y += ARRIVAL.upM * k;
      pose.z += ARRIVAL.backM * k;
    },
    carried(lamps) {
      if (!done) lamps[3] = flame;
      return lamps;
    },
  };
}

/** Stage 'camera', before the follow: the opening runs while the garden shows and starts once the cold start landed. */
export function driveArrival(a: Arrival, c: Clock, m: Machine): void {
  const s = m.state;
  if (s.mode !== 'garden') return;
  a.step(c.dt, channelsSettled(m) && (s.phase === 'bed' || s.phase === 'focus'), c.frozen || s.reduced);
}
