/**
 * CameraRig (ARCH 2.5) on the raised rail of cook/ART.md section 1. pose = mix(overview(panX, zoom), walk, dolly),
 * then the focus nudge and the "View" push toward the slot. The walk is a continuous move along the rail driven by
 * ch.leg through the walk profile of core/motion.ts (10 m/s cap on a neighbour hop); a new leg starts from where the
 * camera is and carries its velocity, so every move reverses from where it is. Jumps over more than one bed dip
 * through the overview (the film strip covers them). Free roam (setFollow) puts the follow pose in place of the walk.
 * Pitch and yaw are radians; positive yaw turns the view toward +x.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import type { BedId, CameraRig, Clock, GardenLayout, Machine, Pose, ScreenPt, ShotId, SlotId, SlotView, State } from '../types.ts';
import { hopsFrom } from '../core/hops.ts';
import { terrainY } from '../core/terrain.ts';
import { CAMERA, WALK, follow, omegaFor, pushOf, springStep, walkCarry, walkElapsedS, walkOf, type SpringState } from '../core/motion.ts';
import { DEG, type WorldLayout } from './layout.ts';
import { createRail, filmPose, type RigPose } from './rail.ts';
import { pushThrough } from './exit.ts';

const FRAME = { zoomMax: 2, nudge: 0.16, nudgeY: 0.5, push: 0.55, hopDip: 0.35, near: 0.05, far: 400, portraitAspect: 0.8, speedTauS: 0.08 } as const;

export interface GardenRig extends CameraRig {
  readonly pose: Readonly<RigPose>;
  readonly camera: PerspectiveCamera;
  readonly width: number;
  readonly height: number;
  /** Camera speed along the rail, m/s (smoothed): near wings fade on it. */
  readonly speed: number;
  /** Replaces a bed's key (y, z, pitch in radians, fov); x stays the rail stop. Beds off the rail take the whole pose, yaw too if given. */
  setBedPose(bed: BedId, pose: Pose | RigPose): void;
  setSlots(slots: readonly SlotView[]): void;
  viewHeightAt(planeZ: number): number;
  /** World X of the overview pan: where a leg from the overview starts. */
  readonly panX: number;
  /** Free roam: this pose (read every frame) replaces the rail walk in the pose mix; null restores the rail. */
  setFollow(pose: Readonly<RigPose> | null): void;
  /** Writes the ground point (y 0) under a CSS pixel into out [x, y, z]; false when the ray misses the ground. */
  groundAt(xPx: number, yPx: number, out: Float32Array): boolean;
}

export function slotWorld(slots: readonly SlotView[], id: SlotId | null, out: Float32Array): boolean {
  if (id === null) return false;
  for (let i = 0; i < slots.length; i++) {
    const v = slots[i];
    if (v !== undefined && v.id === id) {
      out[0] = v.world[0];
      out[1] = v.world[1];
      out[2] = v.world[2];
      return true;
    }
  }
  return false;
}

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const halfTan = (fovDeg: number): number => Math.tan((fovDeg * Math.PI) / 360);

function mixPose(a: Readonly<RigPose>, b: Readonly<RigPose>, k: number, out: RigPose): void {
  out.x = mix(a.x, b.x, k);
  out.y = mix(a.y, b.y, k);
  out.z = mix(a.z, b.z, k);
  out.pitch = mix(a.pitch, b.pitch, k);
  out.yaw = mix(a.yaw, b.yaw, k);
  out.fov = mix(a.fov, b.fov, k);
}

const blank = (): RigPose => ({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0, fov: 40 });

