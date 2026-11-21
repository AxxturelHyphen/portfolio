/**
 * The garden remembers which flowers were visited (a project opened), across visits, in localStorage. Storage can be
 * missing or throw (private windows, blocked site data): every access is wrapped and the garden then remembers for
 * this visit only. Read by the flowers (a visited flower rests open) and the lantern round (ui/play.ts counts the lit
 * flowers and can start over).
 */

export interface GardenMemory {
  visited(id: string): boolean;
  /** Marks a project visited; true when it was new. */
  visit(id: string): boolean;
  onVisit(fn: (id: string) => void): () => void;
  /** Forgets every visit (start over) and tells onReset, so the flowers resting open close at once. */
  reset(): void;
  onReset(fn: () => void): () => void;
}

export const MEMORY_KEY = 'jardin.visited';

/** Minimal Storage surface, so tests can pass a fake. */
export type KeyValue = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): KeyValue | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createMemory(store: KeyValue | null = defaultStore()): GardenMemory {
  const seen = new Set<string>();
  try {
    const raw = store?.getItem(MEMORY_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) for (const id of list) if (typeof id === 'string') seen.add(id);
  } catch {
    seen.clear();
  }
  const listeners = new Set<(id: string) => void>();
  const resets = new Set<() => void>();
  function save(): void {
    try {
      store?.setItem(MEMORY_KEY, JSON.stringify([...seen]));
    } catch {
      /* storage full or blocked: remembered for this visit only */
    }
  }
  return {
    visited: (id) => seen.has(id),
    visit(id) {
      if (seen.has(id)) return false;
      seen.add(id);
      save();
      for (const fn of listeners) fn(id);
      return true;
    },
    reset() {
      seen.clear();
      save();
      for (const fn of resets) fn();
    },
    onReset(fn) {
      resets.add(fn);
      return () => resets.delete(fn);
    },
    onVisit(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
