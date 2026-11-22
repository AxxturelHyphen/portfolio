import { createActorBatch } from '../gl/cutout.material.ts';
import { createDollMesh } from '../gl/doll.ts';
import type { CutoutBatch, Gfx } from '../types.ts';
import { createDoll } from '../world/doll.ts';
import type { createGarden } from '../world/garden.ts';
import { CROOK_QUADS, HELD, LANTERN, type VisitorLantern } from '../world/visitor.ts';

/**
 * The visitor's lantern batch and its burlap doll (free roam). The doll's mesh joins the scene at once, drawn at scale
 * zero, so Gfx.warm() compiles its program; it shows on the first step after the lantern batch is in.
 */
export function createFigureLoader(gfx: Gfx, garden: Pick<ReturnType<typeof createGarden>, 'sharedAtlas'>, lantern: VisitorLantern | null) {
  const doll = lantern === null ? null : createDoll();
  const dollMesh = doll === null ? null : createDollMesh(doll);
  if (dollMesh !== null) gfx.scene.add(dollMesh.mesh);
  /** The carried lantern on its crook draws from the shared atlas: its actor batch comes once that is in. */
  const attachLantern = (): CutoutBatch | null => {
    const atlas = garden.sharedAtlas();
    const rect = atlas?.manifest.sprites[LANTERN.sprite];
    if (lantern === null || atlas === null || rect === undefined) return null;
    const color = atlas.tex.color[rect.page];
    const normal = atlas.tex.normal[rect.page];
    if (color === undefined || normal === undefined) return null;
    const batch = createActorBatch(gfx, color, normal, CROOK_QUADS, HELD);
    gfx.scene.add(batch.mesh);
    lantern.attach(batch.writer, rect);
    return batch;
  };
  /** The doll takes the crook's place on the next step; the crook's batch is hidden then. Later calls do nothing. */
  const loadFigure = (batch: CutoutBatch, _variant: 'hi' | 'lo'): Promise<void> => {
    if (lantern !== null && doll !== null && dollMesh !== null) lantern.attachFigure(doll, () => { batch.mesh.visible = false; }, dollMesh.update);
    return Promise.resolve();
  };
  return { attachLantern, loadFigure };
}
