/**
 * The boss code as one chunk and the boss files as data: a bed fetches both with its bytes under free roam
 * (world/bed.ts), never in the first script.
 */
import type { BedId } from '../types.ts';
import type { BossDef } from './boss.ts';

export { createBoss } from './boss.ts';
export { MOTIONS } from './boss.motions.ts';

const beds = import.meta.glob<string>('../../content/bosses/*.json', { eager: true, import: 'bed' });
const urls = import.meta.glob<string>('../../content/bosses/*.json', { eager: true, query: '?url', import: 'default' });
const defs = new Map<BedId, BossDef>();

/**
 * Fetches the bed's boss file once; a bed without one resolves at once. The boss is decoration: a failed file leaves
 * the bed without it (no def) instead of failing the bed; only an abort rejects.
 */
export async function fetchBoss(bed: BedId, signal: AbortSignal): Promise<void> {
  const url = urls[Object.keys(beds).find((p) => beds[p] === bed) ?? ''];
  if (url === undefined || defs.has(bed)) return;
  try {
    const res = await fetch(url, { signal });
    if (res.ok) defs.set(bed, (await res.json()) as BossDef);
  } catch (err) {
    if (signal.aborted) throw err;
  }
}

export const bossOf = (bed: BedId): BossDef | undefined => defs.get(bed);
