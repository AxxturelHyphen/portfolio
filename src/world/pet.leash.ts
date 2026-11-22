/**
 * The cat's leash: clicked in free roam, the Rosaleda cat follows the visitor for the rest of the visit (world/pet.ts
 * walks it, world/pet.follow.ts steers it inside the garden's walls, from garden.json). Remembered for the browser
 * session in sessionStorage, so a reload keeps it following; the play layer's start over lets it go (ui/play.ts). The
 * pet says when it is on its way (the chalk drive keeps the loop awake then, garden/chalk.drive.ts) and counts its
 * catch-ups, each a chirp for the sound (garden/sound.ts); the chalk note by the bench rubs out once it is tied.
 * Storage can be missing or throw: the cat then follows for this page only.
 */

import garden from '../../content/garden.json' with { type: 'json' };
import type { KeyValue } from './memory.ts';

export const LEASH_KEY = 'jardin.cat';

/** Where the cat may walk: the garden inside its walls (x between the end walls, z from the back wall to the kerb) and the pond it keeps out of. */
export interface LeashArea {
  minX: number;
  maxX: number;
  back: number;
  front: number;
  pond: { x: number; z: number; rx: number; rz: number };
}

export interface Leash {
  /** The cat follows the visitor. */
  readonly on: boolean;
  /** Ties it (the cat was clicked in free roam); remembered for the session. */
  tie(): void;
  /** Lets it go (start over); the cat goes back to sleep on its bench. */
  release(): void;
  /** The cat is on its way somewhere: the loop must not idle. */
  moving: boolean;
  /** Catch-ups after falling well behind; each asks for a chirp. */
  chirps: number;
  /** The garden it may walk (none: anywhere). */
  area: LeashArea | null;
  /** Where it stands while it follows ([x, z], NaN otherwise); read by the test API. */
  readonly at: Float32Array;
}

function sessionStore(): KeyValue | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function createLeash(store: KeyValue | null = sessionStore(), area: LeashArea | null = null): Leash {
  let on = store?.getItem(LEASH_KEY) === '1';
  const save = (): void => {
    try {
      store?.setItem(LEASH_KEY, on ? '1' : '0');
    } catch {
      /* storage blocked: remembered for this page only */
    }
  };
  return {
    get on() {
      return on;
    },
    tie() {
      if (on) return;
      on = true;
      save();
    },
    release() {
      on = false;
      save();
    },
    moving: false,
    chirps: 0,
    area,
    at: new Float32Array([Number.NaN, Number.NaN]),
  };
}

/** The closed garden: between its end walls, from the back wall to the kerb, and its pond. */
const { enclosure, wall, pond } = garden.ground;
export const GARDEN_AREA: LeashArea = { minX: enclosure.x[0]!, maxX: enclosure.x[1]!, back: wall.z, front: enclosure.front, pond };

/** The garden's one cat leash. */
export const catLeash: Leash = createLeash(sessionStore(), GARDEN_AREA);
