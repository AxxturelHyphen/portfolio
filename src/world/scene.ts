import type { BedId, BedScene, GardenLayout, I18n, Lang, Layer, Profile, Project, Slot, SlotView, Tier } from '../types.ts';

/**
 * BedScene schema, tier filtering and slot binding (cook/ARCH.md 2.6).
 * Units: metres. Every x in a bed file (layers, slots, procedural, pose, bounds) is local to the bed's anchor in
 * content/garden.json; y is up from the ground; z ≤ 0 with the nearest layer at 0. Pose fov is vertical degrees,
 * pitch and Placement.rot are degrees. Layers are listed far to near.
 * Validation runs at build (tests/unit/world-stream); the browser only casts.
 */

export const BED_IDS: readonly BedId[] = ['puerta', 'rosaleda', 'estanque', 'semillero', 'gruta', 'salida'];
const TIERS: readonly Tier[] = ['low', 'mid', 'high'];
const FLOWERS: readonly string[] = ['rose', 'lily', 'pod', 'bud'];
const SLOT_KINDS: readonly string[] = ['project', 'link', 'prop'];
const LABELS: readonly string[] = ['left', 'right', 'auto'];
const PROCS: readonly string[] = ['pond', 'sigils', 'sundial', 'fireflies', 'stereoscope'];
const EM_DASH = '\u2014';

export const tierRank = (t: Tier): number => TIERS.indexOf(t);

/** Layers drawn on `tier`: minTier filter, then at most `maxLayers`, dropping the farthest optional layers first. */
export function keptLayers(scene: BedScene, tier: Tier, maxLayers: number): Layer[] {
  const kept = scene.layers.filter((l) => tierRank(l.minTier) <= tierRank(tier));
  for (let i = 0; i < kept.length && kept.length > maxLayers;) {
    if (kept[i]?.minTier === 'low') i++;
    else kept.splice(i, 1);
  }
  return kept;
}

/** Index in `layers` of the layer whose depth is closest to the slot: its flower is painted right after that layer. */
export function slotLayer(layers: readonly Layer[], slot: Slot): number {
  let best = 0;
  for (let i = 1; i < layers.length; i++) {
    if (Math.abs((layers[i]?.z ?? 0) - slot.z) < Math.abs((layers[best]?.z ?? 0) - slot.z)) best = i;
  }
  return best;
}

const pick = (v: I18n, lang: Lang): string => v[lang];
const isRealHref = (href: string): boolean => /^(https?:|mailto:)/.test(href) && !href.includes('[FILL');

export interface BindInput { scene: BedScene; anchorX: number; projects: readonly Project[]; profile: Profile; lang: Lang }

/**
 * Binds slots to content. Project slots are positional templates: projects (already in projectsOf order) take the
 * free slot that accepts their flower, biggest slot first. Unused project slots are left out. Throws when a project
 * finds no slot, so `npm run check` fails before the garden does.
 */
export function bindSlots(b: BindInput): SlotView[] {
  const { scene, anchorX, projects, profile, lang } = b;
  const views: SlotView[] = [];
  const free = scene.slots.filter((s) => s.kind === 'project').sort((a, c) => c.scale - a.scale);
  for (const p of projects) {
    const i = free.findIndex((s) => s.accepts === p.flower);
    const slot = free[i];
    if (slot === undefined) throw new Error(`bed ${scene.id}: no free "${p.flower}" slot for project ${p.id}; add a slot to content/beds/${scene.id}.json`);
    free.splice(i, 1);
    views.push({ id: `${scene.id}/${slot.id}`, kind: 'project', project: p, world: [anchorX + slot.x, slot.y, slot.z], hit: slot.hit, alt: p.title });
  }
  for (const slot of scene.slots) {
    if (slot.kind === 'project') continue;
    const view: SlotView = { id: `${scene.id}/${slot.id}`, kind: slot.kind, world: [anchorX + slot.x, slot.y, slot.z], hit: slot.hit, alt: '' };
    if (slot.kind === 'link') {
      const link = profile.links.find((l) => l.key === slot.ref);
      if (link === undefined) throw new Error(`bed ${scene.id}: link slot ${slot.id} names unknown profile link "${slot.ref ?? ''}"`);
      view.alt = pick(link.label, lang);
      if (isRealHref(link.href)) view.href = link.href;
    } else {
      view.alt = slot.alt === undefined ? '' : pick(slot.alt, lang);
    }
    views.push(view);
  }
  return views;
}

