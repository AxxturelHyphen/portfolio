/**
 * CameraRig (ARCH 2.5): the pose is a pure function of state, channels, overview pan and zoom, so every move reverses
 * from where it is and closing a project lands on the exact stored pose. Pose units: world X along the garden, Y up,
 * the camera looks toward -Z; pitch in radians (negative looks down), fov in degrees (vertical, as three uses it).
 */
import { PerspectiveCamera, Vector3 } from 'three';
import type { BedId, CameraRig, Clock, GardenLayout, Machine, Pose, ScreenPt, ShotId, SlotId, SlotView, State } from '../types.ts';
import { CAMERA, follow, omegaFor, pushOf, springStep, type SpringState } from '../core/motion.ts';

/** Framing geometry (fractions and world units, no timings). */
const FRAME = {
  zoomMax: 2,
  bedY: 0.55,
  bedZ: 0.45,
  bedPitch: 0.4,
  nudge: 0.16,
  nudgeY: 0.5,
  push: 0.55,
  hopDip: 0.35,
  near: 0.05,
  far: 400,
} as const;

/** The rig as the world and garden folders see it: the CameraRig contract plus the wiring the composition root needs. */
export interface GardenRig extends CameraRig {
  readonly camera: PerspectiveCamera;
  readonly width: number;
  readonly height: number;
  /** Overrides the default bed pose with the BedScene pose (x is the bed anchor). */
  setBedPose(bed: BedId, pose: Pose): void;
  /** The active bed's slots, for the focus nudge and the "View" push. */
  setSlots(slots: readonly SlotView[]): void;
  /** World units visible vertically at plane z from the current pose. */
  viewHeightAt(planeZ: number): number;
  /** World X of the overview pan: where a leg from the overview starts. */
  readonly panX: number;
}

/** Writes the world position of slot `id` into out[0..2]; false when the slot is not in `slots`. */
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

function copyPose(from: Readonly<Pose>, to: Pose): void {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.pitch = from.pitch;
  to.fov = from.fov;
}

