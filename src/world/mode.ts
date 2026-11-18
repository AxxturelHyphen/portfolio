/**
 * The camera the world is built for: the rail views, or free roam (`?roam=1`, cook/ROAM_ART.md 2). Set once at start,
 * before the garden builds; beds and the ground read it when they build, never per frame.
 */
export type WorldMode = 'rail' | 'roam';

let active: WorldMode = 'rail';

export function setWorldMode(mode: WorldMode): void {
  active = mode;
}

export const worldMode = (): WorldMode => active;

/** A scene item marked `only` is built in that mode alone; unmarked items are built in both. */
export const builtIn = (item: { only?: WorldMode }, mode: WorldMode): boolean => item.only === undefined || item.only === mode;
