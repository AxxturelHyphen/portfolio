import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { APPROACH_FIT } from '../../../src/core/motion.ts';
import { DOCK, dockAround, type DockBox, type DockRoom } from '../../../src/ui/signs.dock.ts';
import type { FigureBox } from '../../../src/ui/signs.stake.ts';
import { clearCover, covers, meetsCover, setCover } from '../../../src/ui/cover.ts';
import { blendFraming, followPose, moonElevation, paramsFor, viewLimitsOf, type Framing, type FramingParams } from '../../../src/world/follow.ts';
import { FIGURE } from '../../../src/world/puppet.ts';
import type { RigPose } from '../../../src/world/rail.ts';
import { traceLayout } from '../world/rig.trace.ts';

// Free roam on portrait screens: the docked cane labels never cross the visitor's figure, each other, the top row of
// tags, the folded plan, the plant sheet or the flowers they keep off; a pair shares one centred row 24 px apart where
// it fits; they stay thumb sized; and the moon hangs whole over the back wall in every portrait framing.

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
const rectOf = (d: DockBox): FigureBox => ({ l: d.x, r: d.x + d.w, t: d.y, b: d.y + d.h });
const roomOf = (fig: FigureBox, vw: number, vh: number, floor = vh, avoid: FigureBox[] = []): DockRoom =>
  ({ fig, vw, vh, safeLeft: 0, safeRight: 0, floor, avoid, avoidN: avoid.length });
/** The plant sheet's top on a phone (ui/label.ts: about 190 px tall, 10 px over the bottom edge). */
const SHEET_PX = 200;

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
            for (const up of [false, true]) {
              const prev = box(pw, ph);
              const next = box(nw, nh);
              const where = `${w}x${h} z ${z} at ${share.toFixed(2)} ${pw}/${nw}${up ? ' sheet' : ''}`;
              const floor = up ? h - SHEET_PX : h;
              if (!dockAround(roomOf(fig, w, h, floor), prev, next)) {
                if (!up) seen.push(`no band ${where}`);
                continue;
              }
              const a = rectOf(prev);
              const b = rectOf(next);
              if (meets(a, fig) || meets(b, fig)) seen.push(`figure ${where}`);
              if (meets(a, b)) seen.push(`stacked ${where}`);
              if (Math.min(a.t, b.t) <= TOP_ROW_PX) seen.push(`top row ${where}`);
              if (meets(a, plan(h)) || meets(b, plan(h))) seen.push(`plan ${where}`);
              if (Math.max(a.b, b.b) > floor) seen.push(`under the sheet ${where}`);
              if (up && Math.min(a.t, b.t) < fig.b) seen.push(`sheet up, not at ground level ${where}`);
              if (Math.max(a.b, b.b) > h || Math.min(a.l, b.l) < 0 || Math.max(a.r, b.r) > w) seen.push(`off screen ${where}`);
            }
          }
        }
      }
    }
  }
  expect(seen.length, seen.slice(0, 8).join('\n')).toBe(0);
});

