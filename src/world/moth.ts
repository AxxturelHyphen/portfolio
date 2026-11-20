/**
 * The moth (ARCH 2.8, spec §16). Canvas only: no DOM node, no hit area, so it never blocks input.
 * On the rail it is flight and wing logic (pos and wing are what a writer reads); flight is a full-rate follower and
 * wing poses step on the 12 fps clock (one pose per tick = 3 flaps/s at 4 poses).
 * Under free roam (roam()) it keeps to the grotto's ivy and is drawn out to the visitor's lantern (moth.roam.ts),
 * flutters on an erratic path (moth.flutter.ts) and is drawn as two hinged wing cards (moth.draw.ts).
 */
import type { Clock, InstanceWriter, LightRig, Machine, Moth, ScreenPt, SlotView, SpriteRect, State } from '../types.ts';
import { INTRO, MOTH, STEP_FPS, clamp01, follow } from '../core/motion.ts';
import type { GardenRig } from './camera.ts';
import { createMothDraw } from './moth.draw.ts';
import { flutterAt } from './moth.flutter.ts';
import { createMothRoam, type MothRoam } from './moth.roam.ts';

type MothMode = Moth['mode'];

/** Flight geometry (fractions of the view height, radians). */
const PATH = {
  leadX: -0.6,
  leadY: 0.8,
  fleeX: -0.75,
  fleeY: 0.6,
  circleR: 0.08,
  circleRadPerS: 3.2,
  stillEps: 1e-3,
  landLift: 0.02,
} as const;

/** Creature timings not in core/motion.ts yet (requested there). */
const TIMING = { circleS: 2, restWingTicks: 6 } as const;

/** Wing openness per flap pose (closed, half, open, half) and the landed opening over 6 poses. */
const FLAP: readonly number[] = [0.15, 0.6, 1, 0.6];

/** The roll into a turn under free roam: radians per m/s of sideways speed, the most it rolls, its follow time (s). */
const BANK = { perMS: 0.35, max: 0.5, tauS: 0.15 } as const;

export interface GardenMoth extends Moth {
  /** World x, y, z and wing openness 0..1. */
  readonly pos: Float32Array;
  /** 0 hidden (before the intro reaches it), 1 shown. */
  readonly alpha: number;
  /** Free roam: the moth lives at `home` (the grotto's mouth, world x, y, z) and answers the lantern at `flame`. */
  roam(flame: Float32Array, home: Float32Array): void;
  /** Free roam: the batch and the moth plate to draw the wings with. */
  attach(writer: InstanceWriter, rect: SpriteRect): void;
}

