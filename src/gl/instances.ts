import {
  BufferAttribute,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Sphere,
  Vector3,
} from 'three';
import type { InstanceWriter, QuadParams } from '../types.ts';

/** Floats per instance in the interleaved buffer: aPos, aSize, aUV, aAnim (4 x vec4). The u8 tint lives in its own buffer. */
export const FLOATS_PER_QUAD = 16;
const TINT_BYTES = 4;

/**
 * Per-instance flags, packed into the sway phase (QuadParams.phase = packPhase(phase, flags)) so the frozen 20-float
 * layout of cook/ARCH.md 2.7 stays. Default 0: an upright cutout that leans back 8 degrees, sways on twos (12 fps)
 * and casts a ground decal when its pivot is at its foot.
 */
export const QUAD_FLAG = {
  /** Lies flat on the ground (decals, fallen petals, shears): no lean, no decal. */
  flat: 1,
  /** Sways at the full display rate instead of the 12 fps grid. */
  fullRate: 2,
  /** Architecture, trunks, hanging things: no lean back. */
  noLean: 4,
  /** No ground decal. */
  noShadow: 8,
  /** The tint is applied uncapped: a dark silhouette (overview cards of beds not loaded). */
  silhouette: 16,
  /** A standee: turns toward a roaming eye around the vertical axis (uEye, cook/ROAM_PLAN.md 3); still on the rail. */
  turn: 32,
  /** Fades to a trace while it covers the roaming visitor's ground point (uVisitor); never on the rail. */
  fade: 64,
} as const;
const PHASE_SPAN = 8;

/** Phase (radians, any value) plus flags in one float: flags * 8 + phase wrapped to 0..2pi. */
export function packPhase(phase: number, flags: number): number {
  const tau = Math.PI * 2;
  return flags * PHASE_SPAN + (((phase % tau) + tau) % tau);
}

interface Range { start: number; count: number }

/** A batch geometry: one unit quad, instanced with fixed capacity. Buffers are allocated once and updated in place. */
export interface CutoutGeometry { readonly geometry: InstancedBufferGeometry; readonly writer: InstanceWriter }

const unit = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Union of the pending upload range with [start, start + count), without allocating: ranges stay one preallocated object. */
function markRange(ranges: Range[], own: Range, start: number, count: number): void {
  if (ranges.length === 0) {
    own.start = start;
    own.count = count;
    ranges.push(own);
    return;
  }
  const end = Math.max(own.start + own.count, start + count);
  own.start = Math.min(own.start, start);
  own.count = end - own.start;
}

export function createCutoutGeometry(capacity: number): CutoutGeometry {
  const geometry = new InstancedBufferGeometry();
  // Two quads per instance, in paint order: the ground decal (kind 0), then the paper itself (kind 1).
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]), 3));

  const floats = new Float32Array(capacity * FLOATS_PER_QUAD);
  const interleaved = new InstancedInterleavedBuffer(floats, FLOATS_PER_QUAD, 1).setUsage(DynamicDrawUsage);
  geometry.setAttribute('aPos', new InterleavedBufferAttribute(interleaved, 4, 0));
  geometry.setAttribute('aSize', new InterleavedBufferAttribute(interleaved, 4, 4));
  geometry.setAttribute('aUV', new InterleavedBufferAttribute(interleaved, 4, 8));
  geometry.setAttribute('aAnim', new InterleavedBufferAttribute(interleaved, 4, 12));

  const bytes = new Uint8Array(capacity * TINT_BYTES);
  const tint = new InstancedBufferAttribute(bytes, TINT_BYTES, true).setUsage(DynamicDrawUsage);
  geometry.setAttribute('aTint', tint);
  geometry.instanceCount = 0;
  // Positions are quad corners placed in the shader: a fixed sphere keeps three from computing one (NaN) for sorting.
  geometry.boundingSphere = new Sphere(new Vector3(), Number.MAX_VALUE);

  const floatRange: Range = { start: 0, count: 0 };
  const tintRange: Range = { start: 0, count: 0 };
  let count = 0;

  const writer: InstanceWriter = {
    capacity,
    get count() { return count; },
    set count(n: number) {
      count = n < 0 ? 0 : n > capacity ? capacity : n;
      geometry.instanceCount = count;
    },
    set(i: number, p: QuadParams): void {
      const o = i * FLOATS_PER_QUAD;
      floats[o] = p.x; floats[o + 1] = p.y; floats[o + 2] = p.z; floats[o + 3] = p.rot;
      floats[o + 4] = p.w; floats[o + 5] = p.h; floats[o + 6] = p.px; floats[o + 7] = p.py;
      floats[o + 8] = p.uv[0] ?? 0; floats[o + 9] = p.uv[1] ?? 0; floats[o + 10] = p.uv[2] ?? 1; floats[o + 11] = p.uv[3] ?? 1;
      floats[o + 12] = p.sway; floats[o + 13] = p.phase; floats[o + 14] = p.lift; floats[o + 15] = p.facing;
      const t = i * TINT_BYTES;
      bytes[t] = Math.round(unit(p.tint[0] ?? 1) * 255);
      bytes[t + 1] = Math.round(unit(p.tint[1] ?? 1) * 255);
      bytes[t + 2] = Math.round(unit(p.tint[2] ?? 1) * 255);
      bytes[t + 3] = Math.round(unit(p.tint.length > 3 ? (p.tint[3] ?? 1) : 1) * 255);
    },
    commit(from: number, to: number): void {
      const a = from < 0 ? 0 : from;
      const b = to > capacity ? capacity : to;
      if (b <= a) return;
      markRange(interleaved.updateRanges, floatRange, a * FLOATS_PER_QUAD, (b - a) * FLOATS_PER_QUAD);
      markRange(tint.updateRanges, tintRange, a * TINT_BYTES, (b - a) * TINT_BYTES);
      interleaved.needsUpdate = true;
      tint.needsUpdate = true;
    },
  };
  return { geometry, writer };
}
