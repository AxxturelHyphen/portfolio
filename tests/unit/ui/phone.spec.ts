import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { APPROACH_FIT } from '../../../src/core/motion.ts';
import { DOCK, dockAround, type DockBox, type FigureBox } from '../../../src/ui/signs.stake.ts';
import { blendFraming, followPose, moonElevation, paramsFor, viewLimitsOf, type Framing, type FramingParams } from '../../../src/world/follow.ts';
import { FIGURE } from '../../../src/world/puppet.ts';
import type { RigPose } from '../../../src/world/rail.ts';
import { traceLayout } from '../world/rig.trace.ts';

// Free roam on portrait screens: the docked cane labels never cross the visitor's figure, each other, the top row of
// tags or the folded plan; they stay thumb sized; and the moon hangs whole over the back wall in every portrait framing.

const SIZES = [[390, 844], [360, 800], [800, 1200]] as const;
const DEG = Math.PI / 180;
const limits = viewLimitsOf(traceLayout.ground.enclosure, traceLayout.ground.wall.z);
const WALL = traceLayout.ground.wall;
const WALK = traceLayout.ground.enclosure.walk;
/** The moon's disc radius (degrees), halo edge included, as it renders at 390x844. */
const MOON_R = 1.45;
/** The farthest the per-place moon stands from straight ahead (degrees, La Puerta in garden/place.ts). */
const MOON_SIDE_DEG = 10;
/**
 * Whole boxes of docked labels (label turned by its tilt, lashing and cane included), as ui/signposts.ts sizes them on
 * phones and the tablet: one-line names and the two-line "Estanque de la Luna".
 */
const LABELS = [[154, 47], [181, 55], [169, 54], [162, 51], [243, 78], [231, 64]] as const;
const PLAN = { w: 176, h: 124 } as const;
const TOP_ROW_PX = 66;

const blank = (): FramingParams => ({ up: 0, downDeg: 0, fov: 0, moonAt: 0, at: 0 });

/** Screen y share (from the top) of a point for a yaw 0 pose. */
function screenY(p: Readonly<RigPose>, y: number, z: number): number {
  const t = Math.tan((p.fov * DEG) / 2);
  const cp = Math.cos(p.pitch);
  const sp = Math.sin(p.pitch);
  const dy = y - p.y;
  const dz = z - p.z;
  return 0.5 - (dy * cp + dz * sp) / ((dy * sp - dz * cp) * 2 * t);
}

/** The walking pose of a visitor at (x, z) on a w x h portrait screen. */
function walkPose(x: number, z: number, w: number, h: number): RigPose {
  const walk = paramsFor(w / h, false, blank());
  const f = blendFraming(w / h, 0, walk, paramsFor(w / h, true, blank()), blank(), {} as Framing);
  return followPose(x, z, f, limits, { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, fov: 0 });
}

const box = (w: number, h: number): DockBox => ({ w, h, x: 0, y: 0, on: true });
const meets = (a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }): boolean =>
  a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const rectOf = (d: DockBox): FigureBox => ({ l: d.x, r: d.x + d.w, t: d.y - DOCK.tipPx, b: d.y + d.h });

test('the docked labels never meet the figure, each other, the top row or the plan, for a grid of visitor places', () => {
  const plan = (hh: number): FigureBox => ({ l: 0, r: PLAN.w, t: hh - PLAN.h, b: hh });
  const seen: string[] = [];
  for (const [w, h] of SIZES) {
    for (let z = WALK.minZ; z <= WALK.maxZ; z += 0.5) {
      const pose = walkPose(20, z, w, h);
      const feet = screenY(pose, 0, z) * h;
      const hat = screenY(pose, FIGURE.topM * FIGURE.portraitK, z) * h;
      const half = ((feet - hat) / (FIGURE.topM * FIGURE.portraitK)) * 0.45;
      for (let share = 0.22; share <= 0.78; share += 0.08) {
        const fig: FigureBox = { l: share * w - half, r: share * w + half, t: hat, b: feet };
        for (const [pw, ph] of LABELS) {
          for (const [nw, nh] of LABELS) {
            for (const high of [false, true]) {
              const prev = box(pw, ph);
              const next = box(nw, nh);
              const where = `${w}x${h} z ${z} at ${share.toFixed(2)} ${pw}/${nw}${high ? ' high' : ''}`;
              if (!dockAround(fig, w, h, prev, next, high)) {
                seen.push(`no band ${where}`);
                continue;
              }
              const a = rectOf(prev);
              const b = rectOf(next);
              if (meets(a, fig) || meets(b, fig)) seen.push(`figure ${where}`);
              if (meets(a, b)) seen.push(`stacked ${where}`);
              if (Math.min(a.t, b.t) <= TOP_ROW_PX) seen.push(`top row ${where}`);
              if (meets(a, plan(h)) || meets(b, plan(h))) seen.push(`plan ${where}`);
              if (Math.max(a.b, b.b) > h || Math.min(a.l, b.l) < 0 || Math.max(a.r, b.r) > w) seen.push(`off screen ${where}`);
            }
          }
        }
      }
    }
  }
  expect(seen.length, seen.slice(0, 8).join('\n')).toBe(0);
});

