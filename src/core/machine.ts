import type { BedId, Clock, Ev, GardenLayout, Machine, MachineEnv, Project, ProjectId, SlotId, State } from '../types.ts';
import { CHANNEL_S, INTRO, IRIS, linear, OPEN_HALF, OPEN_HALF_NEAR } from './motion.ts';
import { spring, tween, type DriveChannel } from './spring.ts';
import { isShown, OVERVIEW, reduce, walk, type Channels, type Geo } from './transitions.ts';

/**
 * The one state machine (cook/ARCH.md 2.1). send() is synchronous and idempotent; subscribers hear discrete changes
 * only, as plain callbacks; per-frame values are read from `ch`. tick() advances the channels without allocating and
 * walks the table only on the frame a channel settles.
 */

/** How the router writes the URL for the change the last event caused (cook/ARCH.md 2.2). */
export type WriteCause = 'push' | 'replace' | 'back' | 'route';

export interface MachineContent {
  readonly projects: readonly Pick<Project, 'id' | 'bed'>[];
  readonly garden: Pick<GardenLayout, 'order' | 'anchors' | 'overview'>;
}

/** What only the running garden knows. Without it: no slot binding, every bed ready, no overview pan. */
export interface GardenGeo {
  /** The slot a project is bound to (world/scene.ts). */
  slotOf(id: ProjectId): SlotId | null;
  /** The bed is entered: a project in it may open (cook/ARCH.md 2.1, bed ready). */
  bedReady(b: BedId): boolean;
  /** World X of the overview pan. */
  viewX(): number | null;
  /** Free roam: the visitor walks, so camera legs snap (cook/ROAM_PLAN.md section 3). Default false. */
  roam?(): boolean;
  /** Free roam: the visitor stands inside the bed's x range, so travel may end there. Default true. */
  arrived?(b: BedId): boolean;
}

export interface MachineOptions extends MachineEnv {
  readonly geo?: GardenGeo;
}

/** The machine as boot owns it: refresh() walks the table again after the garden's knowledge changed. */
export interface RuntimeMachine extends Machine {
  refresh(): void;
}

const causes = new WeakMap<Machine, { cause: WriteCause }>();

/** The write cause of the event being processed by `m` (read by the router inside its subscriber). */
export const causeOf = (m: Machine): WriteCause => causes.get(m)?.cause ?? 'push';

function causeFor(ev: Ev): WriteCause {
  switch (ev.type) {
    case 'GOTO':
      return ev.via === 'scroll' ? 'replace' : 'push';
    case 'OPEN':
    case 'STEP_BED':
      return 'push';
    case 'CLOSE':
    case 'BACK':
      return 'back';
    case 'ROUTE':
      return 'route';
    default:
      return 'replace';
  }
}

function geoOf(c: MachineContent, o: MachineOptions): Geo {
  const beds = new Map<ProjectId, BedId>();
  for (const p of c.projects) beds.set(p.id, p.bed);
  const anchors = c.garden.anchors;
  const geo = o.geo;
  return {
    order: c.garden.order,
    anchor: (b) => anchors[b],
    bedOf: (id) => beds.get(id) ?? null,
    slotOf: (id) => (geo === undefined ? null : geo.slotOf(id)),
    bedReady: (b) => (geo === undefined ? true : geo.bedReady(b)),
    viewX: () => (geo === undefined ? null : geo.viewX()),
    roam: () => geo?.roam?.() ?? false,
    arrived: (b) => geo?.arrived?.(b) ?? true,
  };
}

