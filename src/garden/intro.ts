import type { Texture } from 'three';
import { loadAtlas, uploadTexture } from '../gl/ktx2.ts';
import type { GlGfx } from '../gl/renderer.ts';
import { fetchManifest } from '../world/bed.ts';

/**
 * The kaleidoscope intro page (cook/ART.md section 3.1): the `intro` atlas page is fetched, transcoded and uploaded
 * at boot, then handed to the film pass every frame of the intro with the intro channel. Until it is uploaded the
 * film shows the plain intro ground (never black). Once the intro has played the page is released.
 */
export interface IntroDrive {
  /** Stage 'world': `playing` while the phase is intro or the channel is below 1. No allocation. */
  frame(intro: number, playing: boolean): void;
}

export function createIntroDrive(gfx: GlGfx, variant: 'hi' | 'lo'): IntroDrive {
  let page: Texture | null = null;
  let done = false;
  const abort = new AbortController();
  void (async () => {
    const m = await fetchManifest('intro', abort.signal);
    const tex = await loadAtlas(gfx, m, variant, abort.signal);
    for (const n of tex.normal) n.dispose();
    for (let i = 1; i < tex.color.length; i++) tex.color[i]?.dispose();
    const first = tex.color[0];
    if (first === undefined) return;
    if (done) {
      first.dispose();
      return;
    }
    uploadTexture(gfx, first);
    page = first;
  })().catch(() => {
    page = null;
  });

  return {
    frame(intro, playing) {
      if (playing) {
        gfx.setIntro(page, intro);
        return;
      }
      if (done) return;
      done = true;
      abort.abort();
      gfx.setIntro(null, 1);
      page?.dispose();
      page = null;
    },
  };
}