export function createRig(g: GardenLayout): GardenRig {
  const ov = g.overview;
  const camera = new PerspectiveCamera(ov.fov, 16 / 9, FRAME.near, FRAME.far);
  const pose: Pose = { x: ov.x, y: ov.y, z: ov.z, pitch: ov.pitch, fov: ov.fov };
  const last: Pose = { x: NaN, y: NaN, z: NaN, pitch: NaN, fov: NaN };
  const bedPoses = new Map<BedId, Pose>();
  for (const id of Object.keys(g.anchors) as BedId[]) {
    bedPoses.set(id, { x: g.anchors[id], y: ov.y * FRAME.bedY, z: ov.z * FRAME.bedZ, pitch: ov.pitch * FRAME.bedPitch, fov: ov.fov });
  }
  let minA = Infinity;
  let maxA = -Infinity;
  for (const id of g.order) {
    minA = Math.min(minA, g.anchors[id]);
    maxA = Math.max(maxA, g.anchors[id]);
  }
  const spacing = g.order.length > 1 ? (maxA - minA) / (g.order.length - 1) : 1;

  const omegaFling = omegaFor(CAMERA.flingS);
  const omegaRubber = omegaFor(CAMERA.rubberBandS);
  const omegaNudge = omegaFor(CAMERA.focusNudgeS);
  const [panLo, panHi] = g.pan;

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
  /** Dolly value when the overview took the camera X mid move: below it the X holds, above it the X eases to the bed. */
  let holdD = 1;
  let lastBx = ov.x;
  let lastBed: BedId | null = null;
  let lastFromX = NaN;
  let slots: readonly SlotView[] = [];
  let slotKnown = false;
  let snapNext = true;
  let shotPose: Pose | null = null;
  let shotGen = -1;
  const slotPt = new Float32Array(3);
  const bedSide: Pose = { x: ov.x, y: ov.y, z: ov.z, pitch: ov.pitch, fov: ov.fov };
  const fromSide: Pose = { x: ov.x, y: ov.y, z: ov.z, pitch: ov.pitch, fov: ov.fov };
  const rubber: SpringState = { x: 0, v: 0 };
  const nx: SpringState = { x: 0, v: 0 };
  const ny: SpringState = { x: 0, v: 0 };
  const nz: SpringState = { x: 0, v: 0 };
  const v3 = new Vector3();
  const o3 = new Vector3();

  const overviewActive = (): boolean => prevDollyTarget < 0.5;
  const viewWidthAtZoom = (z: number): number => 2 * (ov.z / z) * halfTan(ov.fov) * (width / height);

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

  function stepBedSide(s: State, leg: number): Pose | undefined {
    const target = s.bed === null ? undefined : bedPoses.get(s.bed);
    if (s.bed !== lastBed || s.fromX !== lastFromX) {
      copyPose(lastBed === null && target !== undefined ? target : bedSide, fromSide);
      lastBed = s.bed;
      lastFromX = s.fromX;
    }
    if (target === undefined) return undefined;
    bedSide.x = mix(s.fromX, target.x, leg);
    bedSide.y = mix(fromSide.y, target.y, leg);
    bedSide.z = mix(fromSide.z, target.z, leg);
    bedSide.pitch = mix(fromSide.pitch, target.pitch, leg);
    bedSide.fov = mix(fromSide.fov, target.fov, leg);
    return target;
  }

  function apply(): void {
    camera.position.set(pose.x, pose.y, pose.z);
    camera.rotation.set(pose.pitch, 0, 0);
    if (camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    changed = dirty || pose.x !== last.x || pose.y !== last.y || pose.z !== last.z || pose.pitch !== last.pitch || pose.fov !== last.fov;
    copyPose(pose, last);
    dirty = false;
  }

  function update(c: Clock, s: State, ch: Machine['ch']): void {
    const dt = c.dt;
    const snap = snapNext || (s.mode === 'herbario' && ch.mode.value >= 1);
    snapNext = false;
    if (slotWorld(slots, s.slot, slotPt)) slotKnown = true;

    const leg = ch.leg.value;
    const target = stepBedSide(s, leg);
    let d = target === undefined ? 0 : ch.dolly.value;
    if (target !== undefined && Math.abs(target.x - s.fromX) / spacing > 1.5) d *= 1 - FRAME.hopDip * Math.sin(Math.PI * leg);

    /** ARCH 2.1: heading for the overview, the pan takes the camera X wherever the dolly is (cut mid move or not). */
    const dTarget = ch.dolly.target;
    if (prevDollyTarget >= 0.5 && dTarget < 0.5) {
      panX = lastBx;
      panV = 0;
      holdD = d;
    }
    prevDollyTarget = dTarget;
    if (d <= 0 || d >= 0.999) holdD = 1;
    stepPan(dt, snap);
    stepZoom(dt, snap);

    const w = holdD >= 1 ? d : Math.max(0, (d - holdD) / (1 - holdD));
    const bx = mix(panX, bedSide.x, w);
    lastBx = bx;
    const by = mix(ov.y / zoom, bedSide.y, d);
    const bz = mix(ov.z / zoom, bedSide.z, d);
    const ft = slotKnown ? ch.focus.target : 0;
    const ox = bx + stepNudge(nx, (slotPt[0]! - bx) * FRAME.nudge * ft, snap, dt);
    const oy = by + stepNudge(ny, (slotPt[1]! - by) * FRAME.nudge * FRAME.nudgeY * ft, snap, dt);
    const oz = bz + stepNudge(nz, (slotPt[2]! - bz) * FRAME.nudge * ft, snap, dt);
    const p = slotKnown ? pushOf(ch.open.value) * FRAME.push : 0;

    if (shotPose !== null && shotGen < 0) shotGen = s.gen;
    if (shotPose !== null && s.gen !== shotGen) shotPose = null;
    if (shotPose !== null) {
      copyPose(shotPose, pose);
    } else {
      pose.x = mix(ox, slotPt[0]!, p);
      pose.y = mix(oy, slotPt[1]!, p * FRAME.nudgeY);
      pose.z = mix(oz, slotPt[2]!, p);
      pose.pitch = mix(ov.pitch, bedSide.pitch, d);
      pose.fov = mix(ov.fov, bedSide.fov, d);
    }
    apply();
  }

  function dropShot(): void {
    shotPose = null;
  }

  return {
    camera,
    pose,
    get changed() { return changed; },
    get width() { return width; },
    get height() { return height; },
    get panX() { return panX; },

    panBy(dxPx) {
      if (!overviewActive()) return;
      dropShot();
      dragging = true;
      panV = 0;
      let dx = (-dxPx * viewWidthAtZoom(zoom)) / width;
      const over = panX < panLo ? panLo - panX : panX > panHi ? panX - panHi : 0;
      const outward = (panX < panLo && dx < 0) || (panX > panHi && dx > 0);
      if (over > 0 && outward) dx *= Math.max(0, 1 - over / (CAMERA.rubberBandFraction * viewWidthAtZoom(zoom)));
      panX += dx;
    },
    fling(vxPxPerS) {
      dragging = false;
      if (!overviewActive()) return;
      dropShot();
      panV = (-vxPxPerS * viewWidthAtZoom(zoom)) / width;
    },
    zoomBy(k, atXPx) {
      if (!overviewActive()) return;
      dropShot();
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
    update,
    setShot(id: ShotId) {
      const shot = g.shots[id];
      snapNext = true;
      if (shot?.pose === undefined) return;
      shotPose = { x: shot.pose.x, y: shot.pose.y, z: shot.pose.z, pitch: shot.pose.pitch, fov: shot.pose.fov };
      shotGen = -1;
    },
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      dirty = true;
    },
    setBedPose(bed, p) {
      bedPoses.set(bed, { x: g.anchors[bed], y: p.y, z: p.z, pitch: p.pitch, fov: p.fov });
    },
    setSlots(v) {
      slots = v;
    },
    viewHeightAt(planeZ) {
      return 2 * Math.max(FRAME.near, pose.z - planeZ) * halfTan(pose.fov);
    },
  };
}
