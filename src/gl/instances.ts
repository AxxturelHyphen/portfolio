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
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));

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
  // Positions are 2D corners placed in the shader: a fixed sphere keeps three from computing one (NaN) for sorting.
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