test('a pair that fits shares one row, centred, 24 px apart, 16 px from the sides at 390 and 8 or more at 360', () => {
  const fig390: FigureBox = { l: 155, r: 235, t: 410, b: 523 };
  for (const [pw, nw] of [[157, 162], [150, 150], [166, 152]] as const) {
    const prev = box(pw, 55);
    const next = box(nw, 60);
    expect(dockAround(roomOf(fig390, 390, 844), prev, next)).toBe(true);
    expect(next.x - (prev.x + prev.w), `${pw}/${nw} gap`).toBe(DOCK.pairPx);
    const left = prev.x;
    const right = 390 - (next.x + next.w);
    expect(Math.abs(left - right), `${pw}/${nw} balanced`).toBeLessThanOrEqual(1);
    expect(Math.min(left, right), `${pw}/${nw} sides`).toBeGreaterThanOrEqual(pw + nw + DOCK.pairPx + 32 <= 390 ? 16 : 8);
    expect(next.y - prev.y, 'the way on stands only a step lower').toBe(DOCK.stepPx);
  }
  const fig360: FigureBox = { l: 142, r: 218, t: 389, b: 496 };
  const prev = box(157, 60);
  const next = box(162, 63);
  expect(dockAround(roomOf(fig360, 360, 800), prev, next)).toBe(true);
  expect(next.x - (prev.x + prev.w)).toBeGreaterThanOrEqual(DOCK.pairPx);
  expect(Math.min(prev.x, 360 - next.x - next.w)).toBeGreaterThanOrEqual(DOCK.edgeMinPx);
  const wide = [box(181, 55), box(181, 55)] as const;
  expect(dockAround(roomOf(fig360, 360, 800), wide[0], wide[1])).toBe(true);
  expect(wide[1].y, 'a pair too wide for one row stands as a column').toBeGreaterThanOrEqual(wide[0].y + wide[0].h);
});

test('at 360 px La Puerta and the two-line Estanque de la Luna share one level row; the gap shrinks to 16 before a column', () => {
  const fig: FigureBox = { l: 142, r: 218, t: 389, b: 496 };
  // Whole boxes as measured from layout at 360x800 (label turned by its tilt, twine curl included).
  const prev = box(157, 67);
  const next = box(163, 70);
  expect(dockAround(roomOf(fig, 360, 800), prev, next)).toBe(true);
  expect(next.y - prev.y, 'one row: the way on only a step lower').toBe(DOCK.stepPx);
  expect(next.x - (prev.x + prev.w)).toBeGreaterThanOrEqual(DOCK.pairMinPx);
  expect(Math.min(prev.x, 360 - next.x - next.w)).toBeGreaterThanOrEqual(DOCK.edgeMinPx);
  const tight = [box(160, 67), box(165, 70)] as const;
  expect(dockAround(roomOf(fig, 360, 800), tight[0], tight[1])).toBe(true);
  const gap = tight[1].x - (tight[0].x + tight[0].w);
  expect(gap, 'the sides go to their floor before the gap shrinks').toBeLessThan(DOCK.pairPx);
  expect(gap).toBeGreaterThanOrEqual(DOCK.pairMinPx);
  expect(tight[0].x).toBeCloseTo(DOCK.edgeMinPx, 0);
  expect(tight[1].y - tight[0].y).toBe(DOCK.stepPx);
});

test('one label alone keeps 16 px to the side at 360 and 390', () => {
  for (const [w, h] of [[360, 800], [390, 844]] as const) {
    const fig: FigureBox = { l: w / 2 - 40, r: w / 2 + 40, t: 0.49 * h, b: 0.62 * h };
    const next = box(163, 70);
    const prev = { ...box(157, 67), on: false };
    expect(dockAround(roomOf(fig, w, h), prev, next)).toBe(true);
    expect(w - next.x - next.w, `${w}`).toBeGreaterThanOrEqual(DOCK.edgePx);
  }
});

test('a docked label never covers the focused flower or the nearest flower in front', () => {
  const fig: FigureBox = { l: 155, r: 235, t: 410, b: 523 };
  const seen: string[] = [];
  for (let fx = 40; fx <= 350; fx += 15) {
    for (let fy = 520; fy <= 640; fy += 10) {
      for (const size of [30, 60]) {
        const flower: FigureBox = { l: fx - size / 2, r: fx + size / 2, t: fy - size / 2, b: fy + size / 2 };
        const prev = box(157, 55);
        const next = box(162, 60);
        if (!dockAround(roomOf(fig, 390, 844, 844, [flower]), prev, next)) continue;
        const a = rectOf(prev);
        const b = rectOf(next);
        if (meets(a, flower) || meets(b, flower)) seen.push(`flower at ${fx},${fy} size ${size}`);
        if (Math.max(prev.y, next.y) > fig.b + DOCK.gapPx + DOCK.stepPx + 60) seen.push(`dropped more than a label at ${fx},${fy}`);
        if (Math.min(a.l, b.l) < DOCK.edgeMinPx || Math.max(a.r, b.r) > 390 - DOCK.edgeMinPx) seen.push(`off the sides at ${fx},${fy}`);
      }
    }
  }
  expect(seen.length, seen.slice(0, 8).join('\n')).toBe(0);
  const flower: FigureBox = { l: 150, r: 230, t: 540, b: 600 };
  const prev = box(157, 55);
  const next = box(162, 60);
  expect(dockAround(roomOf(fig, 390, 844, 844, [flower]), prev, next), 'a flower in the band moves the band, it does not hide it').toBe(true);
});

