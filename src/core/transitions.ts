import type { BedId, ChannelName, Ev, Place, ProjectId, SlotId, State } from '../types.ts';
import { CAMERA, INTRO, travelS } from './motion.ts';
import type { DriveChannel } from './spring.ts';

/**
 * The transition table of cook/ARCH.md 2.1 as pure functions of (state, event) plus channel targets.
 * Inputs only set the intent (reduce); step() walks one legal phase toward it. No queue: the latest intent wins,
 * and a changed intent only retargets channels, which continue from their value and velocity.
 */

export type Channels = Readonly<Record<ChannelName, DriveChannel>>;

/** What the table needs to know about the garden. */
export interface Geo {
  readonly order: readonly BedId[];
  anchor(b: BedId): number;
  bedOf(id: ProjectId): BedId | null;
  slotOf(id: ProjectId): SlotId | null;
  /** The bed is entered in the garden (slots bound, proxies mounted): a project there may open. */
  bedReady(b: BedId): boolean;
  /** World X the overview shows (the rig's pan), or null when no garden runs. */
  viewX(): number | null;
}

export const OVERVIEW: Place = { k: 'overview' };

export const samePlace = (a: Place, b: Place): boolean =>
  a.k === 'overview' ? b.k === 'overview' : a.k === 'bed' ? b.k === 'bed' && a.bed === b.bed : b.k === 'project' && a.id === b.id;

const projectOf = (p: Place): ProjectId | null => (p.k === 'project' ? p.id : null);

/** The bed a place lives in: null for the overview. */
export function bedOfPlace(p: Place, g: Geo): BedId | null {
  if (p.k === 'bed') return p.bed;
  if (p.k === 'project') return g.bedOf(p.id);
  return null;
}

/** The project panel is involved: the camera is pushed in toward `state.project`. */
export const isShown = (s: State): boolean => s.phase === 'opening' || s.phase === 'inspect' || s.phase === 'closing';

/** World X of the camera path: the overview pan, else fromX blended toward the bed anchor by the leg channel. */
export const camX = (s: State, ch: Channels, g: Geo): number =>
  s.bed === null ? (g.viewX() ?? s.fromX) : s.fromX + (g.anchor(s.bed) - s.fromX) * ch.leg.value;

function nearestBed(x: number, g: Geo): BedId | null {
  let best: BedId | null = null;
  let d = Infinity;
  for (let i = 0; i < g.order.length; i++) {
    const b = g.order[i];
    if (b === undefined) continue;
    const e = Math.abs(g.anchor(b) - x);
    if (e < d) { d = e; best = b; }
  }
  return best;
}

/** Camera channels snap while the canvas is not visible (Herbario), so a later switch lands on the place. */
const hidden = (s: State, ch: Channels): boolean => s.mode === 'herbario' || ch.mode.value === 1;

function aim(c: DriveChannel, target: number, s: State, ch: Channels): void {
  if (hidden(s, ch)) c.snap(target);
  else c.to(target);
}

function setIntent(s: State, place: Place, ch: Channels, g: Geo): State {
  const p = place.k === 'project' && g.bedOf(place.id) === null ? OVERVIEW : place;
  if (samePlace(p, s.intent)) return s;
  if (s.phase === 'intro') ch.intro.retime(INTRO.skipS);
  const project = isShown(s) ? s.project : projectOf(p);
  return { ...s, intent: p, gen: s.gen + 1, project, panelReady: project === s.project && s.panelReady };
}

function stepBed(s: State, dir: -1 | 1, ch: Channels, g: Geo): State {
  const base = bedOfPlace(s.intent, g);
  if (base === null) {
    const near = nearestBed(camX(s, ch, g), g);
    return near === null ? s : setIntent(s, { k: 'bed', bed: near }, ch, g);
  }
  const i = g.order.indexOf(base) + dir;
  const next = g.order[i < 0 ? 0 : i >= g.order.length ? g.order.length - 1 : i];
  return next === undefined || next === base ? s : setIntent(s, { k: 'bed', bed: next }, ch, g);
}

function focus(s: State, slot: SlotId, ch: Channels): State {
  if ((s.phase !== 'bed' && s.phase !== 'focus') || s.bed === null || slot === s.slot || !slot.startsWith(`${s.bed}/`)) return s;
  if (s.phase === 'focus') ch.focus.snap(0);
  aim(ch.focus, 1, s, ch);
  return { ...s, phase: 'focus', slot };
}

function blur(s: State, ch: Channels): State {
  if (s.phase !== 'focus') return s;
  aim(ch.focus, 0, s, ch);
  return { ...s, phase: 'bed', slot: null };
}

function close(s: State, ch: Channels, g: Geo): State {
  if (s.intent.k !== 'project') return s;
  const bed = g.bedOf(s.intent.id);
  return setIntent(s, bed === null ? OVERVIEW : { k: 'bed', bed }, ch, g);
}

function back(s: State, ch: Channels, g: Geo): State {
  switch (s.phase) {
    case 'opening':
    case 'inspect':
      return close(s, ch, g);
    case 'focus':
      return blur(s, ch);
    case 'bed':
    case 'travel':
      return setIntent(s, OVERVIEW, ch, g);
    default:
      return s;
  }
}

