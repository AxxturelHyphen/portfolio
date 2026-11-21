import { BoxGeometry, ConeGeometry, InstancedMesh, Matrix4 } from 'three';
import type { Material } from 'three';
import { terrainY } from '../core/terrain.ts';
import { BOARD, type SignSpot } from '../world/signboard.ts';
import { hash01 } from '../world/wall.ts';
import { SolidBuilder } from './masonry.ts';
import type { SolidPaint } from './solid.paint.ts';

/**
 * Free roam's signposts in real timber (world/signboard.ts lays them out): each post a square, slightly irregular
 * timber with a pointed cap, the arm a beam out the way the sign points with a diagonal brace under it, all merged into
 * the props' wood (gl/props.ts); and each plank's wooden body, a board with thickness hung just behind its painted face
 * card at the painted tilt, one instance per sign, turned on its hook with the face card when the sign sways. The face
 * card, the small lantern and their pools stay cards (gl/signboards.ts). Load time, apart from swing (no allocation).
 */

/** Post sink into the ground, its cap's height; the brace's square section; the timbers' irregularity (m, radians). */
const TIMBER = { sink: 0.1, cap: 0.05, brace: 0.05, widthJitter: 0.012, yawJitter: 0.035 } as const;
/** The board's body: its inset from the painted board's cut edge, thickness and gap behind the face card (m). */
const BODY = { inset: 0.025, depth: 0.032, gap: 0.006 } as const;

const m = new Matrix4();
const r = new Matrix4();

/** Every sign's post, arm and brace into the wood builder. */
export function signWood(b: SolidBuilder, spots: readonly SignSpot[]): void {
  const box = new BoxGeometry(1, 1, 1);
  const post = BOARD.post;
  const arm = BOARD.arm;
  spots.forEach((s, i) => {
    const ground = terrainY(s.x, s.z);
    const w = post.w * 0.8 + TIMBER.widthJitter * (hash01(i, 0x71) - 0.5) * 2;
    const yaw = TIMBER.yawJitter * (hash01(i, 0x13) - 0.5) * 2;
    b.box(s.x, ground - TIMBER.sink, s.z, w, post.h + TIMBER.sink, w * (0.94 + 0.08 * hash01(i, 0x29)), yaw);
    const cap = new ConeGeometry((w / 2) * Math.SQRT2, TIMBER.cap, 4, 1).toNonIndexed();
    cap.computeVertexNormals();
    b.merge(cap, m.makeRotationY(Math.PI / 4 + yaw).setPosition(s.x, ground + post.h + TIMBER.cap / 2, s.z));
    cap.dispose();
    // The arm's beam from just behind the post out past the lantern's hook; its middle is where the board hangs from.
    const back = arm.from - w / 2;
    const len = arm.to - back;
    b.box(s.x + s.dir * (back + len / 2), ground + arm.under, s.z, len, arm.beam, arm.beam * (0.9 + 0.2 * hash01(i, 0x55)), 0.01 * s.dir);
    // The brace runs from the post's face, (arm.h - beam) under the beam, up to the beam's underside.
    const drop = arm.h - arm.beam;
    const x0 = w / 2;
    const x1 = w / 2 + drop * 1.4;
    const along = Math.hypot(x1 - x0, drop);
    m.makeScale(along + TIMBER.brace, TIMBER.brace, TIMBER.brace);
    r.makeRotationZ(s.dir * Math.atan2(drop, x1 - x0));
    m.premultiply(r).setPosition(s.x + s.dir * (x0 + x1) / 2, ground + arm.under - drop / 2, s.z);
    b.merge(box, m);
  });
  box.dispose();
}

export interface SignBoards {
  readonly mesh: InstancedMesh;
  /** Turns sign i's board on its hook by `rot` (radians, as the face card's rot), `open` of its height hung below the
   * hook (0 folded away into the arm). No allocation. */
  swing(i: number, rot: number, open: number): void;
}

/**
 * One instanced board body per sign under `paint`, drawn with the instanced solid material, hung at rest; `tilts[i]` is
 * sign i's painted tilt (radians, clockwise).
 */
export function createSignBoards(spots: readonly SignSpot[], tilts: readonly number[], paint: SolidPaint, material: Material, order: number): SignBoards {
  const unit = new SolidBuilder().paint(paint);
  unit.box(0, -0.5, 0, 1, 1, 1, 0);
  const mesh = new InstancedMesh(unit.geometry(), material, Math.max(1, spots.length));
  mesh.count = spots.length;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = order;
  const plank = BOARD.plank;
  const toCentre = new Matrix4().makeTranslation(0, -(plank.bridle + plank.h / 2), 0);
  const size = new Matrix4().makeScale(plank.w - 2 * BODY.inset, plank.h - 2 * BODY.inset, BODY.depth);
  const hooks = spots.map((s) => {
    const x = s.x + s.dir * plank.hookAt;
    const z = s.z + BOARD.front.plank;
    return new Matrix4().makeTranslation(x, BOARD.arm.under + terrainY(x, z), z - BODY.gap - BODY.depth / 2);
  });
  const tilt = spots.map((_, i) => new Matrix4().makeRotationZ(-(tilts[i] ?? 0)).multiply(size));
  const swing = (i: number, rot: number, open: number): void => {
    const hook = hooks[i];
    const body = tilt[i];
    if (hook === undefined || body === undefined) return;
    m.copy(hook).multiply(r.makeRotationZ(rot)).multiply(r.makeScale(1, open, 1)).multiply(toCentre).multiply(body);
    mesh.setMatrixAt(i, m);
    mesh.instanceMatrix.needsUpdate = true;
  };
  spots.forEach((_, i) => swing(i, 0, 1));
  return { mesh, swing };
}
