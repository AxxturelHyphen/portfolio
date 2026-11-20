/**
 * The moth under free roam: it keeps to the grotto's ivy, flitting just out from the curtain. When the visitor's
 * lantern comes near it is drawn out to the flame, circles it a few times, then gives up and drifts home; after a
 * rest it may come again. Reduced motion keeps it at home with its wings still. Frozen time decides from distance
 * alone, with the circling angle from the clock, so a still is the same however it was reached.
 */
import type { Clock, Moth } from '../types.ts';

export const MOTH_ROAM = {
  /** The flame draws the moth out within this distance of its home (metres), and loses it beyond farM. */
  nearM: 3.2,
  farM: 5.5,
  /** Circling time and the rest at home before the flame can draw it out again (s). */
  circleS: 4.5,
  restS: 7,
  /** The ring round the flame: radius (metres), its squash in depth, angular speed (rad/s), height over the flame. */
  circleR: 0.34,
  circleDepth: 0.7,
  circleRadPerS: 3.6,
  circleRise: 0.06,
  /** Home hovers this far out from the curtain toward the walk (metres). */
  homeOut: 0.4,
  /** Path wander (see moth.flutter.ts) per phase. */
  wander: { home: 1.6, seek: 0.5, circle: 0.35, back: 0.8 },
  /** Follow time constants (s) per phase. */
  tauS: { home: 0.7, seek: 0.32, circle: 0.18, back: 0.55 },
  /** Close enough to count as arrived (metres). */
  arriveM: 0.45,
} as const;

type Phase = keyof typeof MOTH_ROAM.wander;

/** The public mode for each phase (types.ts Moth['mode']). */
const MODE: Readonly<Record<Phase, Moth['mode']>> = { home: 'rest', seek: 'follow', circle: 'circle', back: 'flee' };

export interface MothRoam {
  /** Where the flight centre heads this frame (world x, y, z). */
  readonly target: Float32Array;
  readonly mode: Moth['mode'];
  readonly wander: number;
  readonly tauS: number;
  /** A goal in the grotto: circle the flame now, wherever the moth is. */
  celebrate(): void;
  /** Steps the phase from the flame and the moth's current centre `at`. */
  step(c: Clock, reduced: boolean, at: Float32Array): void;
}

export function createMothRoam(flame: Float32Array, home: Float32Array): MothRoam {
  const target = new Float32Array(3);
  let phase: Phase = 'home';
  let timerS = 0;
  let restS = 0;
  let angle = 0;

  const dist = (x: number, y: number, z: number, px: number, py: number, pz: number): number => Math.hypot(x - px, y - py, z - pz);

  function homeTarget(): void {
    target[0] = home[0]!;
    target[1] = home[1]!;
    target[2] = home[2]! + MOTH_ROAM.homeOut;
  }

  function ringTarget(): void {
    target[0] = flame[0]! + Math.cos(angle) * MOTH_ROAM.circleR;
    target[1] = flame[1]! + MOTH_ROAM.circleRise + 0.5 * MOTH_ROAM.circleRise * Math.sin(angle * 1.7);
    target[2] = flame[2]! + Math.sin(angle) * MOTH_ROAM.circleR * MOTH_ROAM.circleDepth;
  }

  function next(dt: number, at: Float32Array): Phase {
    const fromHome = dist(flame[0]!, 0, flame[2]!, home[0]!, 0, home[2]!);
    const lost = fromHome > MOTH_ROAM.farM;
    switch (phase) {
      case 'home':
        restS = Math.max(0, restS - dt);
        return restS === 0 && fromHome < MOTH_ROAM.nearM ? 'seek' : 'home';
      case 'seek':
        if (lost) return 'back';
        if (dist(at[0]!, at[1]!, at[2]!, flame[0]!, flame[1]!, flame[2]!) < MOTH_ROAM.arriveM) {
          timerS = MOTH_ROAM.circleS;
          return 'circle';
        }
        return 'seek';
      case 'circle':
        timerS -= dt;
        return lost || timerS <= 0 ? 'back' : 'circle';
      case 'back':
        if (dist(at[0]!, at[1]!, at[2]!, home[0]!, home[1]!, home[2]! + MOTH_ROAM.homeOut) > MOTH_ROAM.arriveM) return 'back';
        restS = MOTH_ROAM.restS;
        return 'home';
    }
  }

  return {
    target,
    get mode() { return MODE[phase]; },
    get wander() { return MOTH_ROAM.wander[phase]; },
    get tauS() { return MOTH_ROAM.tauS[phase]; },
    celebrate() {
      phase = 'circle';
      timerS = MOTH_ROAM.circleS;
    },
    step(c, reduced, at) {
      if (reduced) {
        phase = 'home';
        homeTarget();
        return;
      }
      if (c.frozen) {
        const near = dist(flame[0]!, 0, flame[2]!, home[0]!, 0, home[2]!) < MOTH_ROAM.nearM;
        phase = near ? 'circle' : 'home';
        angle = MOTH_ROAM.circleRadPerS * c.t;
      } else {
        phase = next(c.dt, at);
        angle += MOTH_ROAM.circleRadPerS * c.dt;
      }
      if (phase === 'home' || phase === 'back') homeTarget();
      else if (phase === 'circle') ringTarget();
      else {
        target[0] = flame[0]!;
        target[1] = flame[1]! + MOTH_ROAM.circleRise;
        target[2] = flame[2]!;
      }
    },
  };
}
