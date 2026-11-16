import type { ModeDecision, ModeEnv } from '../types.ts';

/**
 * Start mode (spec section 6). Self-contained on purpose: scripts/prerender.ts inlines its source into the
 * boot stub that runs before first paint, so it may not reference anything outside its own body.
 * No WebGL2: Herbario, garden never loads. Else ?mode wins. Else reduced motion or Save-Data: Herbario.
 * With reduced motion or Save-Data the garden chunk loads only on "Enter the garden", never at idle.
 */
export function decideMode(env: ModeEnv): ModeDecision {
  if (!env.webgl2) return { mode: 'herbario', loadGarden: false };
  const lighter = env.reducedMotion || env.saveData;
  if (env.q.mode !== undefined) return { mode: env.q.mode, loadGarden: env.q.mode === 'garden' || !lighter };
  if (lighter) return { mode: 'herbario', loadGarden: false };
  return { mode: 'garden', loadGarden: true };
}