/** Applies one input. Returns the same State object when nothing changes (idempotent). */
export function reduce(s: State, ev: Ev, ch: Channels, g: Geo): State {
  switch (ev.type) {
    case 'SKIP_INTRO':
      if (s.phase === 'intro') ch.intro.retime(INTRO.skipS);
      return s;
    case 'GOTO':
      return setIntent(s, ev.place, ch, g);
    case 'ROUTE':
      return setIntent(s, ev.route.place, ch, g);
    case 'OPEN':
      return setIntent(s, { k: 'project', id: ev.id }, ch, g);
    case 'STEP_BED':
      return stepBed(s, ev.dir, ch, g);
    case 'FOCUS':
      return focus(s, ev.slot, ch);
    case 'BLUR':
      return blur(s, ch);
    case 'CLOSE':
      return close(s, ch, g);
    case 'BACK':
      return back(s, ch, g);
    case 'SET_MODE':
      if (ev.mode === s.mode) return s;
      if (ev.mode === 'herbario') ch.mode.to(1);
      else if (s.gardenReady) ch.mode.to(0);
      return { ...s, mode: ev.mode };
    case 'SET_LANG':
      return ev.lang === s.lang ? s : { ...s, lang: ev.lang };
    case 'GARDEN_READY':
      if (s.gardenReady) return s;
      if (s.mode === 'garden') ch.mode.to(0);
      return { ...s, gardenReady: true };
    case 'PANEL_READY':
      return s.panelReady || ev.id !== s.project || ev.gen !== s.gen ? s : { ...s, panelReady: true };
    case 'REDUCED':
      return ev.on === s.reduced ? s : { ...s, reduced: ev.on };
  }
}

/** Starts a camera leg toward bed `c` from where the camera is, keeping its world velocity. */
function leg(s: State, c: BedId, ch: Channels, g: Geo): State {
  const x = camX(s, ch, g);
  const worldV = s.bed === null ? 0 : ch.leg.velocity * (g.anchor(s.bed) - s.fromX);
  const span = g.anchor(c) - x;
  const from = nearestBed(x, g);
  const hops = from === null ? 1 : Math.abs(g.order.indexOf(c) - g.order.indexOf(from));
  ch.leg.retime(s.phase === 'overview' || ch.dolly.value < 0.5 ? CAMERA.dollyS : travelS(hops));
  if (hidden(s, ch)) {
    ch.leg.snap(1);
  } else {
    ch.leg.snap(0);
    ch.leg.set(0, Math.abs(span) > 1e-6 ? worldV / span : 0);
    ch.leg.to(1);
  }
  aim(ch.dolly, 1, s, ch);
  return { ...s, phase: 'travel', bed: c, fromX: x, slot: null };
}

function toOverview(s: State, ch: Channels): void {
  if (ch.dolly.target === 0) return;
  aim(ch.dolly, 0, s, ch);
  if (hidden(s, ch)) ch.leg.snap(ch.leg.value);
  else ch.leg.hold();
}

const at = (c: DriveChannel, v: number): boolean => c.settled && c.value === v;

function travel(s: State, want: BedId | null, ch: Channels, g: Geo): State {
  if (want === null) {
    toOverview(s, ch);
    return ch.dolly.settled && ch.leg.settled ? { ...s, phase: 'overview', bed: null, fromX: camX(s, ch, g) } : s;
  }
  if (want !== s.bed || ch.leg.target !== 1 || ch.dolly.target !== 1) return leg(s, want, ch, g);
  return at(ch.leg, 1) && at(ch.dolly, 1) ? { ...s, phase: 'bed' } : s;
}

function inBed(s: State, want: BedId | null, ch: Channels, g: Geo): State {
  if (want !== s.bed) {
    aim(ch.focus, 0, s, ch);
    return { ...s, phase: 'travel', slot: null };
  }
  if (s.intent.k !== 'project' || s.bed === null || (s.mode === 'garden' && !g.bedReady(s.bed))) return s;
  aim(ch.focus, 1, s, ch);
  return { ...s, phase: 'opening', project: s.intent.id, slot: g.slotOf(s.intent.id) ?? s.slot };
}

/**
 * A project opened in the Herbario (no slot bound yet) gets its flower once the garden binds slots, so the panel
 * pushes toward it and closing lands in 'focus'.
 */
function bindSlot(s: State, ch: Channels, g: Geo): State {
  if (s.slot !== null || s.mode !== 'garden' || s.project === null) return s;
  const slot = g.slotOf(s.project);
  if (slot === null) return s;
  aim(ch.focus, 1, s, ch);
  return { ...s, slot };
}

/** One legal move toward the intent. Returns the same State object when there is nothing to do yet. */
export function step(s: State, ch: Channels, g: Geo): State {
  if (isShown(s)) {
    const bound = bindSlot(s, ch, g);
    if (bound !== s) return bound;
  }
  const want = bedOfPlace(s.intent, g);
  switch (s.phase) {
    case 'intro':
      if (s.mode === 'herbario') ch.intro.snap(1);
      return at(ch.intro, 1) ? { ...s, phase: 'overview' } : s;
    case 'overview':
      return want === null ? s : leg(s, want, ch, g);
    case 'travel':
      return travel(s, want, ch, g);
    case 'bed':
    case 'focus':
      return inBed(s, want, ch, g);
    case 'opening':
    case 'inspect':
      if (s.intent.k !== 'project' || s.intent.id !== s.project) return { ...s, phase: 'closing' };
      return s.phase === 'opening' && at(ch.open, 1) ? { ...s, phase: 'inspect' } : s;
    case 'closing': {
      if (s.intent.k === 'project' && s.intent.id === s.project) return { ...s, phase: 'opening' };
      if (!at(ch.open, 0)) return s;
      const project = projectOf(s.intent);
      return { ...s, phase: s.slot === null ? 'bed' : 'focus', project, panelReady: project === s.project && s.panelReady };
    }
  }
}

/** Steps until nothing changes. Bounded: every phase has at most a few legal moves in a row. */
export function walk(s: State, ch: Channels, g: Geo): State {
  let cur = s;
  for (let i = 0; i < 12; i++) {
    const next = step(cur, ch, g);
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
}
