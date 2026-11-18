/**
 * Every duration, spring constant and channel mapping of the site (cook/MOTION.md sections B and D), plus the pure
 * easing and critically damped spring math. Seconds unless the name says otherwise. No three, no DOM, no allocation
 * in any function meant for frame code: mappings write into caller-owned `out` objects.
 */

// Springs and easing

/** Critically damped spring: time to 99 % = 6.64 / omega, to 90 % = 3.89 / omega (MOTION B). */
export const SPRING_99 = 6.64;
/** A spring is settled when within 0.1 % of its target and slower than 0.1 % per second (MOTION D). */
export const SETTLE_EPS = 0.001;
export const SETTLE_VEL = 0.001;

export const omegaFor = (durationS: number): number => SPRING_99 / durationS;
const omegaToDuration = (omega: number): number => SPRING_99 / omega;

/** Mutable spring state, owned by the caller (one per channel). */
export interface SpringState { x: number; v: number }

/**
 * Advances a critically damped spring toward `target` by `dt` in closed form (exact for any dt, no substeps):
 * x(t) = target + (e + (v0 + w e) t) exp(-w t), with e = x0 - target. Writes into `s`; returns true when settled.
 */
export function springStep(s: SpringState, target: number, omega: number, dt: number): boolean {
  const e = s.x - target;
  const k = s.v + omega * e;
  const decay = Math.exp(-omega * dt);
  s.x = target + (e + k * dt) * decay;
  s.v = (s.v - omega * k * dt) * decay;
  if (Math.abs(s.x - target) < SETTLE_EPS && Math.abs(s.v) < SETTLE_VEL) {
    s.x = target;
    s.v = 0;
    return true;
  }
  return false;
}

