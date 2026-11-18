/**
 * The camera the world is built for: free roam (the default, cook/ROAM_PLAN.md P7) or the rail views (`?roam=0`, kept
 * for one release). Set once at start, before the garden builds; beds and the ground read it when they build, never
 * per frame.
 */
export type WorldMode = 'rail' | 'roam';

let active: WorldMode = 'rail';

export function setWorldMode(mode: WorldMode): void {
  active = mode;
}

export const worldMode = (): WorldMode => active;

/**
 * The world mode a visit asks for: `?roam=0` the rail, `?roam=1` free roam; a shot (`?shot=`, as the debug params
 * parsed it) keeps the rail world and its camera presets, so the stills stay comparable, unless it is a roam shot;
 * anything else roams.
 */
export function worldModeOf(roam: string | null, shot: string | undefined, isRoamShot: (id: string) => boolean): WorldMode {
  if (roam === '0') return 'rail';
  if (roam === '1') return 'roam';
  return shot === undefined || isRoamShot(shot) ? 'roam' : 'rail';
}

/** A scene item marked `only` is built in that mode alone; unmarked items are built in both. */
export const builtIn = (item: { only?: WorldMode }, mode: WorldMode): boolean => item.only === undefined || item.only === mode;
