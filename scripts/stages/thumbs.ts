/// <reference types="node" />
// Thumbs stage: AVIF images for the DOM (Herbario, label card). Per project a static thumbnail at two widths,
// <id>.avif and <id>@2x.avif, plus <id>.strip.avif with the bloom frames in one row. Encoding goes through the
// system ImageMagick with its AVIF (libheif/aom) coder, build time only.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const THUMB_OUT = 'public/thumb';
/** CSS width of the static thumbnail; the @2x file is twice this. */
export const THUMB_WIDTH = 160;
/** Height of one frame in the bloom strip, px. */
export const STRIP_HEIGHT = 160;
const QUALITY = '60';

/** One AVIF of a sprite PNG at the given width (never upscaled), alpha kept. */
export function thumb(spritePng: string, out: string, width: number): void {
  mkdirSync(dirname(out), { recursive: true });
  execFileSync('magick', [spritePng, '-filter', 'Triangle', '-resize', `${width}x>`, '-quality', QUALITY, out]);
}

/** Bloom frames side by side, each scaled to STRIP_HEIGHT and centred in a square cell, alpha kept. */
export function strip(framePngs: readonly string[], out: string): void {
  mkdirSync(dirname(out), { recursive: true });
  const cell = `${STRIP_HEIGHT}x${STRIP_HEIGHT}`;
  const cells = framePngs.flatMap((f) => ['(', f, '-filter', 'Triangle', '-resize', cell, '-background', 'none', '-gravity', 'center', '-extent', cell, ')']);
  execFileSync('magick', [...cells, '+append', '-quality', QUALITY, out]);
}

/** Every DOM image of one project: both static widths and, with frames, the bloom strip. Returns the files written. */
export function projectThumbs(projectId: string, spritePng: string, framePngs: readonly string[] = []): string[] {
  const files = [join(THUMB_OUT, `${projectId}.avif`), join(THUMB_OUT, `${projectId}@2x.avif`)];
  thumb(spritePng, files[0]!, THUMB_WIDTH);
  thumb(spritePng, files[1]!, THUMB_WIDTH * 2);
  if (framePngs.length > 0) {
    files.push(join(THUMB_OUT, `${projectId}.strip.avif`));
    strip(framePngs, files[2]!);
  }
  return files;
}
