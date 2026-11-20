/// <reference types="node" />
// The hand-tinted print pass for a photograph cut as a sprite (the owner's own plates): the plate pass of the ground
// textures (soft tone steps, an engraver's line screen, a gradient map with the colour slipped off the key plate)
// applied to the opaque part only, then a little chalk grain so no paint stays flat and no white stays white.
import type { Raster } from './raster.ts';
import { hexRgb } from './recipe.ts';
import { ANGLES, gradient, lineAt, smooth, toneStep } from './tiles.ts';
import { boxBlur } from './treat.ts';

export interface Engrave {
  /** Gradient map shade, mid, light: the light end is the paper, so white paint comes out warm. */
  gm: [string, string, string];
  /** Line pitch of the screen in px of the part. */
  pitch: number;
  /** Share of the five soft tone steps against the continuous tone, 0..1 (default 0.5). */
  steps?: number;
  /** Ink the line screen takes off the tone, 0..1 (default 0.2). */
  line?: number;
  /** Chalk grain, share of the tone, 0..1 (default 0.05). */
  grain?: number;
  /** Tone curve exponent; below 1 lifts the shading toward paper (default 1). */
  gamma?: number;
}

/** Deterministic value noise in -1..1 on a cell grid. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

/** Re-prints the colour of every opaque pixel of `r` in place; alpha is kept. */
export function applyEngrave(r: Raster, o: Engrave): void {
  const { w, h } = r;
  const n = w * h;
  const lum = new Float32Array(n);
  const body: number[] = [];
  for (let i = 0; i < n; i++) {
    lum[i] = (0.2126 * r.data[i * 4]! + 0.7152 * r.data[i * 4 + 1]! + 0.0722 * r.data[i * 4 + 2]!) / 255;
    if (r.data[i * 4 + 3]! >= 128) body.push(lum[i]!);
  }
  if (body.length === 0) return;
  body.sort((a, b) => a - b);
  const lo = body[Math.floor(body.length * 0.03)]!;
  const hi = body[Math.floor(body.length * 0.97)]!;
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i++) tone[i] = Math.min(1, Math.max(0, (lum[i]! - lo) / Math.max(1e-3, hi - lo))) ** (o.gamma ?? 1);
  const soft = boxBlur(tone, w, h, Math.max(1, Math.round(o.pitch / 3)));
  const mixSteps = o.steps ?? 0.5;
  const stops = o.gm.map(hexRgb);
  const screens = ANGLES.map((deg) => {
    const k = Math.max(1, Math.round(Math.max(w, h) / o.pitch));
    const a = (deg * Math.PI) / 180;
    return [Math.round(k * Math.cos(a)), Math.round(k * Math.sin(a))] as const;
  });
  const at = (x: number, y: number): number => {
    const v = soft[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
    return v + (toneStep(v) - v) * mixSteps;
  };
  const line = o.line ?? 0.2;
  const grain = o.grain ?? 0.05;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (r.data[i * 4 + 3]! === 0) continue;
      const t = at(x, y);
      let ink = 0;
      for (let s = 0; s < 3; s++) {
        const cover = smooth(0.8 - s * 0.25, 0.64 - s * 0.25, t);
        if (cover > 0) ink = Math.max(ink, cover * lineAt(x, y, w, h, screens[s]![0], screens[s]![1], o.pitch));
      }
      // Fibre and tooth: a coarse and a fine cell, strongest in the mid tones where pastel sits on the grain.
      const g = (hash(x >> 2, y >> 2, 1) * 0.6 + hash(x, y, 2) * 0.4) * grain * (0.4 + 1.2 * t * (1 - t) * 2);
      const v = Math.min(1, Math.max(0, t * (1 - line * ink) + g));
      const base = gradient(stops, v);
      const slip = gradient(stops, Math.min(1, Math.max(0, at(x + 2, y + 1) * (1 - line * ink) + g)));
      const lb = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
      const ls = 0.2126 * slip[0] + 0.7152 * slip[1] + 0.0722 * slip[2];
      const k = ls > 1 ? lb / ls : 1;
      for (let c = 0; c < 3; c++) r.data[i * 4 + c] = Math.round(Math.min(255, base[c]! * 0.6 + slip[c]! * k * 0.4));
    }
  }
}
