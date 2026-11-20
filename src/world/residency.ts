import type { AtlasManifest, BedId, BedState, Clock, GardenLayout, Gfx, Machine, Quality, Residency } from '../types.ts';
import { STREAM } from '../core/motion.ts';
import type { Slicer, StreamBed } from './bed.ts';

/**
 * Streaming policy (cook/ARCH.md 2.6, spec section 9). Resident: the bed being travelled to, the bed being left,
 * both their neighbours in garden.order (the grotto counts only as a neighbour of its host), plus the overview and shared
 * atlases (always). Hover only prefetches bytes; of the beds outside residency only the last hovered one keeps its bytes,
 * the rest are disposed at once. A wanted bed whose fetch or load fails is retried with a doubling backoff; after
 * STREAM.maxFails it is marked failed, so nothing waits on it (a project there opens without its bed). A load never starts
 * until total + incoming fits the tier budget; loads run one at a time in priority order. Load work is cut into
 * slices: at most STREAM.sliceMs per frame and STREAM.uploadsPerFrame texture uploads, none while ch.open moves.
 * The reach narrows what streams (garden/index.ts keeps the first load to the overview and shared atlases): 'none' holds
 * every bed, 'own' streams the beds the camera is at or heading to (and a hovered one), 'all' their neighbours too.
 */

export type StreamReach = 'none' | 'own' | 'all';

export interface StreamResidency extends Residency, Slicer {
  readonly order: readonly BedId[];
  /** Bytes of the always-resident atlases (overview and shared). */
  addShared(bytes: number): void;
  /** Streaming is in flight (a fetch, a load, a retry due, or load work waiting for a frame): the loop must not idle. */
  readonly busy: boolean;
  /** The bed failed STREAM.maxFails times and is no longer retried this visit. */
  failed(b: BedId): boolean;
  /** Widens or narrows what streams ('all' by default) and applies it to the last want at once. */
  reach(r: StreamReach): void;
}

const MB = 1024 * 1024;

/** Upper bound of the GPU bytes a manifest will take: 8 bpp hi or RGBA8 lo at quarter area, mips, normal at half size. */
export function estimateBytes(m: AtlasManifest): number {
  let n = 0;
  for (const p of m.pages) n += p.w * p.h * (4 / 3) * 1.25;
  return n;
}

