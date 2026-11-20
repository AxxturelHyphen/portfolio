import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { ITEM_DEFAULTS, type BedScene3, type Placement3 } from '../src/world/layout.ts';

const BED = /[\\/]content[\\/]beds[\\/][a-z]+\.json$/;
/** Item fields only the build checks read (world/scene.ts); the browser never does. */
const UNREAD: readonly (keyof Placement3)[] = ['size', 'react'];

function slim(it: Placement3): Partial<Placement3> {
  const out: Partial<Placement3> = { ...it };
  for (const k of UNREAD) delete out[k];
  for (const [k, v] of Object.entries(ITEM_DEFAULTS)) if (out[k as keyof Placement3] === v) delete out[k as keyof Placement3];
  return out;
}

/**
 * Vite plugin (build only): content/beds/*.json ship each item without the fields the browser never reads and without
 * the values ITEM_DEFAULTS holds; world/garden.ts fills them back once at load. The source files keep every field for
 * the pipeline and the scene checks.
 */
export function bedsSlim(): Plugin {
  return {
    name: 'jardin-beds-slim',
    apply: 'build',
    enforce: 'pre',
    load(id) {
      if (!BED.test(id)) return null;
      const scene = JSON.parse(readFileSync(id, 'utf8')) as BedScene3;
      return JSON.stringify({ ...scene, layers: scene.layers.map((l) => ({ ...l, items: l.items.map(slim) })) });
    },
  };
}
