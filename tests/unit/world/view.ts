import { PerspectiveCamera, Vector3 } from 'three';
import type { RigPose } from '../../../src/world/rail.ts';
import { traceLayout } from './rig.trace.ts';

// What a follow camera pose shows of the closed garden: shared by the enclosure and near framing specs.

const ground = traceLayout.ground;
const enc = ground.enclosure;
const DEG = Math.PI / 180;
/** The clamp samples the frame's side edge: its sky angle holds to this much (degrees). */
const SAMPLED_DEG = 0.1;
export const blankPose = (): RigPose => ({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0, fov: 0 });

export function cameraOf(p: RigPose, aspect: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(p.fov, aspect, 0.05, 400);
  cam.rotation.order = 'YXZ';
  cam.position.set(p.x, p.y, p.z);
  cam.rotation.set(p.pitch, -p.yaw, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

/**
 * What one view ray shows inside the closed garden model: null when it meets the garden's ground, a wall, the kerb or
 * sky (over the back wall, or over an end wall no steeper than sideSkyDeg below the horizon); otherwise what of the
 * outside it shows. The ground plane under free roam ends just past the walls, so a ray over a wall meets sky.
 */
export function outsideSeen(o: Vector3, d: Vector3, sideSkyDeg: number): string | null {
  const [x0, x1] = enc.x;
  const depression = Math.atan2(-d.y, Math.hypot(d.x, d.z)) / DEG;
  let t0 = 0;
  if (o.z > enc.front && d.z < 0) {
    t0 = (enc.front - o.z) / d.z;
    const y = o.y + d.y * t0;
    const x = o.x + d.x * t0;
    if (y <= 0) return 'ground south of the kerb';
    if (x < x0 - 1e-6 || x > x1 + 1e-6) return y < enc.endH || depression > sideSkyDeg + SAMPLED_DEG ? 'past a front corner' : null;
    if (y < enc.kerbH) return null;
  }
  const toGround = d.y < 0 ? -o.y / d.y : Infinity;
  const toBack = d.z < 0 ? (ground.wall.z - o.z) / d.z : Infinity;
  const toSide = d.x < 0 ? (x0 - o.x) / d.x : d.x > 0 ? (x1 - o.x) / d.x : Infinity;
  const t = Math.min(toGround, toBack, toSide);
  if (t < t0 || t !== toSide) return null;
  const y = o.y + d.y * t;
  return y < enc.endH || depression <= sideSkyDeg + SAMPLED_DEG ? null : `sky over an end wall ${depression.toFixed(1)} deg down`;
}

/** Every outside view a pose shows, sampled on a 33 by 19 grid of rays across the frame. */
export function outsideIn(p: RigPose, aspect: number, sideSkyDeg: number): string[] {
  const cam = cameraOf(p, aspect);
  const seen: string[] = [];
  for (let i = 0; i <= 32; i++) {
    for (let j = 0; j <= 18; j++) {
      const d = new Vector3(-1 + i / 16, -1 + j / 9, 0.5).unproject(cam).sub(cam.position);
      const what = outsideSeen(cam.position, d, sideSkyDeg);
      if (what !== null) seen.push(what);
    }
  }
  return seen;
}
