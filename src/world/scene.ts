import type { BedId, BedScene, I18n, Lang, Layer, Profile, Project, Slot, SlotView, Tier } from '../types.ts';
import type { BedScene3, WorldLayout } from './layout.ts';

/**
 * BedScene schema, tier filtering and slot binding (cook/ARCH.md 2.6, cook/ART.md section 2).
 * Units: metres, world coordinates (x along the garden, y up, z toward the camera, ground at y 0). Layers are atlas
 * page groups listed far to near; each item stands at its own 3D position (layout.ts Placement3). Pose is the bed's
 * rail key (degrees, fov vertical). Validation runs at build (tests/unit/world); the browser only casts.
 */

export const BED_IDS: readonly BedId[] = ['puerta', 'rosaleda', 'estanque', 'semillero', 'gruta', 'salida'];
const TIERS: readonly Tier[] = ['low', 'mid', 'high'];
const FLOWERS: readonly string[] = ['rose', 'lily', 'pod', 'bud'];
const SLOT_KINDS: readonly string[] = ['project', 'link', 'prop'];
const LABELS: readonly string[] = ['left', 'right', 'auto'];
const PROCS: readonly string[] = ['pond', 'sigils', 'sundial', 'fireflies', 'stereoscope'];
const SIZES: readonly string[] = ['hero', 'large', 'medium', 'small'];
const GROUPS: readonly string[] = ['L', 'M', 'D'];
const FEET: readonly string[] = ['sprays', 'pot', 'clump', 'none'];
const MODES: readonly string[] = ['rail', 'roam'];
const EM_DASH = '\u2014';

export const tierRank = (t: Tier): number => TIERS.indexOf(t);

