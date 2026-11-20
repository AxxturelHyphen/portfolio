import type { BedId, BedState, CameraRig, ChannelName, Content, Ev, InfoSnapshot, JardinTestAPI, Machine, Phase, Place, Pose, Quality, Residency, State } from '../types.ts';
import { channelsSettled, CHANNELS, type RuntimeLoop } from './loop.ts';
import { parseRoute } from './router.ts';

/**
 * window.__jardin (cook/ARCH.md 2.11): installed only with ?bench=1 or in dev (see testApiEnabled in debug.ts).
 * Waiting is done in the 'dom' frame stage, so every promise resolves on a real frame of the one loop.
 */

declare global {
  interface Window {
    __jardin?: JardinTestAPI;
  }
}

/** Phases that always end in another phase: never a resting state, whatever the channels say. */
const MOVING: readonly Phase[] = ['intro', 'travel', 'opening', 'closing'];

const BEDS: readonly BedId[] = ['puerta', 'rosaleda', 'estanque', 'semillero', 'gruta', 'salida'];

export interface TestApiDeps {
  machine: Machine;
  loop: RuntimeLoop;
  quality: Quality;
  rig: CameraRig;
  content: Content;
  residency: Pick<Residency, 'stateOf'>;
  /** Resolves when the garden is warm and its first bed or the overview is shown. */
  ready: Promise<void>;
  info(out: InfoSnapshot): InfoSnapshot;
  /** The visitor under free roam (the default), else null. */
  roam: TestRoam | null;
  /** True once the visitor is drawn as the paper figure (not the lantern on its crook). */
  figure(): boolean;
  /** The film strip's enable (uStrip.w): 1 while it runs. */
  strip(): number;
  /** How far the entered project's flower has unfurled in its bed, 0..1. */
  unfurl(): number;
  /** The phase of the archive boss of the bed the visitor was last in ('wait', 'play', 'idle'), '' before any. */
  boss(): string;
}

/** The visitor's position and test-only steering (the same calls a click on the ground and held keys make). */
export interface TestRoam {
  readonly pos: Float32Array;
  /** True while the visitor or the camera's approach still moves: settled() waits for it. */
  readonly busy: boolean;
  walkTo(x: number, z: number): void;
  setHeld(bits: number): void;
  /** Holds the camera's approach at k (0 walking, 1 near framing); null lets it follow the visitor again. */
  holdApproach(k: number | null): void;
}

export const eventOf = (place: Place): Ev => (place.k === 'project' ? { type: 'OPEN', id: place.id } : { type: 'GOTO', place });

/** True when the machine rests at `place`: channels settled, phase final, and in the garden the bed is active. */
export function arrived(s: State, m: Machine, place: Place, bedState: (b: BedId) => BedState): boolean {
  if (!channelsSettled(m)) return false;
  if (place.k === 'overview') return s.phase === 'overview';
  if (place.k === 'project') return s.phase === 'inspect' && s.project === place.id;
  /** Closing a project rests in 'focus' on its slot: that is the bed too. */
  return (s.phase === 'bed' || s.phase === 'focus') && s.bed === place.bed && (s.mode === 'herbario' || bedState(place.bed) === 'active');
}

/** First project per bed in importance order: the open and close legs of the bench tour. */
function tourProjects(c: Content): Partial<Record<BedId, string>> {
  const out: Partial<Record<BedId, string>> = {};
  const best: Partial<Record<BedId, number>> = {};
  for (const p of c.projects) {
    if ((best[p.bed] ?? 0) >= p.importance) continue;
    best[p.bed] = p.importance;
    out[p.bed] = p.id;
  }
  return out;
}

export function installTestApi(d: TestApiDeps): JardinTestAPI {
  const { machine, loop, content } = d;
  const errors: string[] = [];
  const snapshot: InfoSnapshot = { calls: 0, triangles: 0, textures: 0, geometries: 0, programs: 0, texBytes: 0, targetBytes: 0 };
  let instant = 0;

  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

  /** Stage 'input': while an instant goto is pending, every channel lands on its target before the machine ticks. */
  loop.on('input', () => {
    if (instant === 0) return;
    for (let i = 0; i < CHANNELS.length; i++) {
      const ch = machine.ch[CHANNELS[i] as ChannelName];
      if (!ch.settled) ch.snap(ch.target);
    }
  });

  /** Resolves on the first 'dom' stage where `pred` holds: an event sent just before only retargets its channels on
   * the next 'sim' stage, so a running loop is never answered synchronously. */
  function until(pred: () => boolean): Promise<void> {
    /** A paused loop (mobile panel or idle) only pauses at rest, and no 'dom' stage will come to check. */
    if (!loop.running && pred()) return Promise.resolve();
    return new Promise((resolve) => {
      const off = loop.on('dom', () => {
        if (!pred()) return;
        off();
        resolve();
      });
    });
  }

  const api: JardinTestAPI = {
    ready: d.ready,
    state: () => machine.state,
    channels() {
      const out = {} as ReturnType<JardinTestAPI['channels']>;
      for (const name of CHANNELS) {
        const ch = machine.ch[name];
        out[name] = { value: ch.value, target: ch.target, settled: ch.settled };
      }
      return out;
    },
    async goto(hash, o) {
      const place = parseRoute(new URL(hash, location.href).href, content).place;
      if (o?.instant === true) instant++;
      try {
        machine.send(eventOf(place));
        await until(() => arrived(machine.state, machine, place, d.residency.stateOf));
      } finally {
        if (o?.instant === true) instant--;
      }
    },
    send: (ev) => machine.send(ev),
    settled: () => until(() => channelsSettled(machine) && !MOVING.includes(machine.state.phase) && d.roam?.busy !== true),
    camera: (): Pose => ({ ...d.rig.pose }),
    roam: () => (d.roam === null ? null : { x: d.roam.pos[0]!, z: d.roam.pos[1]! }),
    figure: () => d.figure(),
    strip: () => d.strip(),
    unfurl: () => d.unfurl(),
    boss: () => d.boss(),
    walkTo(x, z) {
      d.roam?.walkTo(x, z);
      loop.wake();
    },
    holdKeys(bits) {
      d.roam?.setHeld(bits);
      loop.wake();
    },
    holdApproach(k) {
      d.roam?.holdApproach(k);
    },
    info: () => ({ ...d.info(snapshot) }),
    residency() {
      const out = {} as Record<BedId, BedState>;
      for (const b of BEDS) out[b] = d.residency.stateOf(b);
      return out;
    },
    heapMB() {
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      return mem === undefined ? null : mem.usedJSHeapSize / 2 ** 20;
    },
    errors: () => [...errors],
    setT: (t) => loop.setT(t),
    rec: { start: (label) => loop.rec.start(label), stop: () => loop.rec.stop() },
    async tour() {
      const { runTour } = await import('../bench/tour.ts');
      return runTour({
        tier: d.quality.tier,
        goto: (h) => api.goto(h),
        rec: api.rec,
        info: api.info,
        heapMB: api.heapMB,
        projects: tourProjects(content),
      });
    },
  };
  window.__jardin = api;
  return api;
}
