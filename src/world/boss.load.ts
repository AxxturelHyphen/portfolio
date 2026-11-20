/**
 * The boss files, bundled with the boss code into one chunk that a bed loads with its bytes under free roam
 * (world/bed.ts), never in the first script.
 */
import type { BedId } from '../types.ts';
import type { BossDef } from './boss.ts';

export { createBoss } from './boss.ts';
export { MOTIONS } from './boss.motions.ts';

const files = import.meta.glob<BossDef>('../../content/bosses/*.json', { eager: true, import: 'default' });
const defs = Object.values(files);

export const bossOf = (bed: BedId): BossDef | undefined => defs.find((d) => d.bed === bed);