/** Layers drawn on `tier`: minTier filter, then at most `maxLayers`, dropping the farthest optional layers first. */
export function keptLayers<L extends Layer>(scene: { layers: L[] }, tier: Tier, maxLayers: number): L[] {
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

export interface BindInput { scene: BedScene; projects: readonly Project[]; profile: Profile; lang: Lang }

/** A slot's own stand point (free roam) rides on its view. */
function withStand(view: SlotView, slot: Slot): SlotView {
  if (slot.stand !== undefined) view.stand = slot.stand;
  return view;
}

/**
 * Binds slots to content. Project slots are positional templates: projects (already in projectsOf order) take the
 * free slot that accepts their flower, biggest slot first. Unused project slots are left out. Throws when a project
 * finds no slot, so `npm run check` fails before the garden does.
 */
export function bindSlots(b: BindInput): SlotView[] {
  const { scene, projects, profile, lang } = b;
  const views: SlotView[] = [];
  const free = scene.slots.filter((s) => s.kind === 'project').sort((a, c) => c.scale - a.scale);
  for (const p of projects) {
    const i = free.findIndex((s) => s.accepts === p.flower);
    const slot = free[i];
    if (slot === undefined) throw new Error(`bed ${scene.id}: no free "${p.flower}" slot for project ${p.id}; add a slot to content/beds/${scene.id}.json`);
    free.splice(i, 1);
    views.push(withStand({ id: `${scene.id}/${slot.id}`, kind: 'project', project: p, world: [slot.x, slot.y, slot.z], hit: slot.hit, alt: p.title }, slot));
  }
  for (const slot of scene.slots) {
    if (slot.kind === 'project') continue;
    const view = withStand({ id: `${scene.id}/${slot.id}`, kind: slot.kind, world: [slot.x, slot.y, slot.z], hit: slot.hit, alt: '' }, slot);
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
  bool(v: unknown, path: string, optional = false): void {
    if (optional && v === undefined) return;
    if (typeof v !== 'boolean') this.fail(path, 'expected a boolean');
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

function checkItem(e: Errors, v: unknown, ip: string): void {
  const p = e.obj(v, ip);
  e.str(p.sprite, `${ip}.sprite`);
  for (const k of ['x', 'y', 'z', 'scale', 'hinge', 'lean']) e.num(p[k], `${ip}.${k}`);
  e.num(p.h, `${ip}.h`, true);
  e.num(p.w, `${ip}.w`, true);
  if (p.h === undefined && p.w === undefined) e.fail(ip, 'needs h or w (world size at scale 1)');
  for (const k of ['rot', 'sway', 'lift', 'dz']) e.num(p[k], `${ip}.${k}`, true);
  e.oneOf(p.size, SIZES, `${ip}.size`);
  e.oneOf(p.group, GROUPS, `${ip}.group`);
  e.oneOf(p.foot, FEET, `${ip}.foot`);
  e.bool(p.shadow, `${ip}.shadow`);
  e.bool(p.react, `${ip}.react`);
  for (const k of ['flip', 'flat', 'wing']) e.bool(p[k], `${ip}.${k}`, true);
  e.tuple(p.tint, 3, `${ip}.tint`, true);
  e.oneOf(p.only, MODES, `${ip}.only`, true);
}

function checkLayer(e: Errors, v: unknown, path: string, ids: Set<string>): number {
  const l = e.obj(v, path);
  const id = e.str(l.id, `${path}.id`);
  if (ids.has(id)) e.fail(`${path}.id`, `duplicate layer id ${id}`);
  ids.add(id);
  e.num(l.z, `${path}.z`);
  e.oneOf(l.minTier, TIERS, `${path}.minTier`);
  e.num(l.page, `${path}.page`);
  e.arr(l.items, `${path}.items`).forEach((it, i) => checkItem(e, it, `${path}.items[${i}]`));
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
  for (const k of ['x', 'y', 'z', 'scale', 'hinge']) e.num(s[k], `${path}.${k}`);
  e.str(s.bloom, `${path}.bloom`, true);
  e.tuple(s.hit, 2, `${path}.hit`);
  e.tuple(s.stand, 2, `${path}.stand`, true);
  e.oneOf(s.label, LABELS, `${path}.label`);
  e.i18n(s.alt, `${path}.alt`, s.kind !== 'prop');
}

/** Throws with every schema error of one bed file listed. */
export function validateBedScene(raw: unknown, id: BedId): BedScene3 {
  const e = new Errors();
  const s = e.obj(raw, id);
  if (s.id !== id) e.fail(`${id}.id`, `expected "${id}"`);
  e.i18n(s.title, `${id}.title`);
  e.i18n(s.alt, `${id}.alt`);
  e.pose(s.pose, `${id}.pose`);
  if (typeof s.shade !== 'string' || !/^#[0-9a-f]{6}$/.test(s.shade)) e.fail(`${id}.shade`, 'expected a #rrggbb place shadow colour');
  e.tuple(s.bounds, 2, `${id}.bounds`);
  const layerIds = new Set<string>();
  const zs = e.arr(s.layers, `${id}.layers`).map((l, i) => checkLayer(e, l, `${id}.layers[${i}]`, layerIds));
  if (zs.length < 1 || zs.length > 12) e.fail(`${id}.layers`, 'expected 1 to 12 page groups');
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
  return raw as BedScene3;
}

/** Throws with every schema error of content/garden.json listed. */
export function validateGarden(raw: unknown): WorldLayout {
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
  checkWorld(e, g);
  if (e.list.length > 0) throw new Error(`garden layout: ${e.list.length} error(s)\n  ${e.list.join('\n  ')}`);
  return raw as WorldLayout;
}

function checkFilm(e: Errors, v: unknown, path: string): void {
  const o = e.obj(v, path);
  for (const k of ['x', 'y', 'z', 'pitch', 'yaw', 'fov']) e.num(o[k], `${path}.${k}`);
}

function checkWorld(e: Errors, g: Raw): void {
  const rail = e.obj(g.rail, 'garden.rail');
  const keys = e.arr(rail.keys, 'garden.rail.keys');
  keys.forEach((k, i) => {
    checkFilm(e, k, `garden.rail.keys[${i}]`);
    const o = e.obj(k, `garden.rail.keys[${i}]`);
    if (o.bed !== undefined) e.oneOf(o.bed, BED_IDS, `garden.rail.keys[${i}].bed`);
    const prev = keys[i - 1] as Raw | undefined;
    if (prev !== undefined && typeof prev.x === 'number' && typeof o.x === 'number' && o.x <= prev.x) e.fail(`garden.rail.keys[${i}].x`, 'keys go west to east');
  });
  const p = e.obj(rail.portrait, 'garden.rail.portrait');
  for (const k of ['y', 'dz', 'pitch', 'fov']) e.num(p[k], `garden.rail.portrait.${k}`);
  e.num(rail.yawLeadDeg, 'garden.rail.yawLeadDeg');
  for (const [b, f] of Object.entries(e.obj(rail.off, 'garden.rail.off'))) {
    e.oneOf(b, BED_IDS, `garden.rail.off.${b}`);
    checkFilm(e, f, `garden.rail.off.${b}`);
  }
  for (const [k, f] of Object.entries(e.obj(g.film, 'garden.film'))) checkFilm(e, f, `garden.film.${k}`);
  const gr = e.obj(g.ground, 'garden.ground');
  const path = e.obj(gr.path, 'garden.ground.path');
  e.arr(path.points, 'garden.ground.path.points').forEach((pt, i) => e.tuple(pt, 2, `garden.ground.path.points[${i}]`));
  e.arr(path.spur, 'garden.ground.path.spur').forEach((pt, i) => e.tuple(pt, 2, `garden.ground.path.spur[${i}]`));
  e.num(path.width, 'garden.ground.path.width');
  e.arr(gr.puddles, 'garden.ground.puddles').forEach((pt, i) => e.tuple(pt, 2, `garden.ground.puddles[${i}]`));
  const pond = e.obj(gr.pond, 'garden.ground.pond');
  for (const k of ['x', 'z', 'rx', 'rz']) e.num(pond[k], `garden.ground.pond.${k}`);
  e.num(gr.length, 'garden.ground.length');
  const wall = e.obj(gr.wall, 'garden.ground.wall');
  for (const k of ['z', 'h', 'flatW']) e.num(wall[k], `garden.ground.wall.${k}`);
  e.tuple(wall.flatYaw, 2, 'garden.ground.wall.flatYaw');
  e.arr(wall.piers, 'garden.ground.wall.piers').forEach((x, i) => e.num(x, `garden.ground.wall.piers[${i}]`));
  e.arr(wall.low, 'garden.ground.wall.low').forEach((x, i) => e.tuple(x, 3, `garden.ground.wall.low[${i}]`));
  const sl = e.obj(gr.shadowLength, 'garden.ground.shadowLength');
  for (const b of BED_IDS) e.num(sl[b], `garden.ground.shadowLength.${b}`);
  e.tuple(gr.shadowDir, 2, 'garden.ground.shadowDir');
  const cl = e.obj(gr.clumps, 'garden.ground.clumps');
  e.num(cl.high, 'garden.ground.clumps.high');
  e.num(cl.low, 'garden.ground.clumps.low');
}
