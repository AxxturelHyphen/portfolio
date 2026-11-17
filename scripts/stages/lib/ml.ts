/// <reference types="node" />
// Bridge to the local ML matting fallback (scripts/py/matte.py in its own venv, scripts/py/.venv). Build time only.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Raster } from '../raster.ts';
import { readImage, writeImage } from './image.ts';

const PY = 'scripts/py/.venv/bin/python';
const SCRIPT = 'scripts/py/matte.py';
export const ML_MODEL = 'birefnet-general';

export const mlAvailable = (): boolean => existsSync(PY);

export interface MlResult { alpha: Float32Array; tool: string }

/** Runs the matting model on an RGB raster; returns alpha 0..1 at the raster's size and the tool line for the log. */
export function mlMatte(rgb: Raster, model = ML_MODEL): MlResult {
  if (!mlAvailable()) throw new Error(`ML matting needs ${PY}: run "uv venv -p 3.12 scripts/py/.venv && uv pip install -p scripts/py/.venv -r scripts/py/requirements.txt"`);
  const dir = mkdtempSync(join(tmpdir(), 'jardin-matte-'));
  try {
    const src = join(dir, 'in.png');
    const dst = join(dir, 'out.png');
    writeImage(src, rgb, ['-alpha', 'off']);
    const log = execFileSync(PY, [SCRIPT, model, src, dst], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const info = JSON.parse(log.trim().split('\n').pop() ?? '{}') as { provider?: string };
    const m = readImage(dst, Math.max(rgb.w, rgb.h));
    if (m.w !== rgb.w || m.h !== rgb.h) throw new Error(`matte size ${m.w}x${m.h} differs from ${rgb.w}x${rgb.h}`);
    const alpha = new Float32Array(m.w * m.h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = m.data[i * 4]! / 255;
    return { alpha, tool: `rembg ${model} (${info.provider ?? 'unknown provider'})` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
