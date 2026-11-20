/**
 * Estanque behaviour: the white peacock's pop-up fan (cook/ART.md section 3.3, MOTION B20). While the visitor stands at
 * the Estanque (its key, or anything nearer, as a project focus), 24 single plumes hinged at the rump rise and spread
 * in stepped poses on the 12 fps clock, staggered one pose per 4 plumes from the centre out; scrubbing away closes
 * them in fewer poses. A plume's rise is a rotation in depth, so its seen length is the sine of the rise angle (no
 * other scaling). The actor batch samples the hero page (scene.actorSprite): plumes first, then a copy of the body
 * and crest over their roots, so the fan grows from behind the bird. Frozen time and reduced motion show the end pose.
 * Under free roam the bird is also the Estanque's archive boss (world/boss.ts, content/bosses/peacock.json): its first
 * display of the visit grows it to the boss's monumental height, opens the fan on the boss's timeline and turns it
 * slowly toward the visitor's camera; from then on it stays monumental (the bed hides its own small copy).
 */
import type { BedBehaviour, Clock, QuadParams, SpriteRect } from '../../types.ts';
import { PEACOCK, STEP_FPS } from '../../core/motion.ts';
import type { StreamBedCtx } from '../bed.ts';
import type { BedScene3 } from '../layout.ts';
import { builtIn } from '../mode.ts';
import { QUAD_FLAG, packPhase } from '../quadflags.ts';

const DEG = Math.PI / 180;
const PLUMES = 24;
/** Pivot at the rump (ART.md 2.3 fan plumes), from the body's foot: its height share and a step back, metres. */
const RUMP = { up: 1.58 / 2.4, back: 0.07 } as const;
/** The body height the plume lengths are drawn for; a smaller bird gets a smaller fan. */
const BODY_H = 2.4;
/** Plume length 1.7 to 2.0 m at BODY_H, alternating with the two warps. */
const LENGTH = [1.95, 1.75, 1.85, 1.7] as const;
/** Spread half-angle (degrees from upright) closed and open; rise angle (degrees from lying back) closed and open. */
const SPREAD = { closed: 15, open: 100 } as const;
const RISE = { closed: 10, open: 100 } as const;
const STAGGER_POSES = PLUMES / PEACOCK.featherStagger / 2;
/** The boss's turn toward the camera, at most this far from the bird's own hinge (radians). */
const TURN_MAX = 35 * DEG;

