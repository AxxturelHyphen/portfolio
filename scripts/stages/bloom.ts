/// <reference types="node" />
// Bloom layers (cook/ART.md section 3.5): the full-bloom drawing split into nested layers so the last three poses
// are real drawings revealed from the heart outward, never scaled. The cut between the middle ring and the guard
// petals follows petal edges: in polar coordinates around the bloom centre, a smooth closed path through the band
// around `ring` x the bloom radius that maximises line darkness (dynamic programming over the angle).
// Output frames share one canvas, so they register: 7 heart and middle ring, 8 guards added but tucked in,
// 9 the plate as drawn.
import { drawScaled, raster, type Raster } from './raster.ts';
import { boxBlur } from './treat.ts';

const ANGLES = 360;
const BAND = 0.14;
const SMOOTH = 1.4;
const TUCK = 0.955;

function centreOf(r: Raster): [number, number] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const a = r.data[(y * r.w + x) * 4 + 3]! / 255;
      sx += x * a;
      sy += y * a;
      n += a;
    }
  }
  return n > 0 ? [sx / n, sy / n] : [r.w / 2, r.h / 2];
}

/** Line darkness: how much darker a pixel is than its neighbourhood (petal edges are drawn as darker lines). */
function edges(r: Raster): Float32Array {
  const n = r.w * r.h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = (0.2126 * r.data[i * 4]! + 0.7152 * r.data[i * 4 + 1]! + 0.0722 * r.data[i * 4 + 2]!) / 255;
  const near = boxBlur(lum, r.w, r.h, Math.max(2, Math.round(Math.max(r.w, r.h) / 120)));
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = Math.max(0, near[i]! - lum[i]!);
  return e;
}

/** Cut radius per angle (px) along petal edges. */
function cutPath(r: Raster, c: [number, number], ring: number): Float32Array {
  const e = edges(r);
  const sample = (x: number, y: number): number => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi < 0 || yi < 0 || xi >= r.w || yi >= r.h ? 0 : e[yi * r.w + xi]!;
  };
  const alphaAt = (x: number, y: number): number => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi < 0 || yi < 0 || xi >= r.w || yi >= r.h ? 0 : r.data[(yi * r.w + xi) * 4 + 3]!;
  };
  const maxR = Math.hypot(r.w, r.h) / 2;
  const outer = new Float32Array(ANGLES);
  for (let k = 0; k < ANGLES; k++) {
    const t = (k / ANGLES) * Math.PI * 2;
    for (let d = maxR; d > 0; d -= 1) {
      if (alphaAt(c[0] + Math.cos(t) * d, c[1] + Math.sin(t) * d) > 128) {
        outer[k] = d;
        break;
      }
    }
  }
  // Smooth the outline radius so one long petal tip does not drag the cut outward.
  const R = new Float32Array(ANGLES);
  for (let k = 0; k < ANGLES; k++) {
    let s = 0;
    for (let j = -12; j <= 12; j++) s += outer[(k + j + ANGLES) % ANGLES]!;
    R[k] = s / 25;
  }
  const STEPS = 48;
  const cost = new Float32Array(ANGLES * STEPS);
  const radius = (k: number, s: number): number => R[k]! * (ring - BAND + (2 * BAND * s) / (STEPS - 1));
  for (let k = 0; k < ANGLES; k++) {
    const t = (k / ANGLES) * Math.PI * 2;
    for (let s = 0; s < STEPS; s++) {
      const d = radius(k, s);
      cost[k * STEPS + s] = -sample(c[0] + Math.cos(t) * d, c[1] + Math.sin(t) * d) * 40;
    }
  }
  const acc = new Float32Array(ANGLES * STEPS);
  const from = new Int16Array(ANGLES * STEPS);
  acc.set(cost.subarray(0, STEPS));
  for (let k = 1; k < ANGLES; k++) {
    for (let s = 0; s < STEPS; s++) {
      let best = Infinity;
      let arg = s;
      for (let p = Math.max(0, s - 2); p <= Math.min(STEPS - 1, s + 2); p++) {
        const v = acc[(k - 1) * STEPS + p]! + Math.abs(p - s) * SMOOTH;
        if (v < best) {
          best = v;
          arg = p;
        }
      }
      acc[k * STEPS + s] = best + cost[k * STEPS + s]!;
      from[k * STEPS + s] = arg;
    }
  }
  let s = 0;
  for (let q = 1; q < STEPS; q++) if (acc[(ANGLES - 1) * STEPS + q]! < acc[(ANGLES - 1) * STEPS + s]!) s = q;
  const path = new Float32Array(ANGLES);
  for (let k = ANGLES - 1; k >= 0; k--) {
    path[k] = radius(k, s);
    s = from[k * STEPS + s]!;
  }
  // Close the loop: blend the seam over 20 degrees, then a circular moving average so the cut never zigzags.
  for (let j = 0; j < 20; j++) {
    const w = j / 20;
    path[j] = path[j]! * w + path[ANGLES - 1]! * (1 - w);
  }
  const out = new Float32Array(ANGLES);
  for (let k = 0; k < ANGLES; k++) {
    let sum = 0;
    for (let j = -4; j <= 4; j++) sum += path[(k + j + ANGLES) % ANGLES]!;
    out[k] = sum / 9;
  }
  return out;
}

/** Frames 7, 8 and 9 of a full-bloom drawing, all on its canvas. `ring` is the middle ring as a radius fraction. */
export function buildBloom(full: Raster, ring: number): [Raster, Raster, Raster] {
  const c = centreOf(full);
  const path = cutPath(full, c, ring);
  const inner = raster(full.w, full.h);
  const guards = raster(full.w, full.h);
  for (let y = 0; y < full.h; y++) {
    for (let x = 0; x < full.w; x++) {
      const i = (y * full.w + x) * 4;
      if (full.data[i + 3]! === 0) continue;
      const dx = x - c[0];
      const dy = y - c[1];
      const f = (((Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * ANGLES;
      const k0 = Math.floor(f) % ANGLES;
      const t = f - Math.floor(f);
      const edge = path[k0]! * (1 - t) + path[(k0 + 1) % ANGLES]! * t - Math.hypot(dx, dy);
      // 1.2 px soft cut; the last 2 px inside darken slightly, a drawn petal edge rather than a scissor line.
      const a = Math.min(1, Math.max(0, edge / 1.2 + 0.5));
      const shade = edge < 2.5 ? 0.82 + 0.18 * Math.max(0, edge / 2.5) : 1;
      inner.data.set([full.data[i]! * shade, full.data[i + 1]! * shade, full.data[i + 2]! * shade, full.data[i + 3]! * a], i);
      guards.data.set([full.data[i]!, full.data[i + 1]!, full.data[i + 2]!, full.data[i + 3]! * (1 - a)], i);
    }
  }
  const tucked = raster(full.w, full.h);
  const tw = full.w * TUCK;
  const th = full.h * TUCK;
  drawScaled(tucked, guards, c[0] - c[0] * TUCK, c[1] - c[1] * TUCK, tw, th, false);
  drawScaled(tucked, inner, 0, 0, full.w, full.h, false);
  return [inner, tucked, full];
}
