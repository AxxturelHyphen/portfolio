/**
 * How far the approach eases in (APPROACH_FIT in core/motion.ts): the camera goes from the walking framing toward the
 * near one only as far as the focused subject's whole outline and the visitor's ground point stay inside a safe area
 * of the frame, clear of the top band of controls, the bottom band of cane labels and the plant tag beside the
 * subject, with a margin; the subject grows to at most `cap` of the frame height. Less than `minGain` times its
 * walking size is no gain: the camera stays on the walking framing. Tall or wide subjects, and phones where the tag
 * strip leaves no room, fall out of the same rule. Runs when the focus or the viewport changes, not every frame; no
 * allocation per call.
 */
import { APPROACH_FIT } from '../core/motion.ts';
import { DEG } from './layout.ts';
import { blendFraming, followPose, paramsFor, type Framing, type FramingParams, type ViewLimits } from './follow.ts';
import type { RigPose } from './rail.ts';

/**
 * A focused subject: its ground point (x, z), the height of its outline's foot and top and its width (m), the height
 * the plant tag anchors at and the slot's hit reach (m, half its larger hit side, as ui/label.ts keeps the tag clear).
 */
export interface Subject { x: number; z: number; y0: number; y1: number; w: number; tagY: number; reach: number }

/** The fit: how far toward the near framing (0..1), the camera's slide along x (m) and the subject's size gain. */
export interface Fit { k: number; shift: number; gain: number }

/** A point on screen as shares of the width (from the left) and height (from the top), and its depth (m). */
interface Screen { x: number; y: number; depth: number }

/** Projects (x, y, z) through a yaw 0 pose at aspect into out. */
function project(p: Readonly<RigPose>, aspect: number, x: number, y: number, z: number, out: Screen): Screen {
  const t = Math.tan((p.fov * DEG) / 2);
  const cp = Math.cos(p.pitch);
  const sp = Math.sin(p.pitch);
  const dx = x - p.x;
  const dy = y - p.y;
  const dz = z - p.z;
  out.depth = dy * sp - dz * cp;
  out.x = 0.5 + dx / (out.depth * 2 * t * aspect);
  out.y = 0.5 - (dy * cp + dz * sp) / (out.depth * 2 * t);
  return out;
}

export type Fitter = (s: Readonly<Subject>, vx: number, vz: number, wPx: number, hPx: number, out: Fit) => Fit;

