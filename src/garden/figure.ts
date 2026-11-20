import { createActorBatch } from '../gl/cutout.material.ts';
import { loadAtlas, uploadTexture } from '../gl/ktx2.ts';
import type { CutoutBatch, Gfx } from '../types.ts';
import { fetchManifest } from '../world/bed.ts';
import type { createGarden } from '../world/garden.ts';
import { FIGURE_SPRITES, type FigureRects } from '../world/puppet.ts';
import { HELD, LANTERN, VISITOR_QUADS, type VisitorLantern } from '../world/visitor.ts';

/** The visitor's lantern batch and figure page (free roam), loaded once the shared atlas is in. */
export function createFigureLoader(gfx: Gfx, garden: Pick<ReturnType<typeof createGarden>, 'sharedAtlas'>, lantern: VisitorLantern | null) {
  /** The carried lantern draws from the shared atlas: its actor batch comes once that is in. */
  const attachLantern = (): CutoutBatch | null => {
    const atlas = garden.sharedAtlas();
    const rect = atlas?.manifest.sprites[LANTERN.sprite];
    if (lantern === null || atlas === null || rect === undefined) return null;
    const color = atlas.tex.color[rect.page];
    const normal = atlas.tex.normal[rect.page];
    if (color === undefined || normal === undefined) return null;
    const batch = createActorBatch(gfx, color, normal, VISITOR_QUADS, HELD);
    gfx.scene.add(batch.mesh);
    lantern.attach(batch.writer, rect);
    return batch;
  };
  /**
   * The figure's page in `variant`: decoded off the main thread, uploaded one texture a frame. The first load brings
   * the figure in; a later one swaps the page under it and frees the one it replaces.
   */
  const loadFigure = async (batch: CutoutBatch, variant: 'hi' | 'lo'): Promise<void> => {
    const signal = new AbortController().signal;
    const m = await fetchManifest('roam', signal);
    const held = m.sprites['fg/lantern'];
    const crook = m.sprites['fg/crook'];
    if (lantern === null || held === undefined || crook === undefined || FIGURE_SPRITES.some((id) => m.sprites[id]?.page !== held.page)) return;
    const tex = await loadAtlas(gfx, m, variant, signal);
    const color = tex.color[held.page];
    const normal = tex.normal[held.page];
    if (color === undefined || normal === undefined) return;
    for (const t of [color, normal]) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      uploadTexture(gfx, t);
    }
    const show = (): void => {
      const before = [batch.uniforms.uColor.value, batch.uniforms.uNormal.value];
      batch.uniforms.uColor.value = color;
      batch.uniforms.uNormal.value = normal;
      if (lantern.figure) for (const t of before) t.dispose();
    };
    if (lantern.figure) show();
    else lantern.attachFigure(m.sprites as FigureRects, held, crook, show);
  };
  return { attachLantern, loadFigure };
}
