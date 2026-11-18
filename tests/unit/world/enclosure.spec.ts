import { readFileSync } from 'node:fs';
import type { BedId } from '../../../src/types.ts';
import { expect, test } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { ROAM } from '../../../src/core/motion.ts';
import { enclosureRuns } from '../../../src/world/enclosure.ts';
import { followPose, framingFor, moonElevation, SIDE_SKY_DEG, viewLimitsOf, WALL_SHARE, wallShare, type Framing } from '../../../src/world/follow.ts';
import puerta from '../../../content/beds/puerta.json' with { type: 'json' };
import rosaleda from '../../../content/beds/rosaleda.json' with { type: 'json' };
import estanque from '../../../content/beds/estanque.json' with { type: 'json' };
import semillero from '../../../content/beds/semillero.json' with { type: 'json' };
import gruta from '../../../content/beds/gruta.json' with { type: 'json' };
import salida from '../../../content/beds/salida.json' with { type: 'json' };
import type { BedScene3 } from '../../../src/world/layout.ts';
import { builtIn } from '../../../src/world/mode.ts';
import { occluderBlocks } from '../../../src/world/occluders.ts';
import type { RigPose } from '../../../src/world/rail.ts';
import { createVisitor, HOLD, pathZ } from '../../../src/world/roam.ts';
import shared from '../../../public/atlas/shared.json' with { type: 'json' };
import { traceLayout } from './rig.trace.ts';

const ground = traceLayout.ground;
const enc = ground.enclosure;
const limits = viewLimitsOf(enc, ground.wall.z);
const r = ROAM.radius;
const ASPECTS = [[1920, 1080], [2560, 1080], [800, 1200], [390, 844]] as const;
const DEG = Math.PI / 180;
const SCENES = { puerta, rosaleda, estanque, semillero, gruta, salida } as unknown as Record<BedId, BedScene3>;
/** The clamp samples the frame's side edge: its sky angle holds to this much (degrees). */
const SAMPLED_DEG = 0.1;
const blankPose = (): RigPose => ({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0, fov: 0 });