export function createMachine(c: MachineContent, env: MachineOptions): RuntimeMachine {
  const g = geoOf(c, env);
  const ch: Channels = {
    intro: tween(INTRO.totalS, linear),
    dolly: spring(CHANNEL_S.dolly),
    leg: spring(CHANNEL_S.leg),
    focus: spring(CHANNEL_S.focus),
    open: spring(CHANNEL_S.openClose),
    mode: tween(CHANNEL_S.mode, linear),
  };
  const meta = { cause: 'replace' as WriteCause };
  let subs: ((s: State, prev: State) => void)[] = [];
  let notifying = false;
  let scrubbing = false;
  let holdS = 0;
  let wasUp = false;

  ch.mode.snap(env.mode === 'herbario' ? 1 : 0);
  ch.intro.to(1);
  if (env.reduced) ch.intro.retime(INTRO.skipS);
  let state: State = walk({
    phase: 'intro', mode: env.mode, intent: OVERVIEW, bed: null, slot: null, project: null, fromX: c.garden.overview.x,
    lang: env.lang, gen: 0, gardenReady: false, panelReady: false, reduced: env.reduced,
  }, ch, g);
  let delivered = state;

  /** Re-entrant safe: a send from inside a subscriber is applied at once and delivered after the current round. */
  function commit(next: State): void {
    if (next === state) return;
    state = next;
    if (notifying) return;
    notifying = true;
    try {
      while (delivered !== state) {
        const prev = delivered;
        delivered = state;
        const list = subs;
        for (let i = 0; i < list.length; i++) list[i]?.(delivered, prev);
      }
    } finally {
      notifying = false;
    }
  }

  function aimOpen(o: DriveChannel, target: number, durationS: number): void {
    o.retime(durationS);
    o.to(target);
  }

  /** The open channel in legs: iris shut at 0.5, hold, then reveal; the same legs mirrored on the way out. */
  function driveOpen(dt: number): void {
    const o = ch.open;
    const up = state.phase === 'opening' || state.phase === 'inspect';
    if (up !== wasUp) {
      wasUp = up;
      holdS = 0;
    }
    if (state.mode === 'herbario') {
      aimOpen(o, up ? 1 : 0, IRIS.openS);
      return;
    }
    const x = o.value;
    const above = x > OPEN_HALF + OPEN_HALF_NEAR;
    const below = x < OPEN_HALF - OPEN_HALF_NEAR;
    if (up) {
      if (above || o.target === 1) aimOpen(o, 1, IRIS.openS);
      else if (below || !state.panelReady) { holdS = 0; aimOpen(o, OPEN_HALF, IRIS.closeS); }
      else if ((holdS += dt) >= IRIS.holdS) aimOpen(o, 1, IRIS.openS);
    } else if (o.target !== 0) {
      if (above) { holdS = 0; aimOpen(o, OPEN_HALF, IRIS.closeS); }
      else if (below || (holdS += dt) >= IRIS.holdS) aimOpen(o, 0, IRIS.openS);
    }
  }

  const machine: RuntimeMachine = {
    get state() {
      return state;
    },
    ch,
    send(ev: Ev): void {
      meta.cause = causeFor(ev);
      commit(walk(reduce(state, ev, ch, g), ch, g));
    },
    scrub(_name: 'open', v: number | null): void {
      if (!isShown(state)) return;
      if (v !== null) {
        scrubbing = true;
        ch.open.set(v, 0);
        return;
      }
      if (!scrubbing) return;
      scrubbing = false;
      if (ch.open.value < OPEN_HALF) machine.send({ type: 'CLOSE' });
      else if (state.project !== null) machine.send({ type: 'OPEN', id: state.project });
    },
    refresh(): void {
      commit(walk(state, ch, g));
    },
    subscribe(fn: (s: State, prev: State) => void): () => void {
      subs = subs.concat(fn);
      return () => {
        subs = subs.filter((f) => f !== fn);
      };
    },
    tick(clock: Clock): void {
      const dt = clock.dt;
      let settled = ch.intro.tick(dt);
      if (ch.dolly.tick(dt)) settled = true;
      if (ch.leg.tick(dt)) settled = true;
      if (ch.focus.tick(dt)) settled = true;
      if (ch.mode.tick(dt)) settled = true;
      if (!scrubbing) {
        driveOpen(dt);
        if (ch.open.tick(dt)) settled = true;
      }
      if (settled) commit(walk(state, ch, g));
    },
  };
  causes.set(machine, meta);
  return machine;
}
