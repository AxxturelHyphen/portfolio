import type { BedId, Pose } from '../types.ts';
import { DEG, type FilmPose, type RailData, type RailKey } from './layout.ts';

/**
 * The raised camera rail of cook/ART.md section 1: one continuous camera keyed on its x. Every pose component is
 * smoothstep-interpolated between the two neighbouring keys, so a walk along x is one smooth crane with no corners.
 * Output pitch and yaw are radians, fov vertical degrees (as the rig and gl take them).
 */

export interface RigPose extends Pose { yaw: number }

export interface Rail {
  /** Camera x of the bed's stop, or NaN when the bed has no key on the rail (the grotto). */
  stopX(bed: BedId): number;
  /** Writes the rail pose at x into out (portrait when set). */
  sample(x: number, out: RigPose): RigPose;
  /** Replaces a bed key's height, distance, pitch (radians) and fov (the composition root widens fov on resize). */
  setKey(bed: BedId, p: Pose): void;
  setPortrait(on: boolean): void;
  readonly minX: number;
  readonly maxX: number;
}

const smooth = (k: number): number => k * k * (3 - 2 * k);
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

export function filmPose(f: FilmPose, out: RigPose): RigPose {
  out.x = f.x;
  out.y = f.y;
  out.z = f.z;
  out.pitch = f.pitch * DEG;
  out.yaw = f.yaw * DEG;
  out.fov = f.fov;
  return out;
}

export function createRail(data: RailData): Rail {
  const keys: RailKey[] = data.keys.map((k) => ({ ...k })).sort((a, b) => a.x - b.x);
  if (keys.length < 2) throw new Error('rail: needs at least two keys');
  const first = keys[0] as RailKey;
  const last = keys[keys.length - 1] as RailKey;
  const pt = data.portrait;
  let portrait = false;

  return {
    minX: first.x,
    maxX: last.x,
    stopX(bed) {
      for (let i = 0; i < keys.length; i++) if (keys[i]?.bed === bed) return keys[i]!.x;
      return NaN;
    },
    sample(x, out) {
      let i = 0;
      while (i < keys.length - 2 && x > keys[i + 1]!.x) i++;
      const a = keys[i] as RailKey;
      const b = keys[i + 1] as RailKey;
      const k = smooth(Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x))));
      out.x = x;
      if (portrait) {
        out.y = pt.y;
        out.z = mix(a.z, b.z, k) + pt.dz;
        out.pitch = pt.pitch * DEG;
        out.yaw = 0;
        out.fov = pt.fov;
        return out;
      }
      out.y = mix(a.y, b.y, k);
      out.z = mix(a.z, b.z, k);
      out.pitch = mix(a.pitch, b.pitch, k) * DEG;
      out.yaw = mix(a.yaw, b.yaw, k) * DEG;
      out.fov = mix(a.fov, b.fov, k);
      return out;
    },
    setKey(bed, p) {
      const key = keys.find((k) => k.bed === bed);
      if (key === undefined) return;
      key.y = p.y;
      key.z = p.z;
      key.pitch = p.pitch / DEG;
      key.fov = p.fov;
    },
    setPortrait(on) {
      portrait = on;
    },
  };
}
