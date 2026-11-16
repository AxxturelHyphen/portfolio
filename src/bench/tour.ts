import type { BedId, FrameReport, InfoSnapshot, PerfLine, Tier } from '../types.ts';

/**
 * Scripted bench tour (spec section 11, `npm run perf`): visits every bed, opens and closes the first project of
 * each bed that has one, and returns ONE PerfLine. Pure of the DOM and of three: the runtime owner builds a
 * TourDeps from its machine and loop and calls this from window.__jardin.tour() (only with ?bench=1; import it
 * with a dynamic import so it stays out of the boot chunk).
 *
 * Aggregation is deliberately conservative: draw calls and frame p95 are the worst leg, texture MB is the peak
 * (textures plus render targets) seen after any leg, frame avg is weighted by frames.
 */

export const TOUR_BEDS: readonly BedId[] = ['puerta', 'rosaleda', 'estanque', 'semillero', 'gruta', 'salida'];

export interface TourDeps {
  tier: Tier;
  /** Same contract as window.__jardin.goto: resolves when every channel is settled and the target is active. */
  goto(hash: string): Promise<void>;
  rec: { start(label: string): void; stop(): FrameReport };
  info(): InfoSnapshot;
  heapMB(): number | null;
  /** First project id per bed, for the open and close leg. Beds without a project are omitted. */
  projects: Partial<Record<BedId, string>>;
}

export interface TourLeg {
  label: string;
  report: FrameReport;
  textureMB: number;
}

/** Runs one named leg under the frame recorder. */
async function leg(d: TourDeps, label: string, hash: string): Promise<TourLeg> {
  d.rec.start(label);
  await d.goto(hash);
  const report = d.rec.stop();
  const i = d.info();
  return { label, report, textureMB: (i.texBytes + i.targetBytes) / 2 ** 20 };
}

export function summarise(tier: Tier, legs: readonly TourLeg[], heapMB: number | null): PerfLine {
  let frames = 0;
  let weighted = 0;
  let p95 = 0;
  let calls = 0;
  let longTasks = 0;
  let tex = 0;
  for (const l of legs) {
    frames += l.report.frames;
    weighted += l.report.avg * l.report.frames;
    p95 = Math.max(p95, l.report.p95);
    calls = Math.max(calls, l.report.callsP95);
    longTasks += l.report.longTasks;
    tex = Math.max(tex, l.textureMB);
  }
  return {
    tier,
    drawCallsP95: calls,
    textureMB: Math.round(tex * 100) / 100,
    heapMB: heapMB === null ? Number.NaN : Math.round(heapMB * 100) / 100,
    frameAvg: frames > 0 ? Math.round((weighted / frames) * 100) / 100 : 0,
    frameP95: Math.round(p95 * 100) / 100,
    longTasks,
  };
}

export async function runTour(d: TourDeps): Promise<PerfLine> {
  const legs: TourLeg[] = [];
  await d.goto('#/');
  for (const bed of TOUR_BEDS) {
    legs.push(await leg(d, `travel ${bed}`, `#/b/${bed}`));
    const id = d.projects[bed];
    if (id !== undefined) {
      legs.push(await leg(d, `open ${id}`, `#/p/${id}`));
      legs.push(await leg(d, `close ${id}`, `#/b/${bed}`));
    }
  }
  legs.push(await leg(d, 'back to overview', '#/'));
  return summarise(d.tier, legs, d.heapMB());
}
