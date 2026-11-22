import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { APPROACH_FIT } from '../../../src/core/motion.ts';
import { blendFraming, followPose, moonElevation, paramsFor, viewLimitsOf, type Framing, type FramingParams } from '../../../src/world/follow.ts';
import { FIGURE } from '../../../src/world/doll.ts';
import type { RigPose } from '../../../src/world/rail.ts';
import { traceLayout } from '../world/rig.trace.ts';

// Phones and portrait free roam: the sign buttons stay thumb sized, and the moon hangs whole over the back wall in
// every portrait framing.

const SIZES = [[390, 844], [360, 800], [800, 1200]] as const;
const DEG = Math.PI / 180;
const limits = viewLimitsOf(traceLayout.ground.enclosure, traceLayout.ground.wall.z);
const WALL = traceLayout.ground.wall;
const WALK = traceLayout.ground.enclosure.walk;
/** The moon's disc radius (degrees), halo edge included, as it renders at 390x844. */
const MOON_R = 1.45;
/** The farthest the per-place moon stands from straight ahead (degrees, La Puerta in garden/place.ts). */
const MOON_SIDE_DEG = 10;

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

test('sign buttons keep 44 px targets: the rail labels by CSS, the roam buttons over their planks never scale under it', () => {
  const css = readFileSync(new URL('../../../src/ui/styles/signs.css', import.meta.url), 'utf8');
  const base = readFileSync(new URL('../../../src/ui/styles/base.css', import.meta.url), 'utf8');
  expect(base).toMatch(/--target:\s*44px/);
  expect(css).toMatch(/\.px-signs \.px-sign \{[^}]*min-height: var\(--target\)/);
  expect(css, 'a roam button draws nothing of the label').toMatch(/\.px-signs\[data-roam\] \.px-sign,[^{]*\{[^}]*color: transparent;/);
  expect(css, 'free-roam signs come and go whole').toMatch(/\.px-signs\[data-roam\],\s*\.px-signs\[data-roam\]\[data-shown\] \{\s*transition: none;/);
  expect(css, 'a button off screen lets the pointer through').toMatch(/\.px-signs\[data-roam\] \.px-sign\[data-off\] \{\s*pointer-events: none;/);
  const ts = readFileSync(new URL('../../../src/ui/signposts.ts', import.meta.url), 'utf8');
  expect(ts).toMatch(/const signs = \[makeSign\(-1, m\), makeSign\(1, m\)\] as const;/);
  expect(ts).toMatch(/const TARGET_PX = 44;/);
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