test('La Puerta and the two-line Estanque de la Luna stand on one row at 360 px, flush to the edges, 8 px apart or more', () => {
  const fig: FigureBox = { l: 135, r: 225, t: 389, b: 496 };
  const prev = box(152 + 4 + 3, 44 + 8);
  const next = box(159 + 4 + 3, 46 + 9);
  expect(dockAround(fig, 360, 800, prev, next, false, 0, 0)).toBe(true);
  expect(prev.x).toBe(DOCK.sidePx);
  expect(next.x + next.w).toBe(360 - DOCK.sidePx);
  expect(next.x - (prev.x + prev.w)).toBeGreaterThanOrEqual(DOCK.gapPx);
  expect(next.y - prev.y, 'the way on stands only a step lower, not under the way back').toBe(DOCK.stepPx);
  expect(dockAround(fig, 360, 800, box(159, 52), box(166, 55), false, 20, 12)).toBe(true);
});

test('one docked label alone takes the first row; none docked leaves both untouched', () => {
  const fig: FigureBox = { l: 150, r: 240, t: 386, b: 523 };
  const prev = box(162, 51);
  const next = { ...box(169, 54), on: false };
  expect(dockAround(fig, 390, 844, prev, next)).toBe(true);
  expect(prev.y).toBe(fig.b + DOCK.gapPx + DOCK.tipPx);
});

test('phone labels keep 44 px targets, run on one line or two by rule, and at most two signs exist', () => {
  const css = readFileSync(new URL('../../../src/ui/styles/signs.css', import.meta.url), 'utf8');
  const base = readFileSync(new URL('../../../src/ui/styles/base.css', import.meta.url), 'utf8');
  expect(base).toMatch(/--target:\s*44px/);
  expect(css).toMatch(/\.px-signs \.px-sign \{[^}]*min-height: var\(--target\)/);
  expect(css).toMatch(/max-aspect-ratio: 4\/5\)[^@]*\.px-signs\[data-roam\] \.px-sign \{[^}]*white-space: nowrap/);
  const ts = readFileSync(new URL('../../../src/ui/signposts.ts', import.meta.url), 'utf8');
  expect(ts).toMatch(/const signs = \[makeSign\(-1, m\), makeSign\(1, m\)\] as const;/);
  for (const [, lh] of LABELS) expect(lh).toBeGreaterThanOrEqual(44);
});

test('on portrait the moon hangs whole over the back wall at every visitor place, walking, near and nudged', () => {
  for (const [w, h] of SIZES) {
    const aspect = w / h;
    const walk = paramsFor(aspect, false, blank());
    const near = paramsFor(aspect, true, blank());
    for (let k = 0; k <= 1; k += 0.25) {
      const f = blendFraming(aspect, k, walk, near, blank(), {} as Framing);
      const moonLow = moonElevation(f) - MOON_R;
      for (let z = WALK.minZ; z <= WALK.maxZ; z += 0.25) {
        const p = followPose(20, z, f, limits, { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, fov: 0 });
        for (const nudge of [0, 1]) {
          const y = p.y + (0.5 - p.y) * APPROACH_FIT.nudge * APPROACH_FIT.nudgeY * nudge;
          const cz = p.z + (z - p.z) * APPROACH_FIT.nudge * nudge;
          const wallTop = Math.atan2(WALL.h - y, cz - WALL.z) / DEG;
          expect(moonLow, `${w}x${h} k ${k} z ${z} nudge ${nudge}`).toBeGreaterThan(wallTop + 0.2);
        }
      }
      expect(f.moonAt * h, 'the moon clears the top row of tags only by side, so it hangs high in the sky band').toBeLessThan(0.1 * h);
      const side = Math.atan(aspect * Math.tan((f.fov * DEG) / 2)) / DEG;
      expect(side, `${w}x${h} k ${k}: the moon farthest aside (La Puerta, 10 degrees left, garden/place.ts) stays in the frame`)
        .toBeGreaterThan(MOON_SIDE_DEG + MOON_R);
    }
  }
});

test('the portrait walking framing shows the figure at least 13 percent of the frame tall', () => {
  for (const [w, h] of SIZES) {
    for (let z = WALK.minZ; z <= WALK.maxZ; z += 0.5) {
      const pose = walkPose(20, z, w, h);
      const tall = screenY(pose, 0, z) - screenY(pose, FIGURE.topM * FIGURE.portraitK, z);
      expect(tall, `${w}x${h} z ${z}`).toBeGreaterThan(0.13);
    }
  }
});