export function createRig(layout: GardenLayout): GardenRig {
  const g = layout as WorldLayout;
  const ov = g.overview;
  const rail = createRail(g.rail);
  const camera = new PerspectiveCamera(ov.fov, 16 / 9, FRAME.near, FRAME.far);
  camera.rotation.order = 'YXZ';
  const pose: RigPose = { x: ov.x, y: ov.y, z: ov.z, pitch: ov.pitch, yaw: 0, fov: ov.fov };
  const last = blank();
  const offPoses = new Map<BedId, RigPose>();
  for (const [bed, f] of Object.entries(g.rail.off)) if (f !== undefined) offPoses.set(bed as BedId, filmPose(f, blank()));

  const omegaFling = omegaFor(CAMERA.flingS);
  const omegaRubber = omegaFor(CAMERA.rubberBandS);
  const omegaNudge = omegaFor(CAMERA.focusNudgeS);
  const [panLo, panHi] = g.pan;
  const anchorOf = (b: BedId): number => g.anchors[b];

  let width = 1280;
  let height = 720;
  let changed = true;
  let dirty = true;
  let panX = Math.min(panHi, Math.max(panLo, ov.x));
  let panV = 0;
  let dragging = false;
  let zoom = 1;
  let zoomTarget = 1;
  let zoomAnchorPx = -1;
  let prevDollyTarget = 0;
  let lastBed: BedId | null = null;
  let lastFromX = NaN;
  /** The current leg: where the walk started (its own x, not the machine's estimate), off-rail share, carried speed. */
  let fromX = ov.x;
  let fromOff = 0;
  /** The off-rail pose the current leg leaves (walking out of the grotto), if any. */
  let fromOffPose: RigPose | null = null;
  let carryV = 0;
  let hops = 0;
  let walkX = ov.x;
  let walkV = 0;
  let walkOff = 0;
  let speed = 0;
  let dollyNow = 0;
  let slots: readonly SlotView[] = [];
  let slotKnown = false;
  let snapNext = true;
  let shotPose: RigPose | null = null;
  let shotGen = -1;
  let roamPose: Readonly<RigPose> | null = null;
  let followX = NaN;
  /** Free roam: how far the camera has gone into an off-rail room (the grotto), on the focus nudge's spring. */
  const room: SpringState = { x: 0, v: 0 };
  let roomPose: RigPose | null = null;
  const inRoom = blank();
  const slotPt = new Float32Array(3);
  const over = blank();
  const walk = blank();
  const base = blank();
  const rubber: SpringState = { x: 0, v: 0 };
  const nx: SpringState = { x: 0, v: 0 };
  const ny: SpringState = { x: 0, v: 0 };
  const nz: SpringState = { x: 0, v: 0 };
  const v3 = new Vector3();
  const o3 = new Vector3();

  const overviewActive = (): boolean => prevDollyTarget < 0.5;
  const viewWidthAtZoom = (z: number): number => 2 * (ov.z / z) * halfTan(ov.fov) * (width / height);

  /** Visible beds passed between the walk's start and its target bed (the grotto is never passed: core/hops.ts). */
  function bedsPassed(x: number, bed: BedId): number {
    return Math.max(0, hopsFrom(g.order, anchorOf, x, bed) - 1);
  }

  function stepNudge(s: SpringState, target: number, snap: boolean, dt: number): number {
    if (snap) {
      s.x = target;
      s.v = 0;
    } else {
      springStep(s, target, omegaNudge, dt);
    }
    return s.x;
  }

  function stepPan(dt: number, snap: boolean): void {
    if (dragging) return;
    if (panX < panLo || panX > panHi) {
      const bound = panX < panLo ? panLo : panHi;
      if (snap) {
        panX = bound;
        panV = 0;
        return;
      }
      rubber.x = panX;
      rubber.v = panV;
      springStep(rubber, bound, omegaRubber, dt);
      panX = rubber.x;
      panV = rubber.v;
    } else if (panV !== 0) {
      const decay = Math.exp(-omegaFling * dt);
      panX += (panV * (1 - decay)) / omegaFling;
      panV = snap || Math.abs(panV * decay) < 1e-4 ? 0 : panV * decay;
    }
  }

  function stepZoom(dt: number, snap: boolean): void {
    if (zoom === zoomTarget) return;
    let z1 = snap ? zoomTarget : follow(zoom, zoomTarget, CAMERA.zoomTauS, dt);
    if (Math.abs(z1 - zoomTarget) < 1e-4) z1 = zoomTarget;
    const f = zoomAnchorPx < 0 ? 0 : zoomAnchorPx / width - 0.5;
    panX += f * (viewWidthAtZoom(zoom) - viewWidthAtZoom(z1));
    zoom = z1;
  }

  /** The walk side of the pose; false when there is no bed to walk to. */
  function stepWalk(s: State, leg: number, dt: number, snap: boolean): boolean {
    const bed = s.bed;
    if (bed !== lastBed || s.fromX !== lastFromX) {
      const fromOverview = lastBed === null || dollyNow < 0.01;
      fromX = fromOverview ? s.fromX : walkX;
      fromOff = fromOverview ? 0 : walkOff;
      carryV = fromOverview || snap ? 0 : walkV;
      fromOffPose = lastBed === null ? null : (offPoses.get(lastBed) ?? fromOffPose);
      lastBed = bed;
      lastFromX = s.fromX;
      if (bed !== null) hops = bedsPassed(fromX, bed);
    }
    if (bed === null) return false;
    const off = offPoses.get(bed);
    const tx = targetX(bed);
    const k = walkOf(leg);
    const x = mix(fromX, tx, k) + walkCarry(carryV, walkElapsedS(leg));
    if (dt > 0 && !snap) walkV = (x - walkX) / dt;
    if (snap) walkV = 0;
    walkX = x;
    walkOff = mix(fromOff, off === undefined ? 0 : 1, k);
    rail.sample(x, walk);
    walk.yaw += Math.max(-1, Math.min(1, walkV / WALK.maxSpeed)) * g.rail.yawLeadDeg * DEG;
    const offPose = off ?? fromOffPose;
    if (walkOff > 0 && offPose !== null) mixPose(walk, offPose, walkOff, walk);
    return true;
  }

  /** Free roam: the follow pose, eased into an off-rail room's pose (the grotto) while the visitor rests there. */
  function roamSide(s: State, dt: number, snap: boolean): Readonly<RigPose> | null {
    if (roamPose === null) return null;
    const there = s.bed === null ? undefined : offPoses.get(s.bed);
    if (there !== undefined) roomPose = there;
    const target = there !== undefined && s.phase !== 'travel' ? 1 : 0;
    stepNudge(room, target, snap || s.reduced, dt);
    if (room.x === 0 || roomPose === null) return roamPose;
    mixPose(roamPose, roomPose, room.x, inRoom);
    return inRoom;
  }

  function targetX(bed: BedId): number {
    const x = rail.stopX(bed);
    return Number.isNaN(x) ? (offPoses.get(bed)?.x ?? g.anchors[bed]) : x;
  }

  function apply(): void {
    camera.position.set(pose.x, pose.y, pose.z);
    camera.rotation.set(pose.pitch, -pose.yaw, 0);
    if (camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    changed = dirty || pose.x !== last.x || pose.y !== last.y || pose.z !== last.z || pose.pitch !== last.pitch || pose.yaw !== last.yaw || pose.fov !== last.fov;
    mixPose(pose, pose, 0, last);
    dirty = false;
  }

  function update(c: Clock, s: State, ch: Machine['ch']): void {
    const dt = c.dt;
    const snap = snapNext || (s.mode === 'herbario' && ch.mode.value >= 1);
    snapNext = false;
    if (slotWorld(slots, s.slot, slotPt)) slotKnown = true;

    const prevSideX = roamPose === null ? walkX : followX;
    const hasBed = stepWalk(s, ch.leg.value, dt, snap);
    let d = hasBed ? ch.dolly.value : 0;
    if (hasBed && hops > 0 && roamPose === null) d *= 1 - FRAME.hopDip * Math.sin(Math.PI * ch.leg.value);
    dollyNow = d;
    const sideX = roamPose === null ? walkX : roamPose.x;
    followX = roamPose === null ? NaN : roamPose.x;

    const dTarget = ch.dolly.target;
    if (prevDollyTarget >= 0.5 && dTarget < 0.5) {
      panX = sideX;
      panV = 0;
    }
    prevDollyTarget = dTarget;
    stepPan(dt, snap);
    stepZoom(dt, snap);

    over.x = panX;
    over.y = ov.y / zoom;
    over.z = ov.z / zoom;
    over.pitch = ov.pitch;
    over.yaw = 0;
    over.fov = ov.fov;
    if (hasBed) mixPose(over, roamSide(s, dt, snap) ?? walk, d, base);
    else mixPose(over, over, 0, base);

    const v = dt > 0 && hasBed && !Number.isNaN(prevSideX) ? Math.abs(sideX - prevSideX) / dt : 0;
    speed = snap ? 0 : follow(speed, v * d, FRAME.speedTauS, dt);

    const ft = slotKnown ? ch.focus.target : 0;
    const ox = base.x + stepNudge(nx, (slotPt[0]! - base.x) * FRAME.nudge * ft, snap, dt);
    const oy = base.y + stepNudge(ny, (slotPt[1]! - base.y) * FRAME.nudge * FRAME.nudgeY * ft, snap, dt);
    const oz = base.z + stepNudge(nz, (slotPt[2]! - base.z) * FRAME.nudge * ft, snap, dt);
    const p = slotKnown ? pushOf(ch.open.value) * FRAME.push : 0;

    if (shotPose !== null && shotGen < 0) shotGen = s.gen;
    if (shotPose !== null && s.gen !== shotGen) shotPose = null;
    if (shotPose !== null) {
      mixPose(shotPose, shotPose, 0, pose);
    } else {
      pose.x = mix(ox, slotPt[0]!, p);
      pose.y = mix(oy, slotPt[1]!, p * FRAME.nudgeY);
      pose.z = mix(oz, slotPt[2]!, p);
      pose.pitch = base.pitch;
      pose.yaw = base.yaw;
      pose.fov = base.fov;
    }
    pushThrough(pose);
    apply();
  }

  return {
    camera,
    pose,
    get changed() { return changed; },
    get width() { return width; },
    get height() { return height; },
    get panX() { return panX; },
    get speed() { return speed; },

    panBy(dxPx) {
      if (!overviewActive()) return;
      shotPose = null;
      dragging = true;
      panV = 0;
      let dx = (-dxPx * viewWidthAtZoom(zoom)) / width;
      const out = panX < panLo ? panLo - panX : panX > panHi ? panX - panHi : 0;
      const outward = (panX < panLo && dx < 0) || (panX > panHi && dx > 0);
      if (out > 0 && outward) dx *= Math.max(0, 1 - out / (CAMERA.rubberBandFraction * viewWidthAtZoom(zoom)));
      panX += dx;
    },
    fling(vxPxPerS) {
      dragging = false;
      if (!overviewActive()) return;
      shotPose = null;
      panV = (-vxPxPerS * viewWidthAtZoom(zoom)) / width;
    },
    zoomBy(k, atXPx) {
      if (!overviewActive()) return;
      shotPose = null;
      zoomTarget = Math.min(FRAME.zoomMax, Math.max(1, zoomTarget * k));
      zoomAnchorPx = atXPx;
    },
    project(wx, wy, wz, out: ScreenPt) {
      v3.set(wx, wy, wz).applyMatrix4(camera.matrixWorldInverse);
      const depth = -v3.z;
      v3.applyMatrix4(camera.projectionMatrix);
      out.x = ((v3.x + 1) / 2) * width;
      out.y = ((1 - v3.y) / 2) * height;
      out.scale = depth > FRAME.near ? height / (2 * halfTan(camera.fov) * depth) : 0;
      out.visible = depth > FRAME.near && v3.x >= -1 && v3.x <= 1 && v3.y >= -1 && v3.y <= 1;
      return out;
    },
    unproject(xPx, yPx, planeZ, out) {
      v3.set((xPx / width) * 2 - 1, 1 - (yPx / height) * 2, 0.5).unproject(camera);
      o3.copy(camera.position);
      v3.sub(o3);
      const k = v3.z === 0 ? 0 : (planeZ - o3.z) / v3.z;
      out[0] = o3.x + v3.x * k;
      out[1] = o3.y + v3.y * k;
      out[2] = planeZ;
    },
    groundAt(xPx, yPx, out) {
      v3.set((xPx / width) * 2 - 1, 1 - (yPx / height) * 2, 0.5).unproject(camera);
      o3.copy(camera.position);
      v3.sub(o3);
      if (v3.y >= 0) return false;
      for (let i = 0, y = 0; i < 3; i++, y = terrainY(out[0] ?? 0, out[2] ?? 0)) {
        const k = (y - o3.y) / v3.y; // y = 0, then the terrain under the last hit: taps land on the bank and slabs
        out[0] = o3.x + v3.x * k; out[1] = y; out[2] = o3.z + v3.z * k;
      }
      return true;
    },
    setFollow(p) {
      roamPose = p;
      followX = NaN;
      dirty = true;
    },
    update,
    setShot(id: ShotId) {
      snapNext = true;
      const f = g.film[id];
      if (f === undefined) return;
      shotPose = filmPose(f, blank());
      shotGen = -1;
    },
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      rail.setPortrait(width / height < FRAME.portraitAspect);
      dirty = true;
    },
    setBedPose(bed, p) {
      const off = offPoses.get(bed);
      if (off === undefined) {
        rail.setKey(bed, p);
        return;
      }
      off.x = p.x;
      off.y = p.y;
      off.z = p.z;
      off.pitch = p.pitch;
      off.fov = p.fov;
      if ('yaw' in p) off.yaw = p.yaw;
    },
    setSlots(v) {
      slots = v;
    },
    viewHeightAt(planeZ) {
      return 2 * Math.max(FRAME.near, pose.z - planeZ) * halfTan(pose.fov);
    },
  };
}
