import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Mesh } from 'three';
import type { AtlasManifest, BedId, CutoutBatch, InstanceWriter, QuadParams, Tier } from '../../../src/types.ts';
import { buildBed } from '../../../src/world/bed.build.ts';
import { BODY, bodyOf, writeBody } from '../../../src/world/body.ts';
import { writeClumps } from '../../../src/world/clumps.ts';
import { writeDressing } from '../../../src/world/dressing.ts';
import { buildGround } from '../../../src/world/ground.ts';
import type { BedScene3, WorldLayout } from '../../../src/world/layout.ts';
import type { WorldMode } from '../../../src/world/mode.ts';
import { QUAD_FLAG } from '../../../src/world/quadflags.ts';

// Plants with body (cook/PLAN_3D.md F2): under free roam off the low tier small plants fold into a V on their midline
// and tall ones take a crossed card, so the orbiting camera never sees a lone card edge on.

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
const garden = json('content/garden.json') as WorldLayout;
const scenes = garden.order.map((b: BedId) => json(`content/beds/${b}.json`) as BedScene3);
const shared = json('public/atlas/shared.json') as AtlasManifest;

function recorder(out: QuadParams[]): InstanceWriter {
  return { capacity: 1e6, count: 0, set: (_i, q) => { out.push({ ...q, uv: Array.from(q.uv), tint: Array.from(q.tint) }); }, commit() {} };
}

const batchOf = (out: QuadParams[]) => (_from: unknown, _page: number, capacity: number): CutoutBatch => ({
  mesh: { add() {} } as unknown as Mesh, uniforms: {} as CutoutBatch['uniforms'], dispose() {},
  writer: { ...recorder(out), capacity, set(i, q) { expect(i, 'within the batch capacity').toBeLessThan(capacity); out.push({ ...q }); } },
});

const flagsOf = (q: QuadParams): number => Math.floor(q.phase / 8);
const plate = (): QuadParams => ({
  x: 2, y: 0, z: 3, rot: 0.1, w: 0.6, h: 0.5, px: 0.3, py: 0, uv: [0.1, 0.2, 0.5, 0.6], sway: 0.03, phase: QUAD_FLAG.fade * 8 + 1, lift: 0,
  facing: 0.2, tint: [1, 1, 1, 1],
});

/** Where a quad's corner (cx along its width, at its foot row) stands on the ground, as the cutout shader puts it. */
function footOf(q: QuadParams, cx: number): [number, number] {
  const lx = (cx - q.px) * q.w * Math.cos(q.rot);
  return [q.x + lx * Math.cos(q.facing), q.z - lx * Math.sin(q.facing)];
}

test('a fold writes two halves hinged on the plate midline, opening toward the lens, and leaves the quad as it came', () => {
  const q = plate();
  const before = { ...q };
  const out: QuadParams[] = [];
  expect(writeBody(recorder(out), 0, q, 'fold', 0.5)).toBe(2);
  expect(q).toEqual(before);
  const [a, b] = out as [QuadParams, QuadParams];
  expect(a.uv).toEqual([0.1, 0.2, 0.3, 0.6]);
  expect(b.uv).toEqual([0.3, 0.2, 0.5, 0.6]);
  expect(a.w + b.w).toBeCloseTo(q.w);
  const crease = footOf(q, 0.5);
  for (const [half, at] of [[a, 1], [b, 0]] as const) {
    const [x, z] = footOf(half, at);
    expect(x).toBeCloseTo(crease[0]);
    expect(z).toBeCloseTo(crease[1]);
    expect(flagsOf(half), 'both halves keep the plate flags').toBe(QUAD_FLAG.fade);
  }
  const turn = a.facing - q.facing;
  expect(turn).toBeGreaterThanOrEqual(BODY.fold[0]);
  expect(turn).toBeLessThanOrEqual(BODY.fold[1]);
  expect(b.facing - q.facing).toBeCloseTo(-turn);
  expect(footOf(a, 0)[1], 'the outer edges stand nearer the lens than the crease').toBeGreaterThan(crease[1]);
  expect(footOf(b, 1)[1]).toBeGreaterThan(crease[1]);
});

