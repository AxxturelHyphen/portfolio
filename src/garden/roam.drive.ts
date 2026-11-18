import type { RoamControl } from '../core/input.ts';
import { walkOf } from '../core/motion.ts';
import type { BedId, Clock, Loop, Machine, ProjectId } from '../types.ts';
import type { GardenRig } from '../world/camera.ts';
import { createFollower, moonElevation, type ViewLimits } from '../world/follow.ts';
import type { WorldLayout } from '../world/layout.ts';
import type { GardenLight } from '../world/light.ts';
import { createVisitor, nearestBed, pathZ, type WalkArea } from '../world/roam.ts';

/**
 * Free roam behind ?roam=1 (cook/ROAM_PLAN.md P1): owns the visitor and its follow camera and keeps the machine's bed
 * in step with where the visitor walks (GOTO the nearest bed via 'scroll', so history is not spammed). A GOTO from
 * elsewhere (signpost, plan, history) carries the visitor to that bed's stand point, the path at the bed's anchor, on
 * the travel leg. The light is carried at the visitor.
 */

/** P1 limits until the garden is closed (P3): the rectangle the visitor walks in and what the camera may show. */
const AREA = { minX: -2.8, maxX: 46, minZ: -5.5, maxZ: 3 } as const;
const VIEW = { minX: -3.5, maxX: 46.5, maxZ: 8.5 } as const;

export interface RoamDeps {
  machine: Machine;
  rig: GardenRig;
  light: GardenLight;
  loop: Loop;
  world: WorldLayout;
  bedOfProject(id: ProjectId): BedId | null;
}

export interface RoamDrive extends RoamControl {
  /** Stage 'input', after the input frame: moves the visitor, then follows it with the machine's bed. */
  frame(c: Clock): void;
  /** Stage 'camera', before the rig: steps the follow pose the rig mixes in. */
  follow(c: Clock): void;
  resize(w: number, h: number): void;
  /** Elevation (degrees) that hangs the moon in the follow frame's band of sky over the wall, for the current aspect. */
  moonElevation(): number;
  /** [x, z] of the visitor (read only). */
  readonly pos: Float32Array;
}

export function createRoamDrive(d: RoamDeps): RoamDrive {
  const { machine, rig, light, loop, world } = d;
  const ground = world.ground;
  const area: WalkArea = { ...AREA, pond: ground.pond, path: ground.path.points };
  const limits: ViewLimits = { ...VIEW, wallZ: ground.wall.z };
  const beds = world.rail.keys.flatMap((k) => (k.bed === undefined ? [] : [k.bed]));
  const anchorOf = (b: BedId): number => world.anchors[b];
  const standZ = (b: BedId): number => pathZ(area.path, anchorOf(b));

  const intent = machine.state.intent;
  const first = intent.k === 'bed' ? intent.bed : intent.k === 'project' ? d.bedOfProject(intent.id) : null;
  const start = first ?? beds[0] ?? world.order[0]!;
  const visitor = createVisitor(area, anchorOf(start), standZ(start));
  const follower = createFollower(limits);
  const hit = new Float32Array(3);
  /** The bed this drive last asked for: a bed change to any other came from elsewhere. */
  let asked: BedId | null = start;
  let near: BedId | null = beds.includes(start) ? start : nearestBed(visitor.pos[0]!, null, beds, anchorOf);
  let carryTo: BedId | null = null;
  let startPending = first === null;

  rig.setFollow(follower.pose);
  light.carry(visitor.pos);

  machine.subscribe((s, prev) => {
    if (s.bed === prev.bed || s.bed === null || s.bed === asked) return;
    asked = s.bed;
    carryTo = s.bed;
    near = beds.includes(s.bed) ? s.bed : near;
    visitor.assist(anchorOf(s.bed), standZ(s.bed));
  });

  /** Sends GOTO for the nearest bed when the walking visitor changed it (or once, to come down from the overview). */
  function keepBed(): void {
    const s = machine.state;
    if (s.mode !== 'garden' || s.phase === 'intro' || s.intent.k === 'project' || visitor.assisted) return;
    near = nearestBed(visitor.pos[0]!, near, beds, anchorOf);
    const want = s.intent.k === 'bed' ? s.intent.bed : null;
    if (near === null || near === want || !(startPending || visitor.busy)) return;
    startPending = false;
    asked = near;
    machine.send({ type: 'GOTO', place: { k: 'bed', bed: near }, via: 'scroll' });
  }

  return {
    pos: visitor.pos,
    setHeld(bits) {
      visitor.setHeld(bits);
    },
    pointAt(xPx, yPx) {
      if (rig.groundAt(xPx, yPx, hit)) visitor.walkTo(hit[0]!, hit[2]!);
    },
    frame(c) {
      if (visitor.assisted) {
        const s = machine.state;
        visitor.assistAt(s.phase === 'travel' && s.bed === carryTo ? walkOf(machine.ch.leg.value) : 1, c.dt);
      } else {
        visitor.step(c.dt);
      }
      if (visitor.busy) loop.wake();
      keepBed();
    },
    follow(c) {
      follower.step(visitor.pos[0]!, visitor.pos[1]!, c.dt, c.frozen || machine.state.reduced);
    },
    resize(w, h) {
      follower.resize(w, h);
    },
    moonElevation: () => moonElevation(follower.framing),
  };
}
