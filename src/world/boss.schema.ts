/**
 * Build-time check of content/bosses/<id>.json (cook/PLAN_3D.md F5), in the style of world/scene.ts: every error is
 * listed, the browser only casts. Run by tests/unit/world/boss.spec.ts, so `npm run check` fails before the garden does.
 */
import type { BedId } from '../types.ts';
import type { BossDef } from './boss.ts';
import { MOTIONS } from './boss.motions.ts';
import { BED_IDS, Errors } from './scene.ts';

function checkParts(e: Errors, raw: unknown, id: string, roles: readonly string[]): void {
  const parts = e.arr(raw, `${id}.parts`);
  const seen = new Set<string>();
  const parents: [string, unknown][] = [];
  parts.forEach((v, i) => {
    const path = `${id}.parts[${i}]`;
    const p = e.obj(v, path);
    const role = e.str(p.role, `${path}.role`);
    if (seen.has(role)) e.fail(`${path}.role`, `duplicate role ${role}`);
    seen.add(role);
    e.str(p.sprite, `${path}.sprite`);
    if (p.parent !== null) parents.push([path, e.str(p.parent, `${path}.parent`)]);
    e.tuple(p.pivot, 2, `${path}.pivot`);
    e.tuple(p.offset, 2, `${path}.offset`);
    if (!Number.isInteger(p.z)) e.fail(`${path}.z`, 'expected a paint order integer');
    e.num(p.rest, `${path}.rest`);
  });
  for (const r of roles) if (!seen.has(r)) e.fail(`${id}.parts`, `motion needs role ${r}`);
  for (const r of seen) if (!roles.includes(r)) e.fail(`${id}.parts`, `the motion does not move role ${r}`);
  const roots = parts.filter((v) => (v as { parent?: unknown } | null)?.parent === null).length;
  if (parts.length > 0 && roots !== 1) e.fail(`${id}.parts`, 'expected exactly one root part (parent null)');
  for (const [path, parent] of parents) if (!seen.has(String(parent))) e.fail(`${path}.parent`, `no part has role ${String(parent)}`);
}

/** Throws with every schema error of one boss file listed. */
export function validateBoss(raw: unknown, id: string): BossDef {
  const e = new Errors();
  const b = e.obj(raw, id);
  if (b.id !== id) e.fail(`${id}.id`, `expected "${id}" (the file name)`);
  e.oneOf(b.bed, BED_IDS as readonly BedId[], `${id}.bed`);
  e.tuple(b.at, 3, `${id}.at`);
  e.num(b.scale, `${id}.scale`);
  e.tuple(b.tint, 4, `${id}.tint`, true);
  if (typeof b.scale === 'number' && b.scale <= 0) e.fail(`${id}.scale`, 'expected metres above 0');
  e.num(b.camera, `${id}.camera`, true);
  if (typeof b.camera === 'number' && (b.camera <= 0 || b.camera > 1)) e.fail(`${id}.camera`, 'expected a share above 0, at most 1');
  const motion = MOTIONS[typeof b.motion === 'string' ? b.motion : ''];
  if (motion === undefined) e.fail(`${id}.motion`, `expected one of ${Object.keys(MOTIONS).join(', ')}`);
  checkParts(e, b.parts, id, motion?.roles ?? []);
  if (e.list.length > 0) throw new Error(`boss ${id}: ${e.list.length} error(s)\n  ${e.list.join('\n  ')}`);
  return raw as BossDef;
}