/** Rewrites the alt texts of bound views in place for a new language (no new objects, proxies keep their views). */
export function relabel(views: readonly SlotView[], scene: BedScene, profile: Profile, lang: Lang): void {
  for (const v of views) {
    if (v.kind === 'project') continue;
    const slot = scene.slots.find((s) => `${scene.id}/${s.id}` === v.id);
    if (slot === undefined) continue;
    if (slot.kind === 'link') {
      const link = profile.links.find((l) => l.key === slot.ref);
      if (link !== undefined) v.alt = pick(link.label, lang);
    } else if (slot.alt !== undefined) v.alt = pick(slot.alt, lang);
  }
}

// Build-time validation

type Raw = Record<string, unknown>;

class Errors {
  readonly list: string[] = [];
  fail(path: string, msg: string): void { this.list.push(`${path}: ${msg}`); }
  obj(v: unknown, path: string): Raw {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Raw;
    this.fail(path, 'expected an object');
    return {};
  }
  arr(v: unknown, path: string): unknown[] {
    if (Array.isArray(v)) return v;
    this.fail(path, 'expected an array');
    return [];
  }
  num(v: unknown, path: string, optional = false): void {
    if (optional && v === undefined) return;
    if (typeof v !== 'number' || !Number.isFinite(v)) this.fail(path, 'expected a number');
  }
  str(v: unknown, path: string, optional = false): string {
    if (optional && v === undefined) return '';
    if (typeof v !== 'string' || v === '') { this.fail(path, 'expected a non-empty string'); return ''; }
    if (v.includes(EM_DASH)) this.fail(path, 'contains an em dash');
    return v;
  }
  oneOf(v: unknown, allowed: readonly unknown[], path: string, optional = false): void {
    if (optional && v === undefined) return;
    if (!allowed.includes(v)) this.fail(path, `expected one of ${allowed.join(', ')}`);
  }
  tuple(v: unknown, n: number, path: string, optional = false): void {
    if (optional && v === undefined) return;
    const a = this.arr(v, path);
    if (a.length !== n) this.fail(path, `expected ${n} numbers`);
    a.forEach((x, i) => this.num(x, `${path}[${i}]`));
  }
  i18n(v: unknown, path: string, optional = false): void {
    if (optional && v === undefined) return;
    const o = this.obj(v, path);
    this.str(o.en, `${path}.en`);
    this.str(o.es, `${path}.es`);
  }
  pose(v: unknown, path: string): void {
    const o = this.obj(v, path);
    for (const k of ['x', 'y', 'z', 'pitch', 'fov']) this.num(o[k], `${path}.${k}`);
  }
}

function checkLayer(e: Errors, v: unknown, path: string, ids: Set<string>): number {
  const l = e.obj(v, path);
  const id = e.str(l.id, `${path}.id`);
  if (ids.has(id)) e.fail(`${path}.id`, `duplicate layer id ${id}`);
  ids.add(id);
  e.num(l.z, `${path}.z`);
  if (typeof l.z === 'number' && l.z > 0) e.fail(`${path}.z`, 'layers sit at z <= 0');
  e.oneOf(l.minTier, TIERS, `${path}.minTier`);
  e.num(l.page, `${path}.page`);
  e.arr(l.items, `${path}.items`).forEach((it, i) => {
    const p = e.obj(it, `${path}.items[${i}]`);
    const ip = `${path}.items[${i}]`;
    e.str(p.sprite, `${ip}.sprite`);
    for (const k of ['x', 'y', 'scale']) e.num(p[k], `${ip}.${k}`);
    for (const k of ['rot', 'sway', 'lift', 'dz']) e.num(p[k], `${ip}.${k}`, true);
    if (p.flip !== undefined && typeof p.flip !== 'boolean') e.fail(`${ip}.flip`, 'expected a boolean');
    e.tuple(p.tint, 3, `${ip}.tint`, true);
  });
  return typeof l.z === 'number' ? l.z : 0;
}