export function createFitter(lim: ViewLimits): Fitter {
  const walk: FramingParams = { up: 0, downDeg: 0, fov: 0, moonAt: 0, at: 0 };
  const near: FramingParams = { up: 0, downDeg: 0, fov: 0, moonAt: 0, at: 0 };
  const mix: FramingParams = { up: 0, downDeg: 0, fov: 0, moonAt: 0, at: 0 };
  const framing: Framing = { up: 0, back: 0, pitch: 0, fov: 0, aspect: 1, moonAt: 0 };
  const pose: RigPose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, fov: 0 };
  const a: Screen = { x: 0, y: 0, depth: 0 };
  const b: Screen = { x: 0, y: 0, depth: 0 };
  const v: Screen = { x: 0, y: 0, depth: 0 };
  const tag: Screen = { x: 0, y: 0, depth: 0 };
  const F = APPROACH_FIT;

  /** The subject's height as a share of the frame for the pose in `pose`, or -1 when it does not fit the safe area. */
  function measure(s: Readonly<Subject>, vx: number, vz: number, wPx: number, hPx: number): number {
    const aspect = wPx / hPx;
    project(pose, aspect, s.x - s.w / 2, s.y1, s.z, a);
    project(pose, aspect, s.x + s.w / 2, s.y0, s.z, b);
    project(pose, aspect, vx, 0, vz, v);
    const height = b.y - a.y;
    const narrow = wPx < F.narrowPx;
    const top = F.topPx / hPx + F.margin;
    const bottom = (narrow ? 1 - (F.phoneTagPx + F.phoneCanePx + F.edgePx) / hPx : 1 - F.bottomShare) - F.margin;
    const lo = Math.min(a.x, v.x);
    const hi = Math.max(b.x, v.x);
    if (a.depth <= 0 || lo < F.margin || hi > 1 - F.margin || Math.min(a.y, v.y) < top || Math.max(b.y, v.y) > bottom) return -1;
    if (narrow) return height;
    // The desktop tag (ui/label.ts place()): beside the tag point, on the side with more room, kept inside the frame.
    project(pose, aspect, s.x, s.tagY, s.z, tag);
    const cw = Math.min(F.tagMaxPx, Math.max(F.tagMinPx, F.tagVw * wPx));
    const ch = cw * F.tagAspect;
    const px = tag.x * wPx;
    const clear = (s.reach * hPx) / (2 * Math.tan((pose.fov * DEG) / 2) * tag.depth) + F.gapPx;
    const roomRight = wPx - F.edgePx - (px + clear);
    const roomLeft = px - clear - F.edgePx;
    let right = tag.x <= 0.6;
    if (right && roomRight < cw && roomLeft > roomRight) right = false;
    else if (!right && roomLeft < cw && roomRight > roomLeft) right = true;
    const x0 = Math.min(wPx - F.edgePx - cw, Math.max(F.edgePx, right ? px + clear : px - clear - cw)) / wPx;
    const y0 = Math.min(hPx - F.edgePx - ch, Math.max(F.topPx, tag.y * hPx - ch / 2)) / hPx;
    const x1 = x0 + cw / wPx;
    const y1 = y0 + ch / hPx;
    const subjectUnder = a.x < x1 && b.x > x0 && a.y < y1 && b.y > y0;
    const visitorUnder = v.x > x0 && v.x < x1 && v.y > y0 && v.y < y1;
    return subjectUnder || visitorUnder ? -1 : height;
  }

  /** The largest fitting height sliding the camera `shift` m, or 0; writes k into out when it beats `best`. */
  function search(s: Readonly<Subject>, vx: number, vz: number, wPx: number, hPx: number, shift: number, best: number, out: Fit): number {
    const aspect = wPx / hPx;
    for (let i = F.steps; i > 0; i--) {
      const k = i / F.steps;
      followPose(vx, vz, blendFraming(aspect, k, walk, near, mix, framing), lim, pose, vx + shift * k);
      nudge(s);
      const h = measure(s, vx, vz, wPx, hPx);
      if (h < 0 || h > F.cap) continue;
      if (h <= best) return best;
      out.k = k;
      out.shift = shift;
      return h;
    }
    return best;
  }

  /** The rig nudges a focused camera toward the slot (world/camera.ts): the fit measures the nudged pose. */
  function nudge(s: Readonly<Subject>): void {
    pose.x += (s.x - pose.x) * F.nudge;
    pose.y += (s.tagY - pose.y) * F.nudge * F.nudgeY;
    pose.z += (s.z - pose.z) * F.nudge;
  }

  return (s, vx, vz, wPx, hPx, out) => {
    const aspect = Math.max(1, wPx) / Math.max(1, hPx);
    paramsFor(aspect, false, walk);
    paramsFor(aspect, true, near);
    followPose(vx, vz, blendFraming(aspect, 0, walk, near, mix, framing), lim, pose);
    nudge(s);
    project(pose, aspect, s.x, s.y1, s.z, a);
    project(pose, aspect, s.x, s.y0, s.z, b);
    const base = b.y - a.y;
    const toward = Math.max(-F.maxShiftM, Math.min(F.maxShiftM, s.x - vx));
    out.k = 0;
    out.shift = 0;
    out.gain = 1;
    const w = Math.max(1, wPx);
    const h = Math.max(1, hPx);
    const best = search(s, vx, vz, w, h, toward, search(s, vx, vz, w, h, 0, 0, out), out);
    if (base <= 0 || best / base < F.minGain) {
      out.k = 0;
      out.shift = 0;
      return out;
    }
    out.gain = best / base;
    return out;
  };
}
