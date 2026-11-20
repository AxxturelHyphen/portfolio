/**
 * Free roam's moth and the grotto's ivy. Finds the grotto's mouth (the prop whose reference leads to it), sends the moth
 * to live there and answer the carried lantern, gives it an actor batch on the shared atlas once that is in, and parts
 * the ivy curtain (uPart) as the visitor walks up to it. Reduced motion leaves the curtain closed.
 */
import { clamp01, follow } from '../core/motion.ts';
import { createActorBatch, sharedUniforms } from '../gl/cutout.material.ts';
import type { BedId, Clock, CutoutBatch, Gfx } from '../types.ts';
import type { BuildAtlas } from '../world/bed.build.ts';
import { SCENES } from '../world/garden.ts';
import type { GardenMoth } from '../world/moth.ts';
import { MOTH_QUADS } from '../world/moth.draw.ts';

/** The curtain: half its width (metres), how far it parts, the distances it starts and ends parting over, ease (s). */
export const IVY_PART = { halfWidthM: 0.8, partM: 0.14, nearM: 1.4, farM: 3.4, tauS: 0.35 } as const;

const MOTH_SPRITE = 'moth';

export interface MothDrive {
  /** The shared atlas is in: the moth gets its batch (once). */
  attach(atlas: BuildAtlas | null): void;
  /** Stage 'camera', after the lantern: the curtain's parting and the moth's paint order against the visitor. */
  frame(c: Clock, reduced: boolean): void;
}

/** World x, y, z of the prop that leads into the grotto, or null when no bed has one. */
function grottoMouth(): Float32Array | null {
  for (const id of Object.keys(SCENES) as BedId[]) {
    const slot = SCENES[id].slots.find((s) => s.ref === 'gruta');
    if (slot !== undefined) return new Float32Array([slot.x, slot.y, slot.z]);
  }
  return null;
}

/** `visitor` is the visitor's ground point [x, z], `flame` the carried lantern's flame [x, y, z]. */
export function createMothDrive(gfx: Gfx, moth: GardenMoth, flame: Float32Array, visitor: Float32Array): MothDrive | null {
  const mouth = grottoMouth();
  if (mouth === null) return null;
  moth.roam(flame, mouth);
  const part = sharedUniforms.uPart.value;
  part.set(mouth[0]!, mouth[2]!, IVY_PART.halfWidthM, 0);
  let batch: CutoutBatch | null = null;
  let order = 0;

  return {
    attach(atlas) {
      const rect = atlas?.manifest.sprites[MOTH_SPRITE];
      if (batch !== null || atlas === null || rect === undefined) return;
      const color = atlas.tex.color[rect.page];
      const normal = atlas.tex.normal[rect.page];
      if (color === undefined || normal === undefined) return;
      batch = createActorBatch(gfx, color, normal, MOTH_QUADS);
      order = batch.mesh.renderOrder;
      gfx.scene.add(batch.mesh);
      moth.attach(batch.writer, rect);
    },
    frame(c, reduced) {
      const d = Math.hypot(visitor[0]! - mouth[0]!, visitor[1]! - mouth[2]!);
      const goal = reduced ? 0 : IVY_PART.partM * (1 - clamp01((d - IVY_PART.nearM) / (IVY_PART.farM - IVY_PART.nearM)));
      part.w = c.frozen || reduced ? goal : follow(part.w, goal, IVY_PART.tauS, c.dt);
      /** Behind the flame the moth paints before the visitor's batch, so the figure and lantern cover it. */
      if (batch !== null) batch.mesh.renderOrder = moth.pos[2]! < flame[2]! ? order - 1 : order + 1;
    },
  };
}
