/// <reference types="node" />
// The pin of a sheet on the wall (La Salida): a small round-headed pin drawn in code (ImageMagick, build time only)
// with a soft shadow, read back as a raster. Nothing of it comes from a plate.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readImage } from './lib/image.ts';
import type { Raster } from './raster.ts';

const SIDE = 96;

/** A dusty red pin head, lit from the upper left, on a transparent ground. */
export function drawPin(): Raster {
  const dir = mkdtempSync(join(tmpdir(), 'jardin-pin-'));
  try {
    const out = join(dir, 'pin.png');
    execFileSync('magick', [
      '-size', `${SIDE}x${SIDE}`, 'xc:none',
      '-fill', 'rgba(24,12,14,0.42)', '-draw', 'circle 53,55 53,81',
      '-fill', '#8a3d3a', '-stroke', '#4b2423', '-strokewidth', '3', '-draw', 'circle 46,46 46,76',
      '-stroke', 'none', '-fill', '#b9645c', '-draw', 'circle 52,53 52,70',
      '-fill', '#e3b2a0', '-draw', 'ellipse 36,34 9,6 0,360',
      out,
    ]);
    return readImage(out, SIDE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
