import { DAY } from '../core/motion.ts';
import { writeDaylight } from '../gl/lights.ts';
import type { Clock, DebugParams } from '../types.ts';
import { createPalette, paletteAt, wrapHour } from '../world/daytime.ts';
import type { PlaceLighting } from './place.ts';

/**
 * The garden's clock of day (world/daytime.ts): the hour runs from the golden afternoon at the pace of DAY in
 * core/motion.ts. `?hour=H` pins it; the bench (`?bench=1`) and a frozen clock (`?t`) pin it to night unless `?hour` is given,
 * so tests and stills keep the lantern night; under reduced motion it stays at its start.
 */
export interface Daylight {
  readonly hour: number;
  /** Each place's own light (garden/place.ts), written under the day's palette. */
  readonly place: PlaceLighting;
  /** Stage 'world': advances the hour, eases the place's light under the day's palette, then writes the day. No allocation. */
  frame(c: Clock, reduced: boolean): void;
}

const HOURS_PER_S = 24 / DAY.cycleS;

export function createDaylight(q: DebugParams, test: boolean, place: PlaceLighting): Daylight {
  const pinned = q.hour !== undefined ? wrapHour(q.hour) : test || q.t !== undefined ? DAY.pinnedHour : null;
  const palette = createPalette();
  let hour = pinned ?? DAY.startHour;
  return {
    get hour() {
      return hour;
    },
    place,
    frame(c, reduced) {
      if (pinned !== null) hour = pinned;
      else if (c.frozen) hour = DAY.pinnedHour;
      else if (!reduced) hour = wrapHour(hour + c.dt * HOURS_PER_S);
      paletteAt(hour, palette);
      place.frame(c.dt, c.frozen, palette);
      writeDaylight(palette);
    },
  };
}
