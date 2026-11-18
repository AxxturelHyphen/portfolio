import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { Vector3 } from 'three';
import { APPROACH_FIT, ROAM } from '../../../src/core/motion.ts';
import type { BedId } from '../../../src/types.ts';
import { blendFraming, followPose, moonElevation, paramsFor, SIDE_SKY_DEG, viewLimitsOf, type Framing, type FramingParams } from '../../../src/world/follow.ts';
import type { BedScene3 } from '../../../src/world/layout.ts';
import { builtIn } from '../../../src/world/mode.ts';
import { occluderBlocks } from '../../../src/world/occluders.ts';
import { PROXIMITY } from '../../../src/world/proximity.ts';
import { pathZ } from '../../../src/world/roam.ts';
import puerta from '../../../content/beds/puerta.json' with { type: 'json' };
import rosaleda from '../../../content/beds/rosaleda.json' with { type: 'json' };
import estanque from '../../../content/beds/estanque.json' with { type: 'json' };
import semillero from '../../../content/beds/semillero.json' with { type: 'json' };
import gruta from '../../../content/beds/gruta.json' with { type: 'json' };
import salida from '../../../content/beds/salida.json' with { type: 'json' };
import { traceLayout } from './rig.trace.ts';
import { blankPose, cameraOf, outsideIn } from './view.ts';

// The approach's near framing (world/approach.ts) keeps the walking camera's promises: nothing outside the closed
// garden in view, the visitor in the middle band of the width, the moon over the wall, no tall card over the visitor.

const ground = traceLayout.ground;
const enc = ground.enclosure;
const limits = viewLimitsOf(enc, ground.wall.z);
const r = ROAM.radius;
const ASPECTS = [[1920, 1080], [2560, 1080], [800, 1200], [390, 844]] as const;
const SCENES = { puerta, rosaleda, estanque, semillero, gruta, salida } as unknown as Record<BedId, BedScene3>;
const blank = (): FramingParams => ({ up: 0, downDeg: 0, fov: 0, moonAt: 0, at: 0 });

/** The framings the approach can show: half way, the near limit, and the near limit slid hardest left and right. */
function framings(aspect: number): { name: string; f: Framing; shift: number }[] {
  const walk = paramsFor(aspect, false, blank());
  const near = paramsFor(aspect, true, blank());
  const cases: [string, number, number][] = [['half', 0.5, 0], ['near', 1, 0], ['near slid left', 1, -APPROACH_FIT.maxShiftM], ['near slid right', 1, APPROACH_FIT.maxShiftM]];
  return cases.map(([name, k, shift]) => ({ name, f: blendFraming(aspect, k, walk, near, blank(), {} as Framing), shift: shift * k }));
}

function grid(nx: number, nz: number, each: (x: number, z: number) => void): void {
  for (let x = enc.walk.minX + r; x <= enc.walk.maxX - r + 1e-6; x += (enc.walk.maxX - enc.walk.minX - 2 * r) / nx) {
    for (let z = enc.walk.minZ + r; z <= enc.walk.maxZ - r + 1e-6; z += (enc.walk.maxZ - enc.walk.minZ - 2 * r) / nz) each(x, z);
  }
}

test('the near framing never shows beyond the closed garden, any visitor position and aim, four aspects', () => {
  const seen: string[] = [];
  const pose = blankPose();
  for (const [w, h] of ASPECTS) {
    for (const { name, f, shift } of framings(w / h)) {
      grid(24, 8, (x, z) => {
        followPose(x, z, f, limits, pose, x + shift);
        for (const what of outsideIn(pose, w / h, SIDE_SKY_DEG)) seen.push(`${w}x${h} ${name} visitor ${x.toFixed(2)},${z.toFixed(2)}: ${what}`);
      });
    }
  }
  expect(seen.length, seen.slice(0, 8).join('\n')).toBe(0);
});

test('in the near framing the visitor stays 22 to 78 percent across at 16:9, 21:9 and 390x844', () => {
  const pose = blankPose();
  for (const [w, h] of ASPECTS) {
    let lo = 1;
    let hi = 0;
    for (const { f, shift } of framings(w / h)) {
      grid(140, 16, (x, z) => {
        const s = (new Vector3(x, 0, z).project(cameraOf(followPose(x, z, f, limits, pose, x + shift), w / h)).x + 1) / 2;
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      });
    }
    console.log(`${w}x${h} near framing: visitor from ${(100 * lo).toFixed(1)} to ${(100 * hi).toFixed(1)} percent`);
    if (w === 800) continue;
    expect(lo, `${w}x${h}`).toBeGreaterThanOrEqual(0.22 - 1e-3);
    expect(hi, `${w}x${h}`).toBeLessThanOrEqual(0.78 + 1e-3);
  }
});

