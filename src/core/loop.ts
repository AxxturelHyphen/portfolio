import type { ChannelName, Clock, DebugParams, FrameRecorder, FrameReport, FrameStage, Loop, Machine, PauseReason } from '../types.ts';
import { createClock } from './clock.ts';
import { coarsePointer } from './quality.ts';

/**
 * The one rAF loop (cook/ARCH.md 2.3): one deterministic clock, frame hooks in a fixed stage order, pause reasons,
 * the 3 s mobile idle pause and the FrameRecorder. Nothing in `frame` allocates: hook lists are copied on
 * registration, never during a frame.
 */

const STAGES: readonly FrameStage[] = ['input', 'sim', 'camera', 'world', 'render', 'post', 'dom'];
/** Mobile: nothing moved for this long pauses the loop (spec section 9). */
export const IDLE_MS = 3000;
/** Recorder ring length: about 68 s at 60 Hz, longer runs keep the newest frames for p95. */
const REC_CAPACITY = 4096;

type Hook = (c: Clock) => void;

export const CHANNELS: readonly ChannelName[] = ['intro', 'dolly', 'leg', 'focus', 'open', 'mode'];

/** Every channel at rest: the loop may idle, quality may adapt, the test API may resolve. */
export function channelsSettled(m: Machine): boolean {
  for (let i = 0; i < CHANNELS.length; i++) if (!m.ch[CHANNELS[i] as ChannelName].settled) return false;
  return true;
}

/** The loop as the composition root and the test API see it: the Loop of ARCH plus the clock and its controls. */
export interface RuntimeLoop extends Loop {
  readonly clock: Clock;
  readonly paused: ReadonlySet<PauseReason>;
  /** Freezes content time at t (seconds), as ?t does. Channels keep running on real dt. */
  setT(t: number): void;
  /** Draw calls of the frame just rendered (renderer.info.render.calls), sampled by the recorder after 'post'. */
  setCallsProbe(fn: () => number): void;
}

/** Everything the loop needs from the browser, injectable for unit tests. */
export interface LoopHost {
  raf(fn: (now: number) => void): number;
  caf(id: number): void;
  now(): number;
  hidden(): boolean;
  onVisibility(fn: () => void): void;
  mobile: boolean;
  longTasks: LongTaskSource | null;
}

/** Counts long tasks between start() and stop(). */
export interface LongTaskSource { start(): void; stop(): number }

/** Frame recorder with a preallocated ring (frame ms and draw calls); only stop() sorts, into a preallocated scratch. */
export interface RecorderImpl extends FrameRecorder { readonly recording: boolean; frame(ms: number, calls: number): void }

export function createRecorder(longTasks: LongTaskSource | null, capacity = REC_CAPACITY): RecorderImpl {
  const ms = new Float32Array(capacity);
  const calls = new Float32Array(capacity);
  const scratch = new Float32Array(capacity);
  let label = '';
  let on = false;
  let n = 0;
  let sum = 0;
  let max = 0;
  let over25 = 0;
  let over50 = 0;
  let over100 = 0;

  const p95Of = (src: Float32Array, count: number): number => {
    if (count === 0) return 0;
    scratch.set(src.subarray(0, count));
    const view = scratch.subarray(0, count).sort();
    return view[Math.min(count - 1, Math.ceil(count * 0.95) - 1)] ?? 0;
  };

  return {
    get recording() {
      return on;
    },
    start(l: string): void {
      label = l;
      on = true;
      n = 0;
      sum = 0;
      max = 0;
      over25 = 0;
      over50 = 0;
      over100 = 0;
      longTasks?.start();
    },
    frame(dtMs: number, drawCalls: number): void {
      if (!on) return;
      const i = n % capacity;
      ms[i] = dtMs;
      calls[i] = drawCalls;
      n++;
      sum += dtMs;
      if (dtMs > max) max = dtMs;
      if (dtMs > 25) over25++;
      if (dtMs > 50) over50++;
      if (dtMs > 100) over100++;
    },
    stop(): FrameReport {
      const kept = Math.min(n, capacity);
      const report: FrameReport = {
        label, frames: n, avg: n > 0 ? sum / n : 0, p95: p95Of(ms, kept), max, over25, over50, over100,
        longTasks: on ? (longTasks?.stop() ?? 0) : 0, callsP95: p95Of(calls, kept),
      };
      on = false;
      return report;
    },
  };
}