test('with the plant sheet up the labels stand between the shoes and the sheet, or report no room', () => {
  const fig: FigureBox = { l: 148, r: 244, t: 446, b: 580 };
  const prev = box(157, 55);
  const next = box(162, 60);
  expect(dockAround(roomOf(fig, 390, 844, 844 - 200), prev, next)).toBe(false);
  const high: FigureBox = { l: 148, r: 244, t: 300, b: 430 };
  expect(dockAround(roomOf(high, 390, 844, 844 - 200), prev, next)).toBe(true);
  expect(prev.y).toBeGreaterThanOrEqual(high.b);
  expect(next.y + next.h).toBeLessThanOrEqual(844 - 200);
});

test('one docked label alone takes the first row on its own side of the middle; none docked leaves both untouched', () => {
  const fig: FigureBox = { l: 150, r: 240, t: 386, b: 523 };
  const prev = box(162, 51);
  const next = { ...box(169, 54), on: false };
  expect(dockAround(roomOf(fig, 390, 844), prev, next)).toBe(true);
  expect(prev.y).toBe(fig.b + DOCK.gapPx);
  expect(prev.x + prev.w).toBeLessThanOrEqual(195);
});

test('an open tag or plan reports its box once per change, and a label it touches is seen as covered', () => {
  const rev = covers.rev;
  setCover(covers.card, 100, 200, 400, 380);
  setCover(covers.card, 100, 200, 400, 380);
  expect(covers.rev, 'an unchanged box does not re-place the signs').toBe(rev + 1);
  expect(meetsCover(covers.card, 380, 300, 560, 360)).toBe(true);
  expect(meetsCover(covers.card, 401, 300, 560, 360)).toBe(false);
  clearCover(covers.card);
  expect(meetsCover(covers.card, 380, 300, 560, 360), 'a closed tag covers nothing').toBe(false);
  expect(covers.rev).toBe(rev + 2);
});

test('phone labels keep 44 px targets, run on one line or two by rule, and at most two signs exist', () => {
  const css = readFileSync(new URL('../../../src/ui/styles/signs.css', import.meta.url), 'utf8');
  const base = readFileSync(new URL('../../../src/ui/styles/base.css', import.meta.url), 'utf8');
  expect(base).toMatch(/--target:\s*44px/);
  expect(css).toMatch(/\.px-signs \.px-sign \{[^}]*min-height: var\(--target\)/);
  expect(css).toMatch(/max-aspect-ratio: 4\/5\)[^@]*\.px-signs\[data-roam\] \.px-sign \{[^}]*white-space: nowrap/);
  expect(css, 'a docked label draws no cane stub').toMatch(/\.px-signs\[data-roam\] \.px-sign-cane \{\s*display: none;/);
  expect(css, 'free-roam signs come and go whole').toMatch(/\.px-signs\[data-roam\],\s*\.px-signs\[data-roam\]\[data-shown\] \{\s*transition: none;/);
  expect(css, 'a tucked label still shows under keyboard focus').toMatch(/\[data-tucked\]:not\(:focus-visible\)/);
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
