/**
 * The lantern round's pure state (ui/play.ts shows it): every project flower is one to light, and a flower is lit once
 * its project was opened (world/memory.ts remembers those in jardin.visited). A bed is done when all its project flowers
 * are lit, the round when every flower is. Each one-time note (a bed done, the garden complete) is kept in
 * localStorage next to the visits (QUEST_KEY), so it shows once; notes already earned when the round loads are taken
 * as shown, never replayed. Storage can be missing or throw: the round then remembers for this visit only.
 */

import type { KeyValue } from '../world/memory.ts';

export const QUEST_KEY = 'jardin.quest';

/** One flower to light: a project and the bed it grows in. */
export interface QuestFlower { readonly id: string; readonly bed: string }

/** What a new visit earned, to show once: a bed done, or the whole garden. */
export type QuestNote = { k: 'bed'; bed: string } | { k: 'complete' } | null;

export interface Quest {
  readonly total: number;
  lit(): number;
  complete(): boolean;
  /** A project was just visited: the note it earned that has not shown yet, now marked shown. */
  note(id: string): QuestNote;
  /** Forgets the shown notes (start over; the caller forgets the visits). */
  reset(): void;
}

interface Shown { beds: string[]; complete: boolean }

function read(store: KeyValue | null): Shown {
  try {
    const raw: unknown = JSON.parse(store?.getItem(QUEST_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return { beds: [], complete: false };
    const o = raw as { beds?: unknown; complete?: unknown };
    const beds = Array.isArray(o.beds) ? o.beds.filter((b): b is string => typeof b === 'string') : [];
    return { beds, complete: o.complete === true };
  } catch {
    return { beds: [], complete: false };
  }
}

export function createQuest(flowers: readonly QuestFlower[], visited: (id: string) => boolean, store: KeyValue | null): Quest {
  const shown = read(store);
  const bedDone = (bed: string): boolean => flowers.every((f) => f.bed !== bed || visited(f.id));
  const lit = (): number => flowers.reduce((n, f) => n + (visited(f.id) ? 1 : 0), 0);
  const complete = (): boolean => flowers.length > 0 && lit() === flowers.length;

  function save(): void {
    try {
      store?.setItem(QUEST_KEY, JSON.stringify(shown));
    } catch {
      /* storage blocked: the notes may show again on the next load */
    }
  }

  /** Notes earned before this round loaded count as shown. */
  function settle(): void {
    for (const f of flowers) if (bedDone(f.bed) && !shown.beds.includes(f.bed)) shown.beds.push(f.bed);
    shown.complete = shown.complete || complete();
  }

  settle();
  return {
    total: flowers.length,
    lit,
    complete,
    note(id) {
      const f = flowers.find((x) => x.id === id);
      if (f === undefined || !visited(id)) return null;
      let out: QuestNote = null;
      if (complete() && !shown.complete) out = { k: 'complete' };
      else if (bedDone(f.bed) && !shown.beds.includes(f.bed)) out = { k: 'bed', bed: f.bed };
      settle();
      if (out !== null) save();
      return out;
    },
    reset() {
      shown.beds.length = 0;
      shown.complete = false;
      save();
    },
  };
}
