// Quality heuristic of a cutout: decides whether the classical matte holds or the ML fallback runs.
import type { Raster } from '../raster.ts';
import { close, count, distanceTo, fillHoles, open, perimeter, type Mask } from './morph.ts';

export interface Quality {
  ok: boolean;
  reasons: string[];
  /** Share of the plate covered by the mask. */
  coverage: number;
  /** Mask perimeter against the perimeter of its smoothed self (1 = clean outline). */
  ragged: number;
  /** Share of opaque pixels in the outer 6 px of the mask that still read as paper (a halo). */
  leftover: number;
  /** Pixels the key missed inside the sealed silhouette (wide closing, holes filled) that are not plain paper,
   * against the mask area: pale petals and white paint drawn without a closed outline. */
  pale: number;
  /** Share of the paper grid seen directly. */
  seen: number;
}

export const LIMITS = { coverageMax: 0.55, coverageMin: 0.004, raggedMax: 1.9, leftoverMax: 0.12, paleMax: 0.065, seenMin: 0.2 };

/** key is each pixel's distance to the paper, lo the key's low threshold. */
export function judge(m: Mask, image: Raster, key: Float32Array, lo: number, seen: number): Quality {
  const n = m.w * m.h;
  const area = count(m);
  const coverage = area / n;
  const side = Math.max(m.w, m.h);
  const r = Math.max(2, Math.round(side / 600));
  const smoothPerimeter = perimeter(close(open(m, r), r));
  const ragged = smoothPerimeter > 0 ? perimeter(m) / smoothPerimeter : 1;
  const inDist = distanceTo(m.w, m.h, (i) => m.m[i] === 0, true);
  let rim = 0;
  let paperish = 0;
  for (let i = 0; i < n; i++) {
    if (m.m[i] === 0 || inDist[i]! > 6 || image.data[i * 4 + 3]! < 128) continue;
    rim++;
    if (key[i]! < lo) paperish++;
  }
  const leftover = rim > 0 ? paperish / rim : 0;
  const sealed = close(m, side / 60);
  fillHoles(sealed, key, () => true);
  let missed = 0;
  for (let i = 0; i < n; i++) if (sealed.m[i] === 1 && m.m[i] === 0 && key[i]! > lo * 0.5) missed++;
  const pale = area > 0 ? missed / area : 0;
  const reasons: string[] = [];
  if (coverage > LIMITS.coverageMax) reasons.push(`coverage ${coverage.toFixed(2)}`);
  if (coverage < LIMITS.coverageMin) reasons.push(`coverage ${coverage.toFixed(4)}`);
  if (ragged > LIMITS.raggedMax) reasons.push(`ragged ${ragged.toFixed(2)}`);
  if (leftover > LIMITS.leftoverMax) reasons.push(`leftover ${leftover.toFixed(2)}`);
  if (pale > LIMITS.paleMax) reasons.push(`pale ${pale.toFixed(2)}`);
  if (seen < LIMITS.seenMin) reasons.push(`paper seen ${seen.toFixed(2)}`);
  return { ok: reasons.length === 0, reasons, coverage, ragged, leftover, pale, seen };
}
