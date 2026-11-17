/**
 * Estanque behaviour: the white peacock's pop-up fan (cook/ART.md section 3.3, MOTION B20). While the visitor stands at
 * the Estanque (its key, or anything nearer, as a project focus), 24 single plumes hinged at the rump rise and spread
 * in stepped poses on the 12 fps clock, staggered one pose per 4 plumes from the centre out; scrubbing away closes
 * them in fewer poses. A plume's rise is a rotation in depth, so its seen length is the sine of the rise angle (no
 * other scaling). The actor batch samples the hero page (scene.actorSprite): plumes first, then a copy of the body
 * and crest over their roots, so the fan grows from behind the bird. Frozen time and reduced motion show the end pose.
 */
import type { BedBehaviour, Clock, QuadParams, SpriteRect } from '../../types.ts';
import { PEACOCK, STEP_FPS } from '../../core/motion.ts';
import type { StreamBedCtx } from '../bed.ts';
import type { BedScene3 } from '../layout.ts';
import { QUAD_FLAG, packPhase } from '../quadflags.ts';

const DEG = Math.PI / 180;
const PLUMES = 24;
/** Pivot at the rump (ART.md 2.3 fan plumes), metres. */
const RUMP = { x: 20.0, y: 1.63, z: -3.47 } as const;
/** Plume length 1.7 to 2.0 m, alternating with the two warps. */
const LENGTH = [1.95, 1.75, 1.85, 1.7] as const;
/** Spread half-angle (degrees from upright) closed and open; rise angle (degrees from lying back) closed and open. */
const SPREAD = { closed: 15, open: 100 } as const;
const RISE = { closed: 10, open: 100 } as const;
const STAGGER_POSES = PLUMES / PEACOCK.featherStagger / 2;

export default function estanque(ctx: StreamBedCtx): BedBehaviour {
  const { actors, machine, scene, sprites } = ctx;
  const plumeA = sprites['es/plume-1'];
  const plumeB = sprites['es/plume-2'] ?? plumeA;
  const body: SpriteRect | undefined = sprites['es/peacock'];
  const crest: SpriteRect | undefined = sprites['es/peacock-crest'];
  if (plumeA === undefined || plumeB === undefined || body === undefined) return {};
  const items = (scene as BedScene3).layers.flatMap((l) => l.items);
  const bodyAt = items.find((it) => it.sprite === 'es/peacock');
  const crestAt = items.find((it) => it.sprite === 'es/peacock-crest');
  const bodyRect: SpriteRect = body;

  const tint = [1, 1, 1, 1];
  const q: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0.5, py: 0, uv: plumeA.uv, sway: 0, phase: 0, lift: 0, facing: 0, tint };
  const stillFlags = QUAD_FLAG.noLean | QUAD_FLAG.noShadow;
  const lastPose = PEACOCK.openPoses + STAGGER_POSES;
  let pose = 0;
  let shown = -1;
  let lastTick = -1;

  /** Plume i in fan order: rank 0 is the centre pair, outward from there; side alternates left and right. */
  function writePlume(i: number, k: number): void {
    const rect = i % 2 === 0 ? plumeA : plumeB;
    if (rect === undefined) return;
    const rank = Math.floor(i / 2);
    const side = i % 2 === 0 ? -1 : 1;
    const own = Math.min(1, Math.max(0, (k * lastPose - Math.floor(rank / PEACOCK.featherStagger)) / PEACOCK.openPoses));
    const reach = (rank + 0.5) / (PLUMES / 2);
    const spread = (SPREAD.closed + (SPREAD.open - SPREAD.closed) * own) * reach * side;
    const rise = (RISE.closed + (RISE.open - RISE.closed) * own) * DEG;
    const length = (LENGTH[i % LENGTH.length] ?? 1.8) * Math.max(0, Math.sin(rise)) * (own > 0 ? 1 : 0);
    const aspect = rect.size[1] / Math.max(1e-6, rect.size[0]);
    const towardTip = rect.pivot[0] > 0.5 ? Math.PI : 0;
    q.x = RUMP.x;
    q.y = RUMP.y;
    q.z = RUMP.z - rank * 1e-3;
    q.rot = (90 - spread) * DEG - towardTip;
    q.w = length;
    q.h = length * aspect;
    q.px = rect.pivot[0];
    q.py = rect.pivot[1];
    q.uv = rect.uv;
    q.facing = 6 * DEG;
    q.phase = packPhase(rank * 0.7, stillFlags);
  }

  function writeCopy(rect: SpriteRect, at: { x: number; y: number; z: number; h?: number; w?: number; hinge: number }): void {
    const aspect = rect.size[0] / Math.max(1e-6, rect.size[1]);
    const h = at.h ?? (at.w ?? rect.size[0]) / aspect;
    q.x = at.x;
    q.y = at.y;
    q.z = at.z + 0.01;
    q.rot = 0;
    q.h = h;
    q.w = h * aspect;
    q.px = rect.pivot[0];
    q.py = rect.pivot[1];
    q.uv = rect.uv;
    q.facing = -at.hinge * DEG;
    q.phase = packPhase(0, stillFlags);
  }

  function write(): void {
    const k = pose / lastPose;
    let n = 0;
    if (pose > 0) {
      for (let i = PLUMES - 1; i >= 0; i--) {
        writePlume(i, k);
        actors.set(n++, q);
      }
      if (bodyAt !== undefined) {
        writeCopy(bodyRect, bodyAt);
        actors.set(n++, q);
      }
      if (crest !== undefined && crestAt !== undefined) {
        writeCopy(crest, crestAt);
        q.rot = -10 * DEG * Math.min(1, k * 2);
        actors.set(n++, q);
      }
    }
    actors.count = n;
    actors.commit(0, n);
    shown = pose;
  }

  return {
    update(c: Clock) {
      const s = machine.state;
      const near = s.mode === 'garden' && s.bed === scene.id && s.phase !== 'travel';
      const target = near ? lastPose : 0;
      const tick = Math.floor(c.t * STEP_FPS);
      if (c.frozen || s.reduced) pose = target;
      else if (lastTick >= 0 && tick > lastTick) {
        const steps = tick - lastTick;
        const closeStep = Math.ceil(lastPose / PEACOCK.closePoses);
        pose = pose < target ? Math.min(target, pose + steps) : Math.max(target, pose - steps * closeStep);
      }
      lastTick = tick;
      if (pose !== shown) write();
    },
    dispose() {
      actors.count = 0;
    },
  };
}