export function createResidency(beds: ReadonlyMap<BedId, StreamBed>, g: GardenLayout, machine: Machine, quality: Quality, gfx: Gfx): StreamResidency {
  const chain: readonly BedId[] = g.order.filter((b) => b !== 'gruta');
  const all = [...beds.values()];
  const wanted: BedId[] = [];
  const waiters: (() => void)[] = [];
  /** whenReady() callers per bed: settled when it is ready, rejected when it leaves residency or fails to load. */
  const ready = new Map<BedId, { resolve: () => void; reject: (e: Error) => void }[]>();
  const prefetches = new Map<BedId, AbortController>();
  /** Failures per bed (fetch or load) and the clock time (ms) its next retry may start. */
  const fails = new Map<BedId, number>();
  const retryAt = new Map<BedId, number>();
  let lastHover: BedId | null = null;
  let reach: StreamReach = 'all';
  /** The last want() arguments, applied again when the reach changes. */
  let lastActive: BedId | null = null;
  let lastHeading: BedId | null = null;
  let now = 0;
  const bytes = { beds: 0, shared: 0, targets: 0, total: 0, budget: 0 };
  let loading: StreamBed | null = null;
  let serial = 0;
  let deadline = 0;
  let uploadsLeft = 0;

  /** The visible beds skip the hidden grotto; the grotto itself neighbours its host and the next visible bed after it. */
  const neighbours = (b: BedId, out: BedId[]): void => {
    if (b === 'gruta') {
      const next = chain[chain.indexOf(g.grutaHost) + 1];
      out.push(g.grutaHost);
      if (next !== undefined) out.push(next);
      return;
    }
    const i = chain.indexOf(b);
    const left = chain[i - 1];
    const right = chain[i + 1];
    if (left !== undefined) out.push(left);
    if (right !== undefined) out.push(right);
    if (b === g.grutaHost) out.push('gruta');
  };

  const bedOf = (b: BedId): StreamBed => {
    const bed = beds.get(b);
    if (bed === undefined) throw new Error(`residency: unknown bed ${b}`);
    return bed;
  };

  const countBytes = (): void => {
    let n = 0;
    for (let i = 0; i < all.length; i++) n += all[i]?.gpuBytes ?? 0;
    bytes.beds = n;
    bytes.targets = gfx.film.targetBytes;
    bytes.total = bytes.beds + bytes.shared + bytes.targets;
    bytes.budget = quality.cfg.texBudgetMB * MB;
  };

  const isFailed = (b: BedId): boolean => (fails.get(b) ?? 0) >= STREAM.maxFails;

  /** Counts a failure and schedules the retry; the last one settles whenReady callers, so nothing waits forever. */
  const report = (b: BedId, err: unknown): void => {
    console.error(`residency: bed ${b} failed to stream`, err);
    const n = (fails.get(b) ?? 0) + 1;
    fails.set(b, n);
    retryAt.set(b, now + STREAM.retryMs * 2 ** (n - 1));
    if (n >= STREAM.maxFails) settle(b, 'failed to stream');
  };

  /** An abort only ends the request: a bed wanted again is fetched anew once the aborted request settles. */
  const prefetch = (b: BedId): void => {
    const bed = bedOf(b);
    if (bed.state !== 'cold' && bed.state !== 'disposed') return;
    if (prefetches.has(b) || isFailed(b) || now < (retryAt.get(b) ?? 0)) return;
    const ac = new AbortController();
    prefetches.set(b, ac);
    bed.prefetch(ac.signal).then(undefined, (err: unknown) => {
      if (!ac.signal.aborted) report(b, err);
    }).finally(() => {
      if (prefetches.get(b) === ac) prefetches.delete(b);
      pump();
    });
  };

  /** A wanted bed waits on a scheduled retry: the loop keeps ticking until it is due. */
  const retryPending = (): boolean => {
    for (let i = 0; i < wanted.length; i++) {
      const b = wanted[i] as BedId;
      const s = bedOf(b).state;
      if ((s === 'cold' || s === 'disposed') && !isFailed(b) && retryAt.has(b)) return true;
    }
    return false;
  };

  const settle = (b: BedId, why: string | null): void => {
    const list = ready.get(b);
    if (list === undefined) return;
    ready.delete(b);
    for (const w of list) {
      if (why === null) w.resolve();
      else w.reject(new Error(`residency: bed ${b} ${why}`));
    }
  };

  function pump(): void {
    if (loading !== null) return;
    countBytes();
    for (let i = 0; i < wanted.length; i++) {
      const b = wanted[i] as BedId;
      const bed = bedOf(b);
      if (bed.state === 'ready' || bed.state === 'active' || isFailed(b)) continue;
      if (bed.state === 'cold' || bed.state === 'disposed') prefetch(b);
      if (bed.state !== 'prefetched' || bed.manifest === null) return;
      if (bytes.total + estimateBytes(bed.manifest) > bytes.budget) return;
      loading = bed;
      bed.load(++serial).then(() => {
        if (bed.state !== 'ready') return;
        fails.delete(b);
        retryAt.delete(b);
        settle(b, null);
      }, (err: unknown) => {
        bed.dispose();
        report(b, err);
      }).finally(() => {
        if (loading === bed) loading = null;
        pump();
      });
      return;
    }
  }

  const res: StreamResidency = {
    order: g.order,
    bytes,
    get busy() {
      return loading !== null || waiters.length > 0 || prefetches.size > 0 || retryPending();
    },

    failed: isFailed,

    want(active, heading, hover) {
      lastActive = active;
      lastHeading = heading;
      wanted.length = 0;
      const add = (b: BedId | null): void => {
        if (b !== null && !wanted.includes(b)) wanted.push(b);
      };
      if (reach !== 'none') {
        add(heading);
        add(active);
      }
      const around: BedId[] = [];
      if (reach === 'all' && heading !== null) neighbours(heading, around);
      if (reach === 'all' && active !== null) neighbours(active, around);
      for (const b of around) add(b);
      if (hover !== null && reach !== 'none') lastHover = hover;
      for (const [b, bed] of beds) {
        if (wanted.includes(b)) continue;
        if (b === lastHover && bed.state !== 'loading' && bed.state !== 'ready' && bed.state !== 'active') continue;
        prefetches.get(b)?.abort();
        if (bed.state !== 'cold' && bed.state !== 'disposed') bed.dispose();
        settle(b, 'left residency');
      }
      for (let i = 0; i < wanted.length; i++) prefetch(wanted[i] as BedId);
      if (hover !== null && reach !== 'none') prefetch(hover);
      pump();
    },

    reach(r) {
      if (r === reach) return;
      reach = r;
      res.want(lastActive, lastHeading, null);
    },

    stateOf(b) {
      return bedOf(b).state;
    },

    whenReady(b) {
      const s: BedState = bedOf(b).state;
      if (s === 'ready' || s === 'active') return Promise.resolve();
      if (isFailed(b)) return Promise.reject(new Error(`residency: bed ${b} failed to stream`));
      return new Promise<void>((resolve, reject) => {
        const list = ready.get(b) ?? [];
        list.push({ resolve, reject });
        ready.set(b, list);
      });
    },

    tick(c: Clock) {
      now = c.now;
      countBytes();
      if (loading === null && retryPending()) pump();
      if (waiters.length === 0 || !machine.ch.open.settled) return;
      deadline = -1;
      uploadsLeft = STREAM.uploadsPerFrame;
      waiters.shift()?.();
    },

    addShared(n) {
      bytes.shared += n;
      countBytes();
    },

    frame() {
      return new Promise<void>((resolve) => waiters.push(resolve));
    },

    async upload() {
      while (uploadsLeft <= 0 || res.spent()) await res.frame();
      uploadsLeft--;
    },

    /** The slice starts when the granted work first runs (after the frame's hooks), not when the grant is given. */
    spent() {
      const now = performance.now();
      if (deadline < 0) deadline = now + STREAM.sliceMs;
      return now > deadline;
    },
  };
  countBytes();
  return res;
}