/** Exponential follower (cursor light, zoom, moth): frame-rate independent, never overshoots. */
export const follow = (current: number, target: number, tauS: number, dt: number): number =>
  target + (current - target) * Math.exp(-dt / tauS);

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** CSS-style cubic-bezier(x1, y1, x2, y2) as a function of x in 0..1. Build once at module level, call per frame. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = sampleX(t) - x;
      if (Math.abs(d) < 1e-6) break;
      const sl = slopeX(t);
      if (Math.abs(sl) < 1e-6) break;
      t -= d / sl;
    }
    let lo = 0, hi = 1;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    for (let i = 0; i < 20 && Math.abs(sampleX(t) - x) > 1e-6; i++) {
      if (sampleX(t) < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}

/** V03 settle fit: the one ease-out of the site (UI, label, panel, travel dip, scripted tours). */
export const EASE_OUT = cubicBezier(0.27, 0.82, 0.62, 1);
/** A critically damped spring from rest drawn as a tween (rms 0.4 %). */
export const EASE_SPRING = cubicBezier(0.22, 0.17, 0.19, 1);
export const linear = (x: number): number => x;

// Stepped clock (content only; never camera, UI or channels)

export const STEP_FPS = 12;
export const STEP_HOLD_S = 1 / STEP_FPS;

// UI (DOM: transform and opacity only)

export const UI = {
  hoverS: 0.2,
  pressS: 0.1,
  pressScale: 0.98,
  chipS: 0.2,
  chipStaggerS: 0.04,
  chipsMax: 3,
  labelInS: 0.32,
  labelDelayS: 0.12,
  labelOutS: 0.2,
  labelRisePx: 8,
  panelOpenS: 0.42,
  panelCloseS: 0.3,
  panelSectionStaggerS: 0.03,
  flowerTurnS: 0.28,
} as const;

// Camera springs (durations; omega = omegaFor(duration))

export const CAMERA = {
  focusNudgeS: 0.6,
  viewEaseInS: 0.9,
  dollyS: 1.0,
  travelS: 1.6,
  travelPerBedS: 0.1,
  travelMaxS: 1.6,
  leanS: 0.25,
  leanBedFraction: 0.02,
  flingS: omegaToDuration(4.7),
  rubberBandFraction: 0.04,
  rubberBandS: omegaToDuration(11),
  zoomTauS: 0.08,
} as const;

/** Travel over n beds: min(1.6, 1.6 + 0.1 (n - 1)) s. ART section 1 asks 1.6 s per neighbour hop for the 10 m/s clamp (MOTION B12 said 1.4). */
export const travelS = (beds: number): number =>
  Math.min(CAMERA.travelMaxS, CAMERA.travelS + CAMERA.travelPerBedS * Math.max(0, beds - 1));

/** Travel accent: one slow exposure dip centred at 42 % of the move. Not flicker; off under reduced motion. */
export const TRAVEL_DIP = { at: 0.42, downS: 0.24, upS: 0.35, depth: 0.12 } as const;

/** Exposure multiplier (1 = none) at `elapsedS` into a move of `moveS`. */
export function travelDipOf(elapsedS: number, moveS: number, reduced: boolean): number {
  if (reduced) return 1;
  const centre = TRAVEL_DIP.at * moveS;
  const d = elapsedS < centre
    ? 1 - EASE_OUT(clamp01((elapsedS - (centre - TRAVEL_DIP.downS)) / TRAVEL_DIP.downS))
    : EASE_OUT(clamp01((elapsedS - centre) / TRAVEL_DIP.upS));
  return 1 - TRAVEL_DIP.depth * (1 - d);
}

// Iris, open channel, push, panel

/** Close / hold / open of the iris around a flower (springs omega 17.5 and 14.4). */
export const IRIS = { closeS: 0.38, holdS: 0.08, openS: 0.46, introOutS: 0.5, openRadius: 1.2, feather: 0.015 } as const;

/** The open channel: 0 garden, 0.5 iris shut (panel swap), 1 panel shown. */
export const OPEN_HALF = 0.5;
/** The iris counts as shut within this of OPEN_HALF (99 % of a half leg); the hold starts there. */
export const OPEN_HALF_NEAR = 0.005;

/** Anything with x, y, z, w (three's Vector4 fits). */
export interface Vec4Out { x: number; y: number; z: number; w: number }

/**
 * uIris from ch.open: closes around the flower for open 0..0.5 and reopens for 0.5..1.
 * cx, cy: flower centre in 0..1 of the screen (y up); aspect = width / height. Radius in screen heights.
 */
export function irisOf(open: number, cx: number, cy: number, aspect: number, out: Vec4Out): Vec4Out {
  const dx = (cx > 0.5 ? cx : 1 - cx) * aspect;
  const dy = cy > 0.5 ? cy : 1 - cy;
  const full = Math.max(IRIS.openRadius, Math.sqrt(dx * dx + dy * dy) * 1.02);
  const shut = open <= OPEN_HALF ? clamp01(open / OPEN_HALF) : clamp01((1 - open) / OPEN_HALF);
  const r = full * (1 - shut);
  out.x = cx;
  out.y = cy;
  out.z = r;
  out.w = Math.max(0.002, r * IRIS.feather);
  return out;
}

/** Camera push toward the slot, 0..1: front-loaded so the camera leads the iris, held while the panel is shown. */
export const pushOf = (open: number): number => {
  const u = clamp01(open / OPEN_HALF);
  return 1 - (1 - u) * (1 - u);
};

/** Panel progress 0..1 (transform and opacity): the panel appears only on the reopening half. */
export const panelOf = (open: number): number => EASE_OUT(clamp01((open - OPEN_HALF) / OPEN_HALF));

// Walk between neighbouring beds (ART section 1): the camera walks the rail on a shaped profile of ch.leg

/**
 * maxSpeed: m/s cap of a neighbour walk (longest hop 11.4 m). wingFadeFrom / wingFadeTo: near wings fade from 1 to 0
 * between these speeds. rampIn / rampOut: fractions of travelS spent accelerating and settling (a long soft settle,
 * as V03). carryS: time constant that hands the velocity of an interrupted walk to the new leg.
 */
export const WALK = { maxSpeed: 10, wingFadeFrom: 5, wingFadeTo: 6, rampIn: 0.15, rampOut: 0.35, carryS: 0.25 } as const;

const WALK_PEAK = 1 / (1 - WALK.rampIn / 2 - WALK.rampOut / 2);

/** Spring progress from rest p = 1 - (1 + u) exp(-u), inverted for u = omega t (bisection, no allocation). */
export function springTimeOf(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 24;
  let lo = 0, hi = 24;
  for (let i = 0; i < 28; i++) {
    const u = (lo + hi) / 2;
    if (1 - (1 + u) * Math.exp(-u) < p) lo = u; else hi = u;
  }
  return (lo + hi) / 2;
}

/** Walk progress 0..1 at normalised time tau (1 = travelS): cosine ramps around a constant-speed middle. */
export function walkProfile(tau: number): number {
  const t = clamp01(tau);
  const a = WALK.rampIn, b = WALK.rampOut;
  if (t < a) return WALK_PEAK * (t / 2 - (a / (2 * Math.PI)) * Math.sin((Math.PI * t) / a));
  if (t <= 1 - b) return WALK_PEAK * (a / 2 + t - a);
  const q = t - (1 - b);
  return WALK_PEAK * (a / 2 + 1 - a - b + q / 2 + (b / (2 * Math.PI)) * Math.sin((Math.PI * q) / b));
}

/** Walk progress for a leg channel value: the walk ends when the leg reaches 99 percent, at travelS. */
export const walkOf = (leg: number): number => walkProfile(springTimeOf(leg) / SPRING_99);

/** Seconds since the leg started, read back from its value (exact for a leg from rest). */
export const walkElapsedS = (leg: number): number => (springTimeOf(leg) / SPRING_99) * CAMERA.travelS;

/** Peak camera speed in m/s of a walk over `metres`. */
export const walkPeakSpeed = (metres: number): number => (Math.abs(metres) * WALK_PEAK) / CAMERA.travelS;

/** Extra metres that carry the velocity v0 of an interrupted walk into the new one, fading out (v0 t exp(-t / k)). */
export const walkCarry = (v0: number, elapsedS: number): number => v0 * elapsedS * Math.exp(-elapsedS / WALK.carryS);

/** Near-wing opacity at a camera speed (m/s). */
export const wingOpacityOf = (speed: number): number => 1 - clamp01((speed - WALK.wingFadeFrom) / (WALK.wingFadeTo - WALK.wingFadeFrom));

// Film strip during travel: only jumps of more than one bed (a neighbour is a walk)

export const STRIP = { barWidth: 0.03, sprocket: 1, minHops: 2 } as const;

/** uStrip from ch.leg over `hops` beds: frame offset -1..1 at bed boundaries, bar width, sprocket amount, enabled. */
export function stripOf(leg: number, hops: number, out: Vec4Out): Vec4Out {
  const moving = leg > 0 && leg < 1 && hops >= STRIP.minHops;
  const pos = leg * hops;
  out.x = moving ? (pos - Math.round(pos)) * 2 : 0;
  out.y = STRIP.barWidth;
  out.z = moving ? STRIP.sprocket : 0;
  out.w = moving ? 1 : 0;
  return out;
}

// Free roam behind ?roam=1 (cook/ROAM_PLAN.md sections 3 and 4, P1)

/**
 * The visitor's walk on the ground plane: top speed (m/s), linear ramps to it and to a stop, body radius (m), the
 * distance at which a walk target counts as reached, the collision passes, and the hysteresis (m past the halfway
 * line between two beds) before the nearest bed changes.
 */
export const ROAM = { speed: 3.2, toSpeedS: 0.15, toStopS: 0.1, radius: 0.3, arriveM: 0.05, passes: 2, maxStepS: 0.05, bedHysteresisM: 1 } as const;

/**
 * One follow framing: camera height over the ground (m), pitch below the horizon and vertical fov (degrees), and where
 * the moon hangs, as a share of the screen height from the top (in the band of sky over the wall).
 */
export interface FollowFraming { readonly up: number; readonly downDeg: number; readonly fov: number; readonly moonAt: number }

/**
 * The follow framings. Landscape uses the one FOLLOW.framing names; `low`, `mid` and `high` are the candidates compared
 * blind (closer and lower to farther and steeper, each with a band of sky over the wall). Portrait always uses `phone`:
 * a vertical fov under 55 degrees, so the visitor and the nearest flowers read large and the wall does not shrink.
 */
export const FOLLOW_FRAMINGS = {
  low: { up: 3.8, downDeg: 21, fov: 48, moonAt: 0.07 },
  mid: { up: 5, downDeg: 26, fov: 48, moonAt: 0.07 },
  high: { up: 6.4, downDeg: 31, fov: 48, moonAt: 0.07 },
  phone: { up: 4.4, downDeg: 24, fov: 52, moonAt: 0.12 },
} as const satisfies Record<string, FollowFraming>;

export type LandscapeFraming = Exclude<keyof typeof FOLLOW_FRAMINGS, 'phone'>;

/**
 * The follow camera: the landscape framing in use (`low`: its band of real sky shows the moon over the wall, where the
 * higher two show the ground behind the wall until the garden is closed); the visitor sits at `at` of the screen height
 * from the top (the back offset follows from it). tauS: the critically damped follower on the visitor (omega = 1 / tauS)
 * trails a 3.2 m/s walk by 2 * tauS * speed (0.64 m) and settles in 6.64 * tauS (0.66 s).
 */
export const FOLLOW: Readonly<{ framing: LandscapeFraming; at: number; tauS: number }> = { framing: 'low', at: 0.62, tauS: 0.1 };

/** A near framing: a follow framing plus where the visitor's ground point sits, as a share of the height from the top. */
export interface NearFraming extends FollowFraming { readonly at: number }

/**
 * The nearest framings the approach may use (world/fit.ts picks how far toward them to go): closer and lower than the
 * walking one, the visitor's light in the lower middle, the back wall and a band of sky with the moon above it.
 * Landscape and portrait (below PORTRAIT_ASPECT, follow.ts).
 */
export const NEAR_FRAMINGS = {
  landscape: { up: 2.3, downDeg: 10, fov: 44, moonAt: 0.07, at: 0.78 },
  phone: { up: 3, downDeg: 14, fov: 50, moonAt: 0.11, at: 0.74 },
} as const satisfies Record<string, NearFraming>;

/**
 * When the camera eases toward the fitted framing and back (world/approach.ts): in while proximity focuses a slot, the
 * fit gains and the visitor is not faster than fastMps; out after faster than fastMps for fastS, a move of leaveM
 * from where it eased in, or the focus ending. The ease is a critically damped spring that settles in inS going in and
 * outS going out.
 */
export const APPROACH = { fastMps: 1.5, fastS: 0.3, leaveM: 1, inS: 1.2, outS: 0.8 } as const;

/**
 * How far the approach goes (world/fit.ts): the focused subject's outline and the visitor's ground point must sit in a
 * safe area of the frame with `margin` (share of the width and height) inside it. The safe area starts below the top
 * band of fixed controls (topPx, ui/label.ts TOP_PX) and ends above a bottom band (bottomShare of the height, where
 * the cane labels stand); beside the subject stands the plant tag (ui/label.ts: width clamp(300 px, 19 vw, 368 px),
 * about tagAspect as tall as wide, gapPx past the subject's hit reach, on the side with more room). Below narrowPx
 * of width the tag is a strip of about phoneTagPx above the bottom edge, with phoneCanePx of cane labels over it.
 * The subject grows to at most cap of the frame height; less than minGain times its walking size is no gain. The
 * search takes `steps` steps toward the near framing and may slide the camera up to maxShiftM toward the subject.
 * nudge and nudgeY mirror the rig's focus nudge toward the slot (world/camera.ts FRAME), which the fit measures too.
 */
export const APPROACH_FIT = {
  margin: 0.06, cap: 0.45, minGain: 1.25, steps: 20, maxShiftM: 0.8, topPx: 96, bottomShare: 0.12,
  tagMinPx: 300, tagVw: 0.19, tagMaxPx: 368, tagAspect: 0.72, gapPx: 18, edgePx: 16, narrowPx: 720, phoneTagPx: 234, phoneCanePx: 70,
  nudge: 0.16, nudgeY: 0.5,
} as const;

// Mode switch: canvas exposure down, then the DOM cross-fade, no overlap

export const MODE = { totalS: 0.45, canvasDownS: 0.2, domUpS: 0.25 } as const;

/** Canvas exposure 1..0 for mode progress p (0 garden, 1 herbario) on a linear 450 ms tween. */
export const modeCanvasOf = (p: number): number => 1 - EASE_OUT(clamp01(p * MODE.totalS / MODE.canvasDownS));
/** Herbario layer opacity 0..1 for the same p. */
export const modeDomOf = (p: number): number =>
  EASE_OUT(clamp01((p * MODE.totalS - MODE.canvasDownS) / MODE.domUpS));

// Content animation on the 12 fps clock

/** Bloom openness per pose (u^2.6 rush plus a three-pose landing). */
export const BLOOM_POSES: readonly number[] = [0, 0.01, 0.04, 0.11, 0.23, 0.41, 0.65, 0.87, 0.97, 1];
export const BLOOM = { openS: 0.75, closeS: 0.375, startDelayTicks: 1 } as const;
export const PEACOCK = { openS: 1.5, openPoses: 18, closeS: 0.9, closePoses: 11, featherStagger: 4, outerTrailPoses: 4 } as const;
export const SUNDIAL = { spinUpS: 0.6, stepPerSector: 1.083, spinDownS: 1.1, hubOffset: 0.01 } as const;

/** Bloom openness at pose index i (clamped to the table). */
export const bloomAt = (i: number): number => BLOOM_POSES[i < 0 ? 0 : i >= BLOOM_POSES.length ? BLOOM_POSES.length - 1 : i] ?? 1;

// Light, creatures

export const LIGHT = { cursorTauS: 0.08, gatherInS: 0.4, gatherOutTauS: 0.35, swellSpeedPxS: 800, swell: 0.06, swellRelaxS: 0.4, idleDriftPeriodS: 20, idleDriftAmp: 0.03 } as const;
export const MOTH = { tauS: 0.45, lead: 0.12, flapsPerS: 3, glideFlapsPerS: 1.5, posesPerFlap: 4, landAfterS: 1.2, landOpenPoses: 6, avoidPx: 96, introS: 0.5 } as const;
export const FIREFLY = { inS: 0.4, outS: 1.1 } as const;

// Intro (3 s): fade up, kaleidoscope turn, iris-out, moth

export const INTRO = {
  totalS: 3.0,
  fadeUp: [0, 0.3],
  turn: [0, 2.2],
  irisOut: [2.2, 2.7],
  moth: [2.5, 3.0],
  beatS: 0.5,
  turnDegPerStep: 2.5,
  hubOrbit: 0.01,
  skipS: 0.3,
} as const;

// Film pass motion (flicker under 3 percent and under 2.5 Hz)

export const FILM = { weaveRms: 0.0003, weaveClamp: 0.001, flickerRms: 0.005, flickerClamp: 0.012, flickerMaxHz: 2.5, halationLagS: 0.1, scratchMinGapS: 6, scratchTicks: 2 } as const;

// Streaming: a bed fades in after its hidden warm draw; load work runs in slices of at most sliceMs per frame

/** Streaming: reveal, per-frame budget, and the retry of a failed bed (backoff doubles from retryMs, gives up after maxFails). */
export const STREAM = { revealS: 0.4, sliceMs: 4, uploadsPerFrame: 1, retryMs: 1000, maxFails: 3 } as const;

/**
 * Label card progress 0..1 after `elapsedS` since the focus changed: in after a delay (EASE_OUT), out at once.
 * Opacity plus a small rise; the caller restarts elapsedS on every focus change.
 */
export function labelOf(elapsedS: number, focused: boolean): number {
  return focused
    ? EASE_OUT(clamp01((elapsedS - UI.labelDelayS) / UI.labelInS))
    : 1 - EASE_OUT(clamp01(elapsedS / UI.labelOutS));
}

// Reduced motion

export const REDUCED = { travelFadeS: 0.3, bloomFadeS: 0.2 } as const;

// Channel drivers (cook/ARCH.md 2.1): spring durations, or the tween length for intro and mode

export const CHANNEL_S = {
  intro: INTRO.totalS,
  dolly: CAMERA.dollyS,
  leg: CAMERA.travelS,
  focus: LIGHT.gatherInS,
  openClose: IRIS.closeS,
  openReveal: IRIS.openS,
  mode: MODE.totalS,
} as const;