test('a cross paints a mirrored copy turned back toward the lens first, with no second decal, then the plate itself', () => {
  const q = plate();
  const out: QuadParams[] = [];
  expect(writeBody(recorder(out), 0, q, 'cross', 0.3)).toBe(2);
  const [copy, own] = out as [QuadParams, QuadParams];
  expect(own).toEqual({ ...q, uv: Array.from(q.uv), tint: Array.from(q.tint) });
  expect(copy.w).toBe(-q.w);
  expect(flagsOf(copy)).toBe(flagsOf(q) | QUAD_FLAG.noShadow);
  const turn = q.facing - copy.facing;
  expect(turn, 'a plate hinged left crosses to the right').toBeGreaterThanOrEqual(BODY.cross[0]);
  expect(turn).toBeLessThanOrEqual(BODY.cross[1]);
  expect(Math.abs(copy.facing) + 0.61, 'its face shows within the 35 degree orbit').toBeLessThan(Math.PI / 2);
});

test('signs, pets, props and project flowers take no body; the lawn plants and the bed flowers do', () => {
  for (const id of ['sh/board', 'v/cat', 'v/bench', 'sh/lantern-cage', 'gr/wall', 'pu/pier-l']) expect(bodyOf(id), id).toBeNull();
  for (const id of ['w/poppy', 'w/cane', 'ro/comp-white', 'sa/daisy']) expect(bodyOf(id), id).toBe('cross');
  for (const id of ['sh/clump-1', 'w/fiddle', 'gr/fern-a']) expect(bodyOf(id), id).toBe('fold');
});

/**
 * What a build writes: every quad, and the quads a body adds (the second half of a fold, on no plate's uv and hinged
 * at its left edge, or a second card of one plate on one spot), so quads - parts is the pieces built.
 */
interface Written { quads: number; parts: number }

function partsOf(out: readonly QuadParams[], manifests: readonly AtlasManifest[]): Written {
  const plates = new Set(manifests.flatMap((m) => Object.values(m.sprites).map((r) => Array.from(r.uv).join())));
  const spots = new Set<string>();
  let parts = 0;
  for (const q of out) {
    const spot = `${q.x},${q.z},${Array.from(q.uv).join()}`;
    if (plates.has(Array.from(q.uv).join()) ? spots.has(spot) : q.px === 0) parts++;
    spots.add(spot);
  }
  return { quads: out.length, parts };
}

function bedWritten(scene: BedScene3, tier: Tier): Written {
  const out: QuadParams[] = [];
  const bed = { manifest: json(`public/atlas/${scene.id}.json`) as AtlasManifest, tex: { color: [], normal: [], gpuBytes: 0 } };
  const built = buildBed({
    scene, tier, maxLayers: 12, mode: 'roam', bed, shared: { manifest: shared, tex: bed.tex }, slots: [],
    visited: () => false, reduced: { state: { reduced: false } }, createBatch: batchOf(out),
  });
  expect(built.batches.reduce((n, b) => n + b.writer.count, 0)).toBe(out.length);
  return partsOf(out, [bed.manifest, shared]);
}

function groundWritten(mode: WorldMode, tier: Tier): Written {
  const out: QuadParams[] = [];
  const g = buildGround(garden.ground, scenes, tier, mode);
  writeClumps(g, shared, (page, capacity) => batchOf(out)('shared', page, capacity));
  writeDressing(g, shared, (page, capacity) => batchOf(out)('shared', page, capacity));
  return partsOf(out, [shared]);
}

test('free roam builds the bodies within the batch capacities; the low tier and the rail keep single cards', () => {
  for (const scene of scenes) {
    expect(bedWritten(scene, 'low').parts, scene.id).toBe(0);
    const high = bedWritten(scene, 'high');
    expect(high.parts * 2, scene.id).toBeLessThanOrEqual(high.quads);
  }
  expect(scenes.reduce((n, s) => n + bedWritten(s, 'high').parts, 0)).toBeGreaterThan(50);
  expect(groundWritten('roam', 'low').parts).toBe(0);
  expect(groundWritten('rail', 'high').parts).toBe(0);
  const roam = groundWritten('roam', 'high');
  expect(roam.parts).toBeGreaterThan(300);
  expect(roam.parts * 2).toBeLessThanOrEqual(roam.quads);
});
