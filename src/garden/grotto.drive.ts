import type { BedId } from '../types.ts';
import type { GardenRig } from '../world/camera.ts';
import { createGrottoCamera } from '../world/grotto.camera.ts';
import { GROTTO, GROTTO_ANNEX, inGrotto } from '../world/grotto.ts';
import type { Visitor } from '../world/roam.ts';

/**
 * Free roam in the grotto (world/grotto.ts): whether the visitor is in it, the walk in through the mouth that an
 * assisted walk to the grotto ends with (the assisted walk follows the garden path to the porch, then the visitor walks
 * in), and the grotto's camera pose handed to the rig as the grotto's pose, which world/camera.ts eases into while the
 * grotto is the bed. No allocation per frame.
 */

export const GRUTA: BedId = 'gruta';

export interface GrottoDrive {
  /** The visitor stands in the grotto (with hysteresis at the mouth). */
  readonly inside: boolean;
  /** An assisted walk to the grotto has yet to bring the visitor in: the bed must not follow the walk meanwhile. */
  readonly walkingIn: boolean;
  /** Where an assisted walk to the grotto lands before the walk in: the porch outside the mouth. */
  readonly porch: readonly [number, number];
  /** Starts the walk in once an assisted walk to the grotto lands at the porch. */
  landed(): void;
  /** An assisted walk began: into the grotto (its landing starts the walk in) or elsewhere. */
  expect(into: boolean): void;
  /** Stage 'input', after the visitor moved. */
  frame(): void;
  /** Stage 'camera': the grotto's camera on the visitor, handed to the rig. */
  follow(yaw: number, zoom: number, aspect: number, dt: number, snap: boolean): void;
  /** True when (x, z) lies on the grotto's floor, where a tap may walk the visitor. */
  floorAt(x: number, z: number): boolean;
}

export function createGrottoDrive(visitor: Visitor, rig: Pick<GardenRig, 'setBedPose'>): GrottoDrive {
  const pos = visitor.pos;
  const cam = createGrottoCamera();
  const porch = [GROTTO_ANNEX.door.x, GROTTO_ANNEX.porchZ] as const;
  let inside = inGrotto(pos[0]!, pos[1]!, false);
  let pending = false;
  let walkingIn = false;
  const rooms = GROTTO_ANNEX.rooms;
  return {
    get inside() {
      return inside;
    },
    get walkingIn() {
      return walkingIn;
    },
    porch,
    expect(into) {
      pending = into;
      walkingIn = into;
    },
    landed() {
      if (!pending) return;
      pending = false;
      visitor.walkTo(GROTTO.stand[0], GROTTO.stand[1]);
    },
    frame() {
      inside = inGrotto(pos[0]!, pos[1]!, inside);
      // Steering ended the assisted walk before it landed: no walk in.
      if (pending && !visitor.assisted) pending = false;
      if (walkingIn && (inside || (!pending && !visitor.busy))) walkingIn = false;
    },
    follow(yaw, zoom, aspect, dt, snap) {
      cam.step(pos[0]!, pos[1]!, yaw, zoom, aspect, dt, snap);
      rig.setBedPose(GRUTA, cam.pose);
    },
    floorAt(x, z) {
      for (let i = 0; i + 3 < rooms.length; i += 4) if (x >= rooms[i]! && z >= rooms[i + 1]! && x <= rooms[i + 2]! && z <= rooms[i + 3]!) return true;
      return false;
    },
  };
}