export default function estanque(ctx: StreamBedCtx): BedBehaviour {
  const { actors, machine, scene, sprites, boss, rig } = ctx;
  const plumeA = sprites['es/plume-1'];
  const plumeB = sprites['es/plume-2'] ?? plumeA;
  const body: SpriteRect | undefined = sprites['es/peacock'];
  const crest: SpriteRect | undefined = sprites['es/peacock-crest'];
  if (plumeA === undefined || plumeB === undefined || body === undefined) return {};
  const items = (scene as BedScene3).layers.flatMap((l) => l.items).filter((it) => builtIn(it, ctx.mode));
  const bodyAt = items.find((it) => it.sprite === 'es/peacock');
  const crestAt = items.find((it) => it.sprite === 'es/peacock-crest');
  const bodyRect: SpriteRect = body;
  const bodyH = bodyAt?.h ?? BODY_H;
  const foot = { x: bodyAt?.x ?? 20, y: bodyAt?.y ?? 0, z: bodyAt?.z ?? -3.4 };
  const rump = { x: foot.x, y: foot.y + RUMP.up * bodyH, z: foot.z - RUMP.back };
  const hinge = -(bodyAt?.hinge ?? 0) * DEG;
  const grownH = boss === null ? bodyH : boss.def.scale;
  /** The bird's height now, its share of the drawn height, and its turn (radians added to every facing). */
  let size = bodyH;
  let fanScale = bodyH / BODY_H;
  let turn = 0;
  let hidden = false;
  const bodyNow = { x: foot.x, y: foot.y, z: foot.z, h: bodyH, hinge: bodyAt?.hinge ?? 0 };
  const crestNow = { x: 0, y: 0, z: 0, w: 0, hinge: crestAt?.hinge ?? 0 };

  // The bird's own tint (free roam dusks the white plate), shared by the plumes so fan and body stay one paper.
  const tint = [...(bodyAt?.tint ?? [1, 1, 1]), 1];
  const q: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0.5, py: 0, uv: plumeA.uv, sway: 0, phase: 0, lift: 0, facing: 0, tint };
  const stillFlags = QUAD_FLAG.noLean | QUAD_FLAG.noShadow;
  const lastPose = PEACOCK.openPoses + STAGGER_POSES;
  let pose = 0;
  let shown = -1;
  let lastTick = -1;
  let version = 0;

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
    const length = (LENGTH[i % LENGTH.length] ?? 1.8) * fanScale * Math.max(0, Math.sin(rise)) * (own > 0 ? 1 : 0);
    const aspect = rect.size[1] / Math.max(1e-6, rect.size[0]);
    const towardTip = rect.pivot[0] > 0.5 ? Math.PI : 0;
    q.x = rump.x;
    q.y = rump.y;
    q.z = rump.z - rank * 1e-3;
    q.rot = (90 - spread) * DEG - towardTip;
    q.w = length;
    q.h = length * aspect;
    q.px = rect.pivot[0];
    q.py = rect.pivot[1];
    q.uv = rect.uv;
    q.facing = 6 * DEG + turn;
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
    q.facing = -at.hinge * DEG + turn;
    q.phase = packPhase(0, stillFlags);
  }

  /** The boss's size and turn now: grown from the bird's height to the boss's, turned toward the camera. */
  function grow(): void {
    if (boss === null) return;
    const p = boss.run.pose;
    size = bodyH + (grownH - bodyH) * p.grow;
    fanScale = size / BODY_H;
    rump.y = foot.y + RUMP.up * size;
    const toward = Math.atan2(rig.pose.x - foot.x, rig.pose.z - foot.z) - hinge;
    turn = p.turn * Math.max(-TURN_MAX, Math.min(TURN_MAX, toward));
    const k = size / bodyH;
    bodyNow.h = size;
    if (crestAt !== undefined) {
      crestNow.x = foot.x + (crestAt.x - foot.x) * k;
      crestNow.y = foot.y + (crestAt.y - foot.y) * k;
      crestNow.z = crestAt.z;
      crestNow.w = (crestAt.w ?? 0.16) * k;
    }
    const grown = size > bodyH + 1e-3;
    if (grown !== hidden) boss.own(grown);
    hidden = grown;
  }

  function write(): void {
    grow();
    const k = pose / lastPose;
    let n = 0;
    if (pose > 0 || hidden) {
      for (let i = PLUMES - 1; i >= 0; i--) {
        writePlume(i, k);
        actors.set(n++, q);
      }
      if (bodyAt !== undefined) {
        writeCopy(bodyRect, hidden ? bodyNow : bodyAt);
        actors.set(n++, q);
      }
      if (crest !== undefined && crestAt !== undefined) {
        writeCopy(crest, hidden ? crestNow : crestAt);
        q.rot = -10 * DEG * Math.min(1, k * 2);
        actors.set(n++, q);
      }
    }
    actors.count = n;
    actors.commit(0, n);
    shown = pose;
    version = boss?.run.version ?? 0;
  }

  return {
    update(c: Clock) {
      const s = machine.state;
      const near = s.mode === 'garden' && s.bed === scene.id && s.phase !== 'travel';
      const target = near ? lastPose : 0;
      const tick = Math.floor(c.t * STEP_FPS);
      if (boss !== null && boss.run.phase === 'play') pose = Math.round(boss.run.pose.display * lastPose);
      else if (c.frozen || s.reduced) pose = target;
      else if (lastTick >= 0 && tick > lastTick) {
        const steps = tick - lastTick;
        const closeStep = Math.ceil(lastPose / PEACOCK.closePoses);
        pose = pose < target ? Math.min(target, pose + steps) : Math.max(target, pose - steps * closeStep);
      }
      lastTick = tick;
      if (pose !== shown || (boss !== null && boss.run.version !== version)) write();
    },
    dispose() {
      actors.count = 0;
    },
  };
}