export function createLoopWith(q: DebugParams, host: LoopHost): RuntimeLoop {
  const lists: Hook[][] = STAGES.map(() => []);
  const paused = new Set<PauseReason>();
  const clock = createClock(q.t);
  const rec = createRecorder(host.longTasks);
  let started = false;
  let rafId = 0;
  /** Frame timestamps live in a typed array: a double kept in a closure variable is boxed on every store. */
  const times = new Float64Array([-1, 0]);
  const LAST = 0;
  const WAKE = 1;
  let callsProbe: (() => number) | null = null;

  /** True while the stages run: a resume from inside a hook (a machine subscriber) must not start a second rAF chain. */
  let inFrame = false;

  const running = (): boolean => started && paused.size === 0;

  function frame(now: number): void {
    rafId = 0;
    inFrame = true;
    const last = times[LAST] ?? -1;
    const deltaMs = last < 0 ? 0 : now - last;
    times[LAST] = now;
    clock.advance(now);
    try {
      for (let s = 0; s < lists.length; s++) {
        const list = lists[s] as Hook[];
        for (let i = 0; i < list.length; i++) (list[i] as Hook)(clock);
      }
    } finally {
      if (deltaMs > 0) rec.frame(deltaMs, callsProbe === null ? 0 : callsProbe());
      if (host.mobile && now - (times[WAKE] ?? 0) > IDLE_MS) paused.add('idle-mobile');
      inFrame = false;
      if (running() && rafId === 0) rafId = host.raf(frame);
    }
  }

  function schedule(): void {
    if (!inFrame && running() && rafId === 0) {
      times[LAST] = -1;
      rafId = host.raf(frame);
    }
  }

  function halt(): void {
    if (rafId !== 0) host.caf(rafId);
    rafId = 0;
  }

  const loop: RuntimeLoop = {
    clock,
    paused,
    rec,
    get running() {
      return running();
    },
    on(stage: FrameStage, fn: Hook): () => void {
      const i = STAGES.indexOf(stage);
      lists[i] = [...(lists[i] ?? []), fn];
      return () => {
        lists[i] = (lists[i] ?? []).filter((h) => h !== fn);
      };
    },
    start(): void {
      if (started) return;
      started = true;
      times[WAKE] = host.now();
      host.onVisibility(() => (host.hidden() ? loop.pause('hidden') : loop.resume('hidden')));
      if (host.hidden()) paused.add('hidden');
      schedule();
    },
    pause(r: PauseReason): void {
      paused.add(r);
      if (!running()) halt();
    },
    resume(r: PauseReason): void {
      if (r === 'idle-mobile') times[WAKE] = host.now();
      paused.delete(r);
      schedule();
    },
    wake(): void {
      times[WAKE] = host.now();
      if (paused.has('idle-mobile')) loop.resume('idle-mobile');
    },
    setT(t: number): void {
      clock.setT(t);
    },
    setCallsProbe(fn: () => number): void {
      callsProbe = fn;
    },
  };
  return loop;
}

function longTaskObserver(): LongTaskSource | null {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes.includes('longtask')) return null;
  let count = 0;
  const obs = new PerformanceObserver((list) => {
    count += list.getEntries().length;
  });
  return {
    start(): void {
      count = 0;
      obs.observe({ type: 'longtask' });
    },
    stop(): number {
      count += obs.takeRecords().length;
      obs.disconnect();
      return count;
    },
  };
}

export function createLoop(q: DebugParams): RuntimeLoop {
  return createLoopWith(q, {
    raf: (fn) => requestAnimationFrame(fn),
    caf: (id) => cancelAnimationFrame(id),
    now: () => performance.now(),
    hidden: () => document.visibilityState === 'hidden',
    onVisibility: (fn) => document.addEventListener('visibilitychange', fn),
    mobile: coarsePointer(),
    longTasks: longTaskObserver(),
  });
}