function cameraOf(p: RigPose, aspect: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(p.fov, aspect, 0.05, 400);
  cam.rotation.order = 'YXZ';
  cam.position.set(p.x, p.y, p.z);
  cam.rotation.set(p.pitch, -p.yaw, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

/**
 * What one view ray shows inside the closed garden model: null when it meets the garden's ground, a wall, the kerb or
 * sky (over the back wall, or over an end wall no steeper than SIDE_SKY_DEG below the horizon); otherwise what of the
 * outside it shows. The ground plane under free roam ends just past the walls, so a ray over a wall meets sky.
 */
function outsideSeen(o: Vector3, d: Vector3): string | null {
  const [x0, x1] = enc.x;
  const depression = Math.atan2(-d.y, Math.hypot(d.x, d.z)) / DEG;
  let t0 = 0;
  if (o.z > enc.front && d.z < 0) {
    t0 = (enc.front - o.z) / d.z;
    const y = o.y + d.y * t0;
    const x = o.x + d.x * t0;
    if (y <= 0) return 'ground south of the kerb';
    if (x < x0 - 1e-6 || x > x1 + 1e-6) return y < enc.endH || depression > SIDE_SKY_DEG + SAMPLED_DEG ? 'past a front corner' : null;
    if (y < enc.kerbH) return null;
  }
  const toGround = d.y < 0 ? -o.y / d.y : Infinity;
  const toBack = d.z < 0 ? (ground.wall.z - o.z) / d.z : Infinity;
  const toSide = d.x < 0 ? (x0 - o.x) / d.x : d.x > 0 ? (x1 - o.x) / d.x : Infinity;
  const t = Math.min(toGround, toBack, toSide);
  if (t < t0 || t !== toSide) return null;
  const y = o.y + d.y * t;
  return y < enc.endH || depression <= SIDE_SKY_DEG + SAMPLED_DEG ? null : `sky over an end wall ${depression.toFixed(1)} deg down`;
}

test('the follow camera never shows beyond the closed garden, any visitor position, four aspects', () => {
  const seen: string[] = [];
  for (const [w, h] of ASPECTS) {
    const f = framingFor(w / h, {} as Framing);
    const pose = blankPose();
    for (let x = enc.walk.minX + r; x <= enc.walk.maxX - r + 1e-6; x += (enc.walk.maxX - enc.walk.minX - 2 * r) / 24) {
      for (let z = enc.walk.minZ + r; z <= enc.walk.maxZ - r + 1e-6; z += (enc.walk.maxZ - enc.walk.minZ - 2 * r) / 8) {
        followPose(x, z, f, limits, pose);
        const cam = cameraOf(pose, w / h);
        for (let i = 0; i <= 32; i++) {
          for (let j = 0; j <= 18; j++) {
            const d = new Vector3(-1 + i / 16, -1 + j / 9, 0.5).unproject(cam).sub(cam.position);
            const what = outsideSeen(cam.position, d);
            if (what !== null) seen.push(`${w}x${h} visitor ${x.toFixed(2)},${z.toFixed(2)}: ${what}`);
          }
        }
      }
    }
  }
  expect(seen.length, seen.slice(0, 8).join("\n")).toBe(0);
});

/** The visitor's place across the screen (0 left, 1 right). */
function screenX(x: number, z: number, aspect: number): number {
  const pose = followPose(x, z, framingFor(aspect, {} as Framing), limits, blankPose());
  return (new Vector3(x, 0, z).project(cameraOf(pose, aspect)).x + 1) / 2;
}

test('along the path the visitor stays near the middle of the screen, both ends included', () => {
  for (const [w, h] of ASPECTS) {
    let lo = 1;
    let hi = 0;
    for (let x = enc.walk.minX + r; x <= enc.walk.maxX - r + 1e-6; x += 0.25) {
      const z = Math.min(enc.walk.maxZ - r, Math.max(enc.walk.minZ + r, pathZ(ground.path.points, x)));
      const s = screenX(x, z, w / h);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    console.log(`${w}x${h} visitor from ${(100 * lo).toFixed(1)} to ${(100 * hi).toFixed(1)} percent`);
    // Near the end walls the camera keeps off the wall, and the visitor gives way to the 20 to 80 percent band.
    const band = 0.3;
    expect(lo, `${w}x${h}`).toBeGreaterThanOrEqual(0.5 - band);
    expect(hi, `${w}x${h}`).toBeLessThanOrEqual(0.5 + band);
  }
});

test('the visitor stays on screen at the four corners of the walk area', () => {
  for (const [w, h] of ASPECTS) {
    for (const x of [enc.walk.minX + r, enc.walk.maxX - r]) {
      for (const z of [enc.walk.minZ + r, enc.walk.maxZ - r]) {
        const s = screenX(x, z, w / h);
        console.log(`${w}x${h} corner ${x},${z} at ${(100 * s).toFixed(1)}`);
        expect(s, `${w}x${h} at ${x},${z}`).toBeGreaterThan(0.08);
        expect(s, `${w}x${h} at ${x},${z}`).toBeLessThan(0.92);
      }
    }
  }
});

test('the walk area sits inside the walls and the visitor reaches each of its edges', () => {
  const [x0, x1] = enc.x;
  expect(enc.walk.minX - r).toBeGreaterThan(x0);
  expect(enc.walk.maxX + r).toBeLessThan(x1);
  expect(enc.walk.minZ - r).toBeGreaterThan(ground.wall.z);
  expect(enc.walk.maxZ + r).toBeLessThan(enc.front);
  expect(enc.viewMaxZ).toBeLessThan(enc.front);
  const area = { ...enc.walk, pond: ground.pond, path: ground.path.points };
  for (const [bits, axis, want] of [[HOLD.left, 0, enc.walk.minX + r], [HOLD.right, 0, enc.walk.maxX - r], [HOLD.up, 1, enc.walk.minZ + r], [HOLD.down, 1, enc.walk.maxZ - r]] as const) {
    const v = createVisitor(area, 30, 4);
    v.setHeld(bits);
    for (let i = 0; i < 1200; i++) v.step(1 / 60);
    expect(v.pos[axis]).toBeCloseTo(want, 4);
  }
});

test('the enclosure runs close the garden: end walls, front kerb, a door gap at the Salida path end', () => {
  const runs = enclosureRuns(enc, ground.wall.z, ground.wall.h, ground.wall.flatW);
  const ends = runs.filter((u) => Math.abs(Math.abs(u.yaw) - Math.PI / 2) < 1e-6);
  expect(ends.map((u) => u.x).sort((a, b) => a - b)).toEqual([...enc.x]);
  for (const u of ends) expect(u.len).toBeCloseTo(enc.front - ground.wall.z, 6);
  expect(runs.some((u) => u.z === enc.front && !u.pier && u.h === enc.kerbH && u.len === enc.x[1] - enc.x[0])).toBe(true);
  const back = runs.filter((u) => !u.pier && u.z === ground.wall.z);
  const covers = (x: number): boolean => back.some((u) => x >= u.x && x <= u.x + u.len);
  for (let x = enc.x[0]; x <= enc.x[1]; x += 0.05) expect(covers(x) || Math.min(Math.abs(x - enc.door[0]), Math.abs(x - enc.door[1])) < 0.02, `back wall at ${x.toFixed(2)}`).toBe(!(x > enc.door[0] + 0.02 && x < enc.door[1] - 0.02));
  expect((enc.door[0] + enc.door[1]) / 2).toBeCloseTo(ground.path.points.at(-1)?.[0] ?? 0, 1);
});

/** Moon azimuth per place, read from src/garden/place.ts (PLACE_LIGHT), so the test follows any retune. */
function moonAzimuths(): Record<string, number> {
  const src = readFileSync(new URL('../../../src/garden/place.ts', import.meta.url), 'utf8');
  const out: Record<string, number> = {};
  for (const m of src.matchAll(/(\w+): \{ skyTop[^}]*moon: \[(-?[\d.]+), (-?[\d.]+)\]/g)) out[m[1] ?? ''] = Number(m[2]);
  return out;
}

/** Disc plus the bright part of its halo, degrees (sky.frag.glsl MOON_R 1.2, halo falling to 1/e 1.1 past it). */
const MOON_CLEAR_DEG = 2.4;

test('no crown group stands in the moon column at any stand point, four aspects', () => {
  const az = moonAzimuths();
  const beds = traceLayout.rail.keys.flatMap((k) => (k.bed === undefined ? [] : [k.bed]));
  expect(beds.length).toBe(5);
  const hits: string[] = [];
  for (const [w, h] of ASPECTS) {
    const f = framingFor(w / h, {} as Framing);
    const el = moonElevation(f) * DEG;
    for (const bed of beds) {
      const ax = traceLayout.anchors[bed];
      const pose = followPose(ax, pathZ(ground.path.points, ax), f, limits, blankPose());
      const cam = cameraOf(pose, w / h);
      const a = (az[bed] ?? NaN) * DEG;
      const dir = new Vector3(Math.cos(el) * Math.sin(a), Math.sin(el), -Math.cos(el) * Math.cos(a));
      for (const c of enc.crowns) {
        const rect = (shared.sprites as Record<string, { size: number[]; pivot: number[] } | undefined>)[c.sprite];
        if (rect === undefined) throw new Error(`no sprite ${c.sprite}`);
        const [sw = 1, sh = 1] = rect.size;
        const width = (sw * c.h) / sh;
        const left = c.x - width * (rect.pivot[0] ?? 0.5);
        // The crown's nearest point to the moon ray, in angle from the camera.
        let nearest = Infinity;
        for (let u = 0; u <= 40; u++) {
          for (let v = 0; v <= 20; v++) {
            const p = new Vector3(left + (width * u) / 40, (c.h * v) / 20, c.z).sub(cam.position).normalize();
            nearest = Math.min(nearest, Math.acos(Math.min(1, p.dot(dir))) / DEG);
          }
        }
        if (nearest < MOON_CLEAR_DEG) hits.push(`${w}x${h} ${bed}: ${c.sprite} ${nearest.toFixed(2)} deg from the moon`);
      }
    }
  }
  expect(hits).toEqual([]);
});

test('no end wall fills more than its share of any frame row unless the visitor would leave the middle band', () => {
  for (const [w, h] of ASPECTS) {
    const f = framingFor(w / h, {} as Framing);
    const limit = w / h >= 0.8 ? WALL_SHARE.landscape : WALL_SHARE.portrait;
    let most = 0;
    for (let x = enc.walk.minX + r; x <= enc.walk.maxX - r + 1e-6; x += 0.5) {
      for (let z = enc.walk.minZ + r; z <= enc.walk.maxZ - r + 1e-6; z += 0.5) {
        const p = followPose(x, z, f, limits, blankPose());
        const s = screenX(x, z, w / h);
        // Where the visitor holds the edge of the 20 to 80 percent band, the band wins over the wall's share.
        if (s < 0.2 + 1e-3 || s > 0.8 - 1e-3) continue;
        most = Math.max(most, wallShare(f, p.x - enc.x[0], p.z, limits), wallShare(f, enc.x[1] - p.x, p.z, limits));
      }
    }
    console.log(`${w}x${h} end wall at most ${(100 * most).toFixed(1)} percent of a row`);
    expect(most, `${w}x${h}`).toBeLessThanOrEqual(limit + 1e-3);
  }
});

test('no tall card ever covers the visitor: its hidden strip is walled off', () => {
  const wide = framingFor(16 / 9, {} as Framing);
  const blocks = occluderBlocks(enc, SCENES, wide.back, wide.up);
  expect(blocks.length / 4).toBe(enc.occluders.length);
  const blocked = (x: number, z: number): boolean => {
    for (let i = 0; i < blocks.length; i += 4) if (x > blocks[i]! - r && x < blocks[i + 2]! + r && z > blocks[i + 1]! - r && z < blocks[i + 3]! + r) return true;
    return false;
  };
  for (const b of traceLayout.rail.keys.flatMap((k) => (k.bed === undefined ? [] : [k.bed]))) {
    const ax = traceLayout.anchors[b];
    expect(blocked(ax, pathZ(ground.path.points, ax)), `stand point of ${b}`).toBe(false);
  }
  const hidden: string[] = [];
  for (const [w, h] of [[1920, 1080], [390, 844]] as const) {
    const f = framingFor(w / h, {} as Framing);
    for (const o of enc.occluders) {
      const it = SCENES[o.bed].layers.flatMap((l) => l.items).find((i) => i.sprite === o.sprite && builtIn(i, 'roam'));
      if (it === undefined) throw new Error(`no ${o.sprite} in ${o.bed}`);
      const ch = (it.h ?? 0) * it.scale;
      const half = (ch * o.aspect) / 2;
      for (let x = it.x - 3; x <= it.x + 3; x += 0.2) {
        for (let z = enc.walk.minZ + r; z <= it.z; z += 0.2) {
          if (x < enc.walk.minX + r || x > enc.walk.maxX - r || blocked(x, z)) continue;
          const cam = cameraOf(followPose(x, z, f, limits, blankPose()), w / h);
          const v = new Vector3(x, 0, z).project(cam);
          const a = new Vector3(it.x - half, it.y, it.z).project(cam);
          const c = new Vector3(it.x + half, it.y + ch, it.z).project(cam);
          if (v.x > a.x && v.x < c.x && v.y > a.y && v.y < c.y) hidden.push(`${w}x${h} ${o.sprite} hides ${x.toFixed(1)},${z.toFixed(1)}`);
        }
      }
    }
  }
  expect(hidden.length, hidden.slice(0, 6).join('\n')).toBe(0);
});
