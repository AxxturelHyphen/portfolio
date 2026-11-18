import { hopsFrom } from '../core/hops.ts';
import type { RoamControl } from '../core/input.ts';
import { CHANNEL_S, travelS, walkOf } from '../core/motion.ts';
import { spring } from '../core/spring.ts';
import type { BedId, Clock, Loop, Machine, Phase, ProjectId, SlotId, SlotView } from '../types.ts';
import type { GardenProxies } from '../ui/proxies.ts';
import type { GardenRig } from '../world/camera.ts';
import { createFollower, moonElevation, viewLimitsOf } from '../world/follow.ts';
import { SCENES } from '../world/garden.ts';
import { occluderBlocks } from '../world/occluders.ts';
import type { WorldLayout } from '../world/layout.ts';
import type { GardenLight } from '../world/light.ts';
import { createProximity } from '../world/proximity.ts';
import { bedAhead, createVisitor, HEADING, nearestBed, pathZ, type WalkArea } from '../world/roam.ts';

/**
 * Free roam behind ?roam=1 (cook/ROAM_PLAN.md P1): owns the visitor and its follow camera and keeps the machine's bed
 * in step with where the visitor walks (GOTO the nearest bed via 'scroll', so history is not spammed). A GOTO from
 * elsewhere (signpost, plan, history) carries the visitor to that bed's stand point, the path at the bed's anchor, on
 * its own leg (the machine's leg snaps under roam). The light is carried at the visitor.
 * P4: the nearest flower in reach is focused (world/proximity.ts) unless hover, keyboard, a tap or Esc chose; Enter on
 * the page opens it; the bed ahead in the walking direction streams in early; travel ends once the visitor is inside.
 */

export interface RoamDeps {
  machine: Machine;
  rig: GardenRig;
  light: GardenLight;
  loop: Loop;
  world: WorldLayout;
  bedOfProject(id: ProjectId): BedId | null;
  proxies: Pick<GardenProxies, 'activate' | 'setNear'>;
  /** Walks the machine's table again (the visitor arrived in the bed). */
  refresh(): void;
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
  /** Test hook: walk toward (x, z) as a click on the ground there would. */
  walkTo(x: number, z: number): void;
  /** The slots of the entered bed, for proximity (empty while none is entered). */
  setSlots(slots: readonly SlotView[]): void;
  /** The bed ahead in the walking direction once the visitor is near it (streaming), else null. */
  heading(): BedId | null;
  /** The visitor stands inside the bed's x range (always true while the garden is hidden). */
  arrived(b: BedId): boolean;
}

const settledIn = (p: Phase): boolean => p === 'bed' || p === 'focus';

