/**
 * The camera moment of a boss's first display (cook/PLAN_3D.md F5): the follow pose eases back, up and a little
 * toward the sky to frame the creature, then returns. It only offsets the pose the follow camera computed (like the
 * arrival glide), so walking and the orbit keep their say. One per page: the playing boss writes `amount`, the roam
 * drive shapes its pose with it. No allocation per frame.
 */
import type { RigPose } from './rail.ts';

export const BOSS_CAMERA = { backM: 2.2, upM: 1.1, pitchRad: 0.07 } as const;

export const bossCamera = {
  /** 0 at rest, 1 fully framed. */
  amount: 0,
  shape(pose: RigPose): void {
    const k = this.amount;
    if (k === 0) return;
    pose.y += BOSS_CAMERA.upM * k;
    pose.z += BOSS_CAMERA.backM * k;
    pose.pitch += BOSS_CAMERA.pitchRad * k;
  },
};
