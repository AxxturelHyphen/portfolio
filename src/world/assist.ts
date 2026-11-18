/**
 * Assisted walking of free roam (cook/ROAM_PLAN.md section 3 and P6): a signpost, the plan, history or a deep link to
 * another bed walks the visitor along the garden path (its knots are the route) to the bed's stand point, up to
 * ASSIST.speed with eased starts and stops. Over more than one bed the walk is cut: the visitor walks out a few steps,
 * the film strip runs (as on the rail, garden/film.ts) and halfway through it the visitor appears on the far side,
 * walking in to the stand point. Distances are arc lengths along the path, so the speed holds where the path bends.
 * No allocation per frame.
 */
import { STRIP, travelS, walkProfile } from '../core/motion.ts';

/**
 * speed: top speed along the path (m/s); rampS: the eased start and stop (s); outM and inM: metres walked out before
 * the strip and in after it on a cut.
 */
export const ASSIST = { speed: 5.5, rampS: 0.5, outM: 2, inM: 2 } as const;

type Points = readonly (readonly [number, number])[];

/** Arc length along the path polyline (points sorted by x) at x, and back; clamped to the path's ends. */
export interface PathArc {
  arcAt(x: number): number;
  xAt(arc: number): number;
}

export function pathArc(points: Points): PathArc {
  const cum = new Float64Array(Math.max(1, points.length));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    cum[i] = cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const last = points.length - 1;
  return {
    arcAt(x) {
      if (last < 1 || x <= points[0]![0]) return 0;
      for (let i = 1; i <= last; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        if (x <= b[0]) return cum[i - 1]! + ((cum[i]! - cum[i - 1]!) * (x - a[0])) / Math.max(1e-6, b[0] - a[0]);
      }
      return cum[last]!;
    },
    xAt(arc) {
      if (last < 1 || arc <= 0) return points[0]?.[0] ?? 0;
      for (let i = 1; i <= last; i++) {
        if (arc <= cum[i]!) {
          const a = points[i - 1]!;
          const b = points[i]!;
          return a[0] + ((b[0] - a[0]) * (arc - cum[i - 1]!)) / Math.max(1e-6, cum[i]! - cum[i - 1]!);
        }
      }
      return points[last]![0];
    },
  };
}

/** The film inputs of an assisted walk (garden/film.ts reads these under free roam in place of the machine's leg). */
export interface TravelSource {
  /** Beds the running walk crosses; 0 while none runs. */
  readonly hops: number;
  /** The strip's leg 0..1: moves only while a cut runs. */
  readonly leg: number;
  /** Seconds into the walk and its whole length, for the travel exposure dip. */
  readonly elapsedS: number;
  readonly lengthS: number;
}

export interface AssistWalk extends TravelSource {
  readonly active: boolean;
  /** Where the walk puts the visitor: x on the path, and the share of the way done (for the offset off the path). */
  readonly x: number;
  readonly u: number;
  /** True on the step that cut across the strip (no velocity from that jump). */
  readonly jumped: boolean;
  /** Plans a walk from x0 to x1 along the path over `hops` beds. */
  start(x0: number, x1: number, hops: number): void;
  /** Advances the walk by dt; the last step lands exactly on x1 with u 1 and ends it. */
  step(dt: number): void;
  cancel(): void;
}

export function createAssistWalk(points: Points): AssistWalk {
  const arc = pathArc(points);
  let active = false;
  let hops = 0;
  let a0 = 0;
  let a1 = 0;
  let xEnd = 0;
  let dir = 1;
  /** The walked (virtual) distance, its top speed and ramp, and where the cut skips ahead (Infinity: no cut). */
  let total = 0;
  let speed = 0;
  let ramp = 0;
  let cutAt = Infinity;
  let stripFrom = 0;
  let stripS = 0;
  let t = 0;
  let lengthS = 0;
  const out = { x: 0, u: 0, jumped: false, leg: 0 };

  /** Distance walked at time s on the eased profile (cosine ramps round a constant-speed middle). */
  function walked(s: number): number {
    const cruise = lengthS - 2 * ramp;
    if (s <= 0) return 0;
    if (s < ramp) return speed * (s / 2 - (ramp / (2 * Math.PI)) * Math.sin((Math.PI * s) / ramp));
    if (s <= ramp + cruise) return (speed * ramp) / 2 + speed * (s - ramp);
    if (s >= lengthS) return total;
    const q = s - ramp - cruise;
    return (speed * ramp) / 2 + speed * cruise + speed * (q / 2 + (ramp / (2 * Math.PI)) * Math.sin((Math.PI * q) / ramp));
  }

  /** The strip's leg at time s: eased over the strip's run, 0 outside it and on a walk with no cut. */
  function legAt(s: number): number {
    const k = (s - stripFrom) / stripS;
    return cutAt === Infinity || k <= 0 || k >= 1 ? 0 : walkProfile(k);
  }

  /** Where `s` walked metres put the visitor: on the near side of the cut from the start, past it from the end. */
  function place(s: number): void {
    const span = Math.abs(a1 - a0);
    const d = s <= cutAt ? s : span - (total - s);
    out.x = span > 1e-6 ? arc.xAt(a0 + dir * d) : xEnd;
    out.u = span > 1e-6 ? Math.min(1, Math.max(0, d / span)) : 1;
  }

  return {
    get active() { return active; },
    get hops() { return active ? hops : 0; },
    get leg() { return out.leg; },
    get elapsedS() { return t; },
    get lengthS() { return lengthS; },
    get x() { return out.x; },
    get u() { return out.u; },
    get jumped() { return out.jumped; },
    start(x0, x1, n) {
      a0 = arc.arcAt(x0);
      a1 = arc.arcAt(x1);
      xEnd = x1;
      dir = a1 >= a0 ? 1 : -1;
      const span = Math.abs(a1 - a0);
      hops = Math.max(1, n);
      speed = ASSIST.speed;
      ramp = ASSIST.rampS;
      stripS = travelS(hops);
      const rampM = (speed * ramp) / 2;
      const outM = Math.max(ASSIST.outM, rampM);
      const inM = Math.max(ASSIST.inM, rampM);
      const walkedCut = outM + speed * stripS + inM;
      const cut = hops >= STRIP.minHops && walkedCut < span;
      total = cut ? walkedCut : span;
      if (total < 2 * rampM) speed = Math.max(1e-3, total / ramp);
      lengthS = 2 * ramp + Math.max(0, total - speed * ramp) / speed;
      stripFrom = cut ? ramp + (outM - rampM) / speed : 0;
      cutAt = cut ? outM + (speed * stripS) / 2 : Infinity;
      t = 0;
      out.leg = 0;
      out.jumped = false;
      active = span > 1e-6;
      place(0);
    },
    step(dt) {
      out.jumped = false;
      if (!active) return;
      const before = walked(t);
      t = Math.min(lengthS, t + Math.max(0, dt));
      const now = walked(t);
      out.jumped = before <= cutAt && now > cutAt;
      out.leg = legAt(t);
      if (t >= lengthS) {
        out.x = xEnd;
        out.u = 1;
        out.leg = 0;
        active = false;
        return;
      }
      place(now);
    },
    cancel() {
      active = false;
      out.leg = 0;
      out.jumped = false;
    },
  };
}
