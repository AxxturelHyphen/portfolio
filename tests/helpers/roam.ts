import type { Page } from '@playwright/test';
import { expect, PROJECTS, type Jardin } from './jardin.ts';

// Shared steps of the free roam specs (free roam is the default): enter on a bed, read the visitor, find open ground on
// screen, wait for proximity focus on a frame-exact poll.

export type At = { x: number; z: number };

export const roamAt = (j: Jardin): Promise<At> => j.withApi((api) => api.roam() as At);

export async function enterRoam(j: Jardin, hash = '#/', query: Record<string, string> = {}): Promise<void> {
  await j.visit({ mode: 'garden', hash, query });
  await j.withApi((api) => api.ready);
  await expect.poll(() => j.withApi((api) => api.state().phase), { timeout: 15000 }).toBe('bed');
  await j.settled();
}

/** Waits (polling every frame) until proximity or a tap focused a slot of `bed`; returns the slot id. */
export async function focusIn(page: Page, bed: string, timeout = 15000): Promise<string> {
  const handle = await page.waitForFunction((b) => {
    const s = window.__jardin?.state();
    return s !== undefined && s.phase === 'focus' && s.slot !== null && s.slot.startsWith(`${b}/`) ? s.slot : null;
  }, bed, { polling: 'raf', timeout });
  return (await handle.jsonValue()) as string;
}

/** Resolves once the visitor has not moved for a few frames. */
export async function untilStill(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as { __still?: { x: number; z: number; n: number } };
    const p = window.__jardin?.roam();
    if (!p) return false;
    const last = w.__still;
    w.__still = { x: p.x, z: p.z, n: last !== undefined && last.x === p.x && last.z === p.z ? last.n + 1 : 0 };
    return w.__still.n >= 5;
  }, null, { polling: 'raf', timeout: 8000 });
}

/** Resolves once the camera pose has not changed for a few frames (follow lag and focus nudge at rest). */
export async function untilCameraStill(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as { __camStill?: { key: string; n: number } };
    const c = window.__jardin?.camera();
    if (!c) return false;
    const key = `${c.x},${c.y},${c.z},${c.pitch},${c.fov}`;
    w.__camStill = { key, n: w.__camStill?.key === key ? w.__camStill.n + 1 : 0 };
    return w.__camStill.n >= 5;
  }, null, { polling: 'raf', timeout: 8000 });
}

/** The project a slot proxy opens. */
export async function projectOfSlot(page: Page, slot: string): Promise<(typeof PROJECTS)[number]> {
  const id = await page.locator(`#proxies [data-slot="${slot}"]`).getAttribute('data-project');
  const p = PROJECTS.find((x) => x.id === id);
  if (p === undefined) throw new Error(`slot ${slot} opens no known project (${String(id)})`);
  return p;
}

/** The camera pose's largest difference from `p0` over x, y, z, pitch and fov. */
export function poseDrift(j: Jardin, p0: Record<string, number>): Promise<number> {
  return j.withApi((api, base: Record<string, number>) => {
    const pose = api.camera() as unknown as Record<string, number>;
    return Math.max(...['x', 'y', 'z', 'pitch', 'fov'].map((k) => Math.abs((pose[k] as number) - (base[k] as number))));
  }, p0);
}

/** The ground point (y 0) under a CSS pixel for the current camera pose (yaw 0, as the follow camera keeps it). */
export async function groundUnder(page: Page, j: Jardin, sx: number, sy: number): Promise<At> {
  const pose = await j.withApi((api) => api.camera());
  const vp = page.viewportSize() ?? { width: 1, height: 1 };
  const t = Math.tan((pose.fov * Math.PI) / 360);
  const nx = (2 * sx) / vp.width - 1;
  const ny = 1 - (2 * sy) / vp.height;
  const wy = ny * t * Math.cos(pose.pitch) + Math.sin(pose.pitch);
  const wz = ny * t * Math.sin(pose.pitch) - Math.cos(pose.pitch);
  const k = -pose.y / wy;
  return { x: pose.x + k * nx * t * (vp.width / vp.height), z: pose.z + k * wz };
}

/** A screen point over bare canvas (no proxy, sign or plan on top), from a few candidates low in the frame. */
export async function openGround(page: Page): Promise<[number, number]> {
  const vp = page.viewportSize() ?? { width: 1, height: 1 };
  for (const [fx, fy] of [[0.7, 0.62], [0.3, 0.62], [0.7, 0.8], [0.3, 0.8], [0.5, 0.85]] as const) {
    const x = Math.round(fx * vp.width);
    const y = Math.round(fy * vp.height);
    const onCanvas = await page.evaluate(([px, py]) => document.elementFromPoint(px as number, py as number)?.tagName === 'CANVAS', [x, y]);
    if (onCanvas) return [x, y];
  }
  throw new Error('no open patch of ground on screen');
}