function checkSlot(e: Errors, v: unknown, path: string, ids: Set<string>): void {
  const s = e.obj(v, path);
  const id = e.str(s.id, `${path}.id`);
  if (ids.has(id)) e.fail(`${path}.id`, `duplicate slot id ${id}`);
  ids.add(id);
  e.oneOf(s.kind, SLOT_KINDS, `${path}.kind`);
  if (s.kind === 'project') e.oneOf(s.accepts, FLOWERS, `${path}.accepts`);
  else e.str(s.ref, `${path}.ref`);
  for (const k of ['x', 'y', 'z', 'scale']) e.num(s[k], `${path}.${k}`);
  e.str(s.bloom, `${path}.bloom`, true);
  e.tuple(s.hit, 2, `${path}.hit`);
  e.oneOf(s.label, LABELS, `${path}.label`);
  e.i18n(s.alt, `${path}.alt`, s.kind !== 'prop');
}

/** Throws with every schema error of one bed file listed. */
export function validateBedScene(raw: unknown, id: BedId): BedScene {
  const e = new Errors();
  const s = e.obj(raw, id);
  if (s.id !== id) e.fail(`${id}.id`, `expected "${id}"`);
  e.i18n(s.title, `${id}.title`);
  e.i18n(s.alt, `${id}.alt`);
  e.pose(s.pose, `${id}.pose`);
  e.tuple(s.bounds, 2, `${id}.bounds`);
  const layerIds = new Set<string>();
  const zs = e.arr(s.layers, `${id}.layers`).map((l, i) => checkLayer(e, l, `${id}.layers[${i}]`, layerIds));
  if (zs.length < 4 || zs.length > 7) e.fail(`${id}.layers`, 'expected 4 to 7 depth layers');
  for (let i = 1; i < zs.length; i++) if ((zs[i] ?? 0) < (zs[i - 1] ?? 0)) e.fail(`${id}.layers[${i}].z`, 'layers go far to near');
  const slotIds = new Set<string>();
  e.arr(s.slots, `${id}.slots`).forEach((v, i) => checkSlot(e, v, `${id}.slots[${i}]`, slotIds));
  e.arr(s.procedural, `${id}.procedural`).forEach((v, i) => {
    const p = e.obj(v, `${id}.procedural[${i}]`);
    e.oneOf(p.type, PROCS, `${id}.procedural[${i}].type`);
    for (const k of ['x', 'y', 'z', 'w', 'h']) e.num(p[k], `${id}.procedural[${i}].${k}`);
  });
  e.str(s.behaviour, `${id}.behaviour`, true);
  if (e.list.length > 0) throw new Error(`bed scene ${id}: ${e.list.length} error(s)\n  ${e.list.join('\n  ')}`);
  return raw as BedScene;
}

/** Throws with every schema error of content/garden.json listed. */
export function validateGarden(raw: unknown): GardenLayout {
  const e = new Errors();
  const g = e.obj(raw, 'garden');
  const order = e.arr(g.order, 'garden.order');
  if (order.length !== BED_IDS.length || BED_IDS.some((b) => !order.includes(b))) e.fail('garden.order', 'expected every bed exactly once');
  const anchors = e.obj(g.anchors, 'garden.anchors');
  for (const b of BED_IDS) e.num(anchors[b], `garden.anchors.${b}`);
  e.oneOf(g.grutaHost, BED_IDS.filter((b) => b !== 'gruta'), 'garden.grutaHost');
  e.pose(g.overview, 'garden.overview');
  e.tuple(g.pan, 2, 'garden.pan');
  const shots = e.obj(g.shots, 'garden.shots');
  for (const [k, v] of Object.entries(shots)) {
    if (!/^S\d\d$/.test(k)) e.fail(`garden.shots.${k}`, 'expected a shot id like S01');
    const s = e.obj(v, `garden.shots.${k}`);
    if (typeof s.hash !== 'string' || !/^#\/(b\/[a-z]+|p\/[a-z0-9-]+)?$/.test(s.hash)) e.fail(`garden.shots.${k}.hash`, 'expected #/, #/b/<bed> or #/p/<id>');
    e.num(s.t, `garden.shots.${k}.t`);
    if (s.pose !== undefined) e.pose(s.pose, `garden.shots.${k}.pose`);
    e.tuple(s.viewport, 2, `garden.shots.${k}.viewport`, true);
  }
  if (e.list.length > 0) throw new Error(`garden layout: ${e.list.length} error(s)\n  ${e.list.join('\n  ')}`);
  return raw as GardenLayout;
}
