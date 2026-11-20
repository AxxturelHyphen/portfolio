import { createSoundControl } from '../audio/control.ts';
import { SOUND_EVENT, soundOn } from '../audio/pref.ts';
import type { SoundMap, Spot } from '../audio/space.ts';
import type { RuntimeLoop } from '../core/loop.ts';
import type { BedId, DebugParams, Machine, Tier } from '../types.ts';
import { ACTIVATE_EVENT } from '../ui/proxies.ts';
import { pathDistance } from '../world/groundplan.ts';
import type { BedScene3, GroundData, WorldLayout } from '../world/layout.ts';

/**
 * The garden's sound, wired to the world (audio/control.ts decides when, audio/engine.ts plays). Started once the
 * garden is interactive; never in a still (?shot, ?t) or a test run (?bench=1), so those stay silent and repeatable.
 * The music box is the Estanque's sundial (its clockwork armillary): walking up to it plays it. A pet (the Rosaleda
 * cat) purrs when activated. The visitor's footsteps sound on each foot set down: stone within the path's width
 * (garden.json ground.path), soil and grass off it.
 */

const BOX_BED: BedId = 'estanque';
const BOX_SLOT = 'sundial';
/** Plates a bird may call from (the trees, the martin on the wall, the birdhouse); the wall's piers serve as well. */
const PERCHES: ReadonlySet<string> = new Set(['sh/wing-trunk', 'pu/martin', 'sa/trunk', 'sa/birdhouse', 'v/cypress']);

export function soundMapOf(world: WorldLayout, scenes: Readonly<Record<BedId, BedScene3>>): SoundMap {
  const { pond, wall } = world.ground;
  const sundial = scenes[BOX_BED].slots.find((s) => s.id === BOX_SLOT);
  const perches: Spot[] = wall.piers.map((x) => ({ x, z: wall.z }));
  for (const scene of Object.values(scenes)) {
    for (const layer of scene.layers) for (const it of layer.items) if (PERCHES.has(it.sprite)) perches.push({ x: it.x, z: it.z });
  }
  return {
    pond: { x: pond.x, z: pond.z, r: Math.min(pond.rx, pond.rz) },
    box: sundial === undefined ? { x: pond.x, z: pond.z } : { x: sundial.x, z: sundial.z },
    perches,
  };
}

export function petSlotsOf(scenes: Readonly<Record<BedId, BedScene3>>): ReadonlySet<string> {
  return new Set(Object.values(scenes).flatMap((s) => s.slots.filter((x) => x.kind === 'pet').map((x) => `${s.id}/${x.id}`)));
}

export interface SoundHost {
  machine: Machine;
  loop: RuntimeLoop;
  q: DebugParams;
  tier: Tier;
  map: SoundMap;
  /** Ids (bed/slot) of the pet slots: activating one purrs. */
  pets: ReadonlySet<string>;
  /** Free roam: the visitor's [x, z], where the garden is heard from. */
  visitor: Float32Array | null;
  /** Free roam: the figure's footfalls so far (VisitorLantern.steps). */
  steps(): number;
  /** The stone path the footsteps tap on. */
  path: GroundData['path'];
  /** The rail: the camera's x; it is heard from the path there. */
  cameraX(): number;
  proxies: HTMLElement;
}

/** The rail has no visitor: it listens from the path in front of the beds. */
const RAIL_EAR_Z = 1;

export const soundAllowed = (q: DebugParams): boolean =>
  q.shot === undefined && q.t === undefined && q.bench !== 1 && typeof AudioContext === 'function';

export function startSound(h: SoundHost): void {
  if (!soundAllowed(h.q)) return;
  const control = createSoundControl({
    target: window,
    doc: document,
    on: soundOn(),
    makeContext: () => {
      try {
        return new AudioContext({ latencyHint: 'playback' });
      } catch {
        return null;
      }
    },
    loadEngine: (ctx) => import('../audio/engine.ts').then((m) => m.createEngine(ctx, { map: h.map, full: h.tier !== 'low' })),
    ignore: (t) => t instanceof Element && t.closest('.tg-sound') !== null,
  });
  const follow = (): void => {
    const s = h.machine.state;
    control.setGarden(s.mode === 'garden');
    control.setDuck(s.phase === 'opening' || s.phase === 'inspect');
  };
  follow();
  h.machine.subscribe(follow);
  window.addEventListener(SOUND_EVENT, (e) => control.setOn((e as CustomEvent<boolean>).detail));
  h.proxies.addEventListener(ACTIVATE_EVENT, (e) => {
    if (h.pets.has((e as CustomEvent<string>).detail)) control.purr();
  });
  const v = h.visitor;
  const kerb = h.path.width / 2;
  let stepped = h.steps();
  h.loop.on('dom', () => {
    if (v === null) {
      control.hear(h.cameraX(), RAIL_EAR_Z);
      return;
    }
    const x = v[0] ?? 0;
    const z = v[1] ?? 0;
    control.hear(x, z);
    const n = h.steps();
    if (n === stepped) return;
    stepped = n;
    control.step(pathDistance(h.path.points, x, z) <= kerb, n);
  });
}
