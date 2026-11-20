import type { BedId, State } from '../types.ts';
import type { StreamResidency } from '../world/residency.ts';

/**
 * Bed streaming waits out the first load (spec section 10: the overview and shared atlases only): no bed streams until
 * OWN_AFTER_MS after the garden is ready, then the bed the visitor stands in (and the one ahead), then its neighbours
 * on the first walk or AROUND_AFTER_MS after ready. A walk, or a travel to any bed but the gate the garden opens on (a
 * deep link, a sign), widens it to every wanted bed at once, so the bed ahead streams while the visitor is on the way.
 * The rail has no gate (`gate` null): every travel there is the visitor's. A still (?shot) streams from its first frame.
 */
const OWN_AFTER_MS = 2000;
const AROUND_AFTER_MS = 6000;

export interface StreamPace {
  /** The garden is ready (GARDEN_READY): starts the clocks. */
  ready(): void;
  /** Stage 'frame': widens on a walk or a travel past the gate. No allocation. */
  frame(s: State, walking: boolean): void;
}

export function paceStreaming(residency: StreamResidency, gate: BedId | null, still: boolean): StreamPace {
  let wide = still;
  let ownTimer = 0;
  let aroundTimer = 0;
  if (!still) residency.reach('none');

  const widen = (): void => {
    wide = true;
    clearTimeout(ownTimer);
    clearTimeout(aroundTimer);
    residency.reach('all');
  };

  return {
    ready() {
      if (wide) return;
      ownTimer = window.setTimeout(() => residency.reach('own'), OWN_AFTER_MS);
      aroundTimer = window.setTimeout(widen, AROUND_AFTER_MS);
    },
    frame(s, walking) {
      if (!wide && (walking || (s.phase === 'travel' && s.bed !== gate))) widen();
    },
  };
}
