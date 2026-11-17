/// <reference types="node" />
// The [FILL] Coupé (cook/ART.md section 2.5): a code-drawn paper-cut two-door side view, cut from the card stock
// plate, with a small string tag that reads "[FILL] Coupé". It stands in until the owner's photos exist; the swap
// is one recipe job. Drawn with the system ImageMagick (build time only) and read back as a raster.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readImage } from './lib/image.ts';
import type { Raster } from './raster.ts';

const W = 1024;
const H = 420;
/** Body outline: long bonnet, two-door cabin, short boot, in px of the W x H canvas. */
const BODY = 'M 40,300 L 60,250 Q 90,228 180,222 L 330,214 Q 380,150 450,128 L 640,124 Q 720,130 770,200 L 900,214 Q 960,222 978,262 L 984,300 Z';
const WINDOWS = 'M 362,212 Q 400,162 456,146 L 560,144 L 560,212 Z M 578,144 L 632,144 Q 690,150 730,206 L 578,210 Z';
const WHEELS = [[230, 300], [800, 300]] as const;
const RIM = '#ead9bb';
const SHADE = '#3a2c20';

/** The car on the card stock texture of `cardFile`, transparent around it. */
export function drawPaperCar(cardFile: string): Raster {
  const dir = mkdtempSync(join(tmpdir(), 'jardin-car-'));
  try {
    const out = join(dir, 'car.png');
    const wheels = WHEELS.flatMap(([x, y]) => ['-draw', `circle ${x},${y} ${x + 62},${y}`]);
    const hubs = WHEELS.flatMap(([x, y]) => ['-draw', `circle ${x},${y} ${x + 20},${y}`]);
    execFileSync('magick', [
      cardFile, '-resize', `${W}x${W}^`, '-gravity', 'center', '-extent', `${W}x${H}`, '+gravity', '-alpha', 'set',
      '(', '-size', `${W}x${H}`, 'xc:black', '-fill', 'white', '-draw', `path '${BODY}'`, ...wheels, '-draw', 'roundrectangle 880,70 1010,118 6,6', '-stroke', 'white', '-strokewidth', '4', '-draw', 'line 905,226 935,120', '-alpha', 'off', ')',
      '-compose', 'copy_opacity', '-composite', '-compose', 'over',
      '-fill', 'none', '-stroke', RIM, '-strokewidth', '5', '-draw', `path '${BODY}'`,
      '-fill', SHADE, '-stroke', RIM, '-strokewidth', '3', '-draw', `path '${WINDOWS}'`, ...wheels,
      '-fill', RIM, '-stroke', 'none', ...hubs,
      '-stroke', RIM, '-strokewidth', '2', '-draw', 'line 568,150 568,290', '-draw', 'line 940,236 960,236',
      '-draw', 'line 905,226 935,120',
      '-fill', '#e9dcc0', '-stroke', SHADE, '-strokewidth', '2', '-draw', 'roundrectangle 880,70 1010,118 6,6',
      '-fill', SHADE, '-stroke', 'none', '-draw', 'circle 892,94 897,94',
      '-pointsize', '24', '-annotate', '+904+103', '[FILL] Coupé',
      out,
    ]);
    return readImage(out, W);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