test('the moon hangs over the back wall in the near framing, anywhere along the path', () => {
  let least = Infinity;
  for (const [w, h] of ASPECTS) {
    for (const { name, f, shift } of framings(w / h)) {
      const el = moonElevation(f) * (Math.PI / 180);
      for (let x = enc.walk.minX + r; x <= enc.walk.maxX - r; x += 0.5) {
        const z = Math.min(enc.walk.maxZ - r, Math.max(enc.walk.minZ + r, pathZ(ground.path.points, x)));
        const pose = followPose(x, z, f, limits, blankPose(), x + shift);
        const cam = cameraOf(pose, w / h);
        const moon = new Vector3(pose.x, pose.y + Math.sin(el) * 100, pose.z - Math.cos(el) * 100).project(cam);
        const wallTop = new Vector3(pose.x, ground.wall.h, ground.wall.z).project(cam);
        expect((1 - moon.y) / 2, `${w}x${h} ${name} at ${x}`).toBeCloseTo(f.moonAt, 5);
        expect(moon.y, `${w}x${h} ${name} at ${x}: the moon over the wall top`).toBeGreaterThan(wallTop.y);
        least = Math.min(least, (moon.y - wallTop.y) / 2);
      }
    }
  }
  console.log(`the moon's centre stands at least ${(100 * least).toFixed(1)} percent of the height over the wall top`);
});

/** Cards at least this tall (m) must never cover the visitor (as in enclosure.spec.ts). */
const TALL = 1.5;
const ATLAS_DIR = new URL('../../../public/atlas/', import.meta.url);
const SIZES = new Map<string, [number, number]>(readdirSync(ATLAS_DIR).filter((f) => f.endsWith('.json'))
  .flatMap((f) => Object.entries((JSON.parse(readFileSync(new URL(f, ATLAS_DIR), 'utf8')) as { sprites: Record<string, { size: [number, number] }> }).sprites))
  .map(([k, v]) => [k, v.size]));

/** Only where a slot is in proximity reach can the camera ease in, and the visitor never stands in the pond. */
const SLOTS = (Object.keys(SCENES) as BedId[]).flatMap((b) => SCENES[b].slots.map((sl) => [sl.x, sl.z] as const));
const easesHere = (x: number, z: number): boolean =>
  Math.hypot((x - ground.pond.x) / (ground.pond.rx + r), (z - ground.pond.z) / (ground.pond.rz + r)) >= 1 &&
  SLOTS.some(([sx, sz]) => Math.hypot(sx - x, sz - z) <= PROXIMITY.reachM + PROXIMITY.hysteresisM);

test('no tall card covers the visitor in any framing the approach can ease into', () => {
  const blocks = occluderBlocks(enc, SCENES);
  const blocked = (x: number, z: number): boolean => {
    for (let i = 0; i < blocks.length; i += 4) if (x > blocks[i]! - r && x < blocks[i + 2]! + r && z > blocks[i + 1]! - r && z < blocks[i + 3]! + r) return true;
    return false;
  };
  const tall = (Object.keys(SCENES) as BedId[]).flatMap((b) => SCENES[b].layers.flatMap((l) => l.items))
    .filter((it) => builtIn(it, 'roam') && it.flat !== true && it.fade !== true && it.y + (it.h ?? 0) * it.scale >= TALL)
    .filter((it) => it.z > enc.walk.minZ + r && it.x > enc.walk.minX - 3 && it.x < enc.walk.maxX + 3);
  const hidden = new Map<string, number>();
  const pose = blankPose();
  for (const [w, h] of ASPECTS) {
    for (const { name, f, shift } of framings(w / h)) {
      for (const it of tall) {
        const size = SIZES.get(it.sprite);
        if (size === undefined) throw new Error(`no atlas size for ${it.sprite}`);
        const ch = (it.h ?? 0) * it.scale;
        const half = (it.w ?? (ch * size[0]) / size[1]) / 2;
        for (let x = it.x - 3; x <= it.x + 3; x += 0.1) {
          for (let z = enc.walk.minZ + r; z <= it.z; z += 0.1) {
            if (x < enc.walk.minX + r || x > enc.walk.maxX - r || blocked(x, z) || !easesHere(x, z)) continue;
            const cam = cameraOf(followPose(x, z, f, limits, pose, x + shift), w / h);
            const v = new Vector3(x, 0, z).project(cam);
            const a = new Vector3(it.x - half, it.y, it.z).project(cam);
            const c = new Vector3(it.x + half, it.y + ch, it.z).project(cam);
            if (v.x > a.x && v.x < c.x && v.y > a.y && v.y < c.y) {
              const key = `${w}x${h} ${name}: ${it.sprite} at ${it.x},${it.z}`;
              hidden.set(key, (hidden.get(key) ?? 0) + 1);
            }
          }
        }
      }
    }
  }
  const lines = [...hidden].map(([k, n]) => `${k} hides ${n} spots`);
  expect(lines, lines.slice(0, 12).join('\n')).toEqual([]);
});