export function createMoth(rig: GardenRig): GardenMoth {
  const pos = new Float32Array(4);
  const target = new Float32Array(3);
  const lastLight = new Float32Array(3);
  const centre = new Float32Array(3);
  const pt: ScreenPt = { x: 0, y: 0, scale: 0, visible: false };
  const cur: ScreenPt = { x: 0, y: 0, scale: 0, visible: false };
  let mode: MothMode = 'intro';
  let alpha = 0;
  let placed = false;
  let stillS = 0;
  let celebrateS = 0;
  let angle = 0;
  let lastTick = -1;
  let flapPose = 0;
  let landPose = 0;
  let tickCount = 0;
  let flight: MothRoam | null = null;
  const draw = createMothDraw();
  const flutter = new Float32Array(4);
  let bank = 0;
  let lastX = 0;

  function nearestProject(slots: readonly SlotView[], x: number, y: number): SlotView | null {
    let best: SlotView | null = null;
    let bestD = Infinity;
    for (let i = 0; i < slots.length; i++) {
      const v = slots[i]!;
      if (v.kind !== 'project') continue;
      const d = (v.world[0] - x) * (v.world[0] - x) + (v.world[1] - y) * (v.world[1] - y);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  function choose(s: State, ch: Machine['ch'], light: LightRig, slots: readonly SlotView[], viewH: number): MothMode {
    const lx = light.cursor[0]!;
    const ly = light.cursor[1]!;
    const lz = light.cursor[2]!;
    if (celebrateS > 0) {
      target[0] = centre[0]! + Math.cos(angle) * PATH.circleR * viewH;
      target[1] = centre[1]! + Math.sin(angle) * PATH.circleR * viewH;
      target[2] = centre[2]!;
      return 'circle';
    }
    if (s.phase === 'intro') {
      target[0] = lx;
      target[1] = ly;
      target[2] = lz;
      return 'intro';
    }
    const land = nearestProject(slots, lx, ly);
    if (s.reduced) {
      target[0] = land === null ? lx : land.world[0];
      target[1] = land === null ? ly : land.world[1] + PATH.landLift * viewH;
      target[2] = land === null ? lz : land.world[2];
      return 'rest';
    }
    if (ch.open.value > 0.001 || ch.open.target > 0) {
      target[0] = rig.pose.x + PATH.fleeX * viewH * (rig.width / rig.height);
      target[1] = rig.pose.y + PATH.fleeY * viewH;
      target[2] = lz;
      return 'flee';
    }
    if (land !== null && stillS >= MOTH.landAfterS && (s.phase === 'bed' || s.phase === 'focus')) {
      target[0] = land.world[0];
      target[1] = land.world[1] + PATH.landLift * viewH;
      target[2] = land.world[2];
      return 'land';
    }
    target[0] = lx + PATH.leadX * MOTH.lead * viewH;
    target[1] = ly + PATH.leadY * MOTH.lead * viewH;
    target[2] = lz;
    return 'follow';
  }

  /** Keeps the moth outside MOTH.avoidPx of the light on screen (lazy distance, never on the pointer). */
  function avoidPointer(light: LightRig): void {
    rig.project(light.cursor[0]!, light.cursor[1]!, light.cursor[2]!, pt);
    rig.project(pos[0]!, pos[1]!, pos[2]!, cur);
    const dx = cur.x - pt.x;
    const dy = cur.y - pt.y;
    const d = Math.hypot(dx, dy);
    if (d >= MOTH.avoidPx || cur.scale <= 0) return;
    const push = (MOTH.avoidPx - d) / cur.scale;
    const ux = d > 1e-3 ? dx / d : PATH.leadX;
    const uy = d > 1e-3 ? dy / d : -PATH.leadY;
    pos[0] = pos[0]! + ux * push;
    pos[1] = pos[1]! - uy * push;
  }

  function stepWings(c: Clock): void {
    const tick = Math.floor(c.t * STEP_FPS);
    const ticks = lastTick < 0 || c.frozen ? 0 : Math.max(0, tick - lastTick);
    lastTick = tick;
    for (let i = 0; i < ticks; i++) {
      tickCount++;
      if (mode === 'land') landPose = Math.min(MOTH.landOpenPoses, landPose + 1);
      else landPose = 0;
      const every = mode === 'rest' ? TIMING.restWingTicks : mode === 'land' ? 2 : 1;
      if (tickCount % every === 0 && !(mode === 'land' && landPose >= MOTH.landOpenPoses)) flapPose = (flapPose + 1) % FLAP.length;
    }
    pos[3] = mode === 'land' && landPose > 0 ? landPose / MOTH.landOpenPoses : (FLAP[flapPose] ?? 1);
  }

  /** Free roam: phase, flight centre, flutter and bank, then the wing cards. */
  function roamStep(c: Clock, s: State, f: MothRoam): void {
    f.step(c, s.reduced, pos);
    mode = f.mode;
    const t = f.target;
    const first = !placed;
    if (first || c.frozen || s.reduced) {
      pos[0] = t[0]!;
      pos[1] = t[1]!;
      pos[2] = t[2]!;
      placed = true;
    } else {
      pos[0] = follow(pos[0]!, t[0]!, f.tauS, c.dt);
      pos[1] = follow(pos[1]!, t[1]!, f.tauS, c.dt);
      pos[2] = follow(pos[2]!, t[2]!, f.tauS, c.dt);
    }
    flutterAt(c.t, f.wander, s.reduced, flutter);
    const x = pos[0]! + flutter[0]!;
    const still = first || c.frozen || s.reduced || c.dt <= 0;
    const lean = still ? 0 : Math.max(-BANK.max, Math.min(BANK.max, (-(x - lastX) / c.dt) * BANK.perMS));
    bank = still ? 0 : follow(bank, lean, BANK.tauS, c.dt);
    lastX = x;
    pos[3] = flutter[3]!;
    draw.write(x, pos[1]! + flutter[1]!, pos[2]! + flutter[2]!, flutter[3]!, bank, alpha);
  }

  return {
    pos,
    get mode() { return mode; },
    get alpha() { return alpha; },
    roam(flame, home) {
      flight = createMothRoam(flame, home);
    },
    attach(writer, rect) {
      draw.attach(writer, rect);
    },
    celebrate() {
      flight?.celebrate();
      celebrateS = TIMING.circleS;
      centre[0] = pos[0]!;
      centre[1] = pos[1]!;
      centre[2] = pos[2]!;
    },
    update(c, s, ch, light, slots) {
      const dt = c.dt;
      const viewH = rig.viewHeightAt(light.cursor[2]!);
      const lx = light.cursor[0]!;
      const ly = light.cursor[1]!;
      const still = Math.abs(lx - lastLight[0]!) + Math.abs(ly - lastLight[1]!) < PATH.stillEps * viewH;
      /** Frozen time (`?t`, the test API): timers and the circling angle come from c.t, never from accumulated dt. */
      stillS = !still ? 0 : c.frozen ? Math.max(stillS + dt, MOTH.landAfterS) : stillS + dt;
      lastLight[0] = lx;
      lastLight[1] = ly;
      celebrateS = c.frozen ? 0 : Math.max(0, celebrateS - dt);
      angle = c.frozen ? PATH.circleRadPerS * c.t : angle + PATH.circleRadPerS * dt;
      const introAt = INTRO.moth[0] / INTRO.totalS;
      alpha = s.phase === 'intro' ? clamp01((ch.intro.value - introAt) / (1 - introAt)) : 1;
      if (flight !== null) {
        roamStep(c, s, flight);
        return;
      }

      mode = choose(s, ch, light, slots, viewH);

      if (!placed || c.frozen) {
        pos[0] = target[0]!;
        pos[1] = target[1]!;
        pos[2] = target[2]!;
        placed = true;
      } else {
        pos[0] = follow(pos[0]!, target[0]!, MOTH.tauS, dt);
        pos[1] = follow(pos[1]!, target[1]!, MOTH.tauS, dt);
        pos[2] = follow(pos[2]!, target[2]!, MOTH.tauS, dt);
      }
      if (mode === 'follow' || mode === 'land') avoidPointer(light);
      stepWings(c);
    },
  };
}