export function createRoamDrive(d: RoamDeps): RoamDrive {
  const { machine, rig, light, loop, world } = d;
  const ground = world.ground;
  const blocks = occluderBlocks(ground.enclosure, SCENES);
  const area: WalkArea = { ...ground.enclosure.walk, pond: ground.pond, path: ground.path.points, blocks };
  const limits = viewLimitsOf(ground.enclosure, ground.wall.z);
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
  let nearBed: BedId | null = beds.includes(start) ? start : nearestBed(visitor.pos[0]!, null, beds, anchorOf);
  let startPending = first === null;
  /** The assisted move's own leg: the machine's leg snaps under roam. */
  const carry = spring(CHANNEL_S.leg);
  const near = createProximity();
  /** Proximity acts once the visitor has walked by itself (not at a spawn or after an assisted move). */
  let armed = false;
  let steering = false;
  /** The focus proximity last asked for; undefined after any other change, so it asks again. */
  let tried: SlotId | null | undefined;
  let shown: SlotId | null = null;
  let dir = 0;
  let ahead: BedId | null = null;
  const boundsOf = (b: BedId): readonly [number, number] => SCENES[b].bounds;

  rig.setFollow(follower.pose);
  light.carry(visitor.pos);

  machine.subscribe((s, prev) => {
    if (!steering) {
      tried = undefined;
      const slot = s.phase === 'focus' ? s.slot : null;
      if (settledIn(s.phase) && settledIn(prev.phase) && s.bed === prev.bed && slot !== (prev.phase === 'focus' ? prev.slot : null)) {
        near.yieldAt(visitor.pos[0]!, visitor.pos[1]!);
        showNear(null);
      }
    }
    if (s.bed === prev.bed || s.bed === null || s.bed === asked) return;
    asked = s.bed;
    nearBed = beds.includes(s.bed) ? s.bed : nearBed;
    armed = false;
    if (s.reduced || s.mode === 'herbario') {
      visitor.place(anchorOf(s.bed), standZ(s.bed));
      return;
    }
    visitor.assist(anchorOf(s.bed), standZ(s.bed));
    carry.retime(travelS(Math.max(1, hopsFrom(world.order, anchorOf, visitor.pos[0]!, s.bed))));
    carry.snap(0);
    carry.to(1);
  });

  function showNear(slot: SlotId | null): void {
    if (slot === shown) return;
    shown = slot;
    d.proxies.setNear(slot);
  }

  /** Focuses the slot in reach, or blurs when none is, unless something else chose and the visitor has not walked away. */
  function steer(): void {
    const s = machine.state;
    if (!armed || s.mode !== 'garden' || !settledIn(s.phase) || !near.update(visitor.pos[0]!, visitor.pos[1]!)) return;
    const want = near.want;
    showNear(want);
    if (want === (s.phase === 'focus' ? s.slot : null) || want === tried) return;
    tried = want;
    steering = true;
    try {
      machine.send(want === null ? { type: 'BLUR' } : { type: 'FOCUS', slot: want });
    } finally {
      steering = false;
    }
  }

  function arrived(b: BedId): boolean {
    if (machine.state.mode === 'herbario') return true;
    const [x0, x1] = boundsOf(b);
    const x = visitor.pos[0]!;
    return x >= x0 && x <= x1;
  }

  /** The bed ahead in the direction of the last clear walk, within reach of the streaming lookahead. */
  function look(): void {
    const vx = visitor.vel[0]!;
    if (Math.abs(vx) > HEADING.minSpeed) dir = Math.sign(vx);
    ahead = dir === 0 ? null : bedAhead(visitor.pos[0]!, dir, beds, boundsOf, HEADING.withinM);
  }

  /** Sends GOTO for the nearest bed when the walking visitor changed it (or once, to come down from the overview). */
  function keepBed(): void {
    const s = machine.state;
    if (s.mode !== 'garden' || s.phase === 'intro' || s.intent.k === 'project' || visitor.assisted) return;
    nearBed = nearestBed(visitor.pos[0]!, nearBed, beds, anchorOf);
    const want = s.intent.k === 'bed' ? s.intent.bed : null;
    if (nearBed === null || nearBed === want || !(startPending || visitor.busy)) return;
    startPending = false;
    asked = nearBed;
    machine.send({ type: 'GOTO', place: { k: 'bed', bed: nearBed }, via: 'scroll' });
  }

  return {
    pos: visitor.pos,
    setHeld(bits) {
      visitor.setHeld(bits);
    },
    pointAt(xPx, yPx) {
      if (rig.groundAt(xPx, yPx, hit)) visitor.walkTo(hit[0]!, hit[2]!);
    },
    walkTo(x, z) {
      visitor.walkTo(x, z);
    },
    activate() {
      const s = machine.state;
      if (s.phase === 'focus' && s.slot !== null) d.proxies.activate(s.slot);
    },
    setSlots(slots) {
      near.setSlots(slots);
      tried = undefined;
    },
    heading: () => ahead,
    arrived,
    frame(c) {
      if (visitor.assisted) {
        carry.tick(c.dt);
        visitor.assistAt(walkOf(carry.value), c.dt);
      } else {
        visitor.step(c.dt);
        if (visitor.busy) armed = true;
      }
      if (visitor.busy) loop.wake();
      keepBed();
      look();
      steer();
      const s = machine.state;
      if (s.phase === 'travel' && s.bed !== null && arrived(s.bed)) d.refresh();
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
