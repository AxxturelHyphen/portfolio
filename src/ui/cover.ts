/**
 * Screen boxes (px) that the open plant tag, the open plan and the first-visit plate take over the garden, written by
 * their owners (ui/label.ts, ui/plan.ts, ui/welcome.ts) outside layout reads, read by the free-roam signposts (ui/signposts.ts) so a cane label
 * never shows half covered. `rev` counts changes, so a reader re-places only when a box moved. No allocation.
 */

export interface ScreenBox { l: number; t: number; r: number; b: number; on: boolean }

const box = (): ScreenBox => ({ l: 0, t: 0, r: 0, b: 0, on: false });

/**
 * card: the plant tag (on phones the sheet over the bottom of the screen); rod: the tag's zinc rod below it (desktop);
 * plate and slip: the first-visit name card and the hint slip under or beside it.
 */
export const covers = { card: box(), rod: box(), plan: box(), plate: box(), slip: box(), rev: 0 };

/** Sets one box; bumps `rev` only when it changed. */
export function setCover(c: ScreenBox, l: number, t: number, r: number, b: number, on = true): void {
  if (c.on === on && (!on || (c.l === l && c.t === t && c.r === r && c.b === b))) return;
  c.l = l;
  c.t = t;
  c.r = r;
  c.b = b;
  c.on = on;
  covers.rev++;
}

export function clearCover(c: ScreenBox): void {
  setCover(c, 0, 0, 0, 0, false);
}

/** Whether the box (l, t, r, b) meets an open cover box. */
export const meetsCover = (c: Readonly<ScreenBox>, l: number, t: number, r: number, b: number): boolean =>
  c.on && l < c.r && r > c.l && t < c.b && b > c.t;
