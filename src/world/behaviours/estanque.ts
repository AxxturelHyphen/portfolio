/**
 * Estanque behaviour: the white peacock's pop-up fan (cook/ART.md section 3.3, MOTION B20). While the visitor stands at
 * the Estanque (its key, or anything nearer, as a project focus), 24 single plumes hinged at the rump rise and spread
 * smoothly at 12 poses a second, staggered one pose per 4 plumes from the centre out; scrubbing away closes
 * them in fewer poses. A plume's rise is a rotation in depth, so its seen length is the sine of the rise angle (no
 * other scaling). The actor batch samples the hero page (scene.actorSprite): plumes first, then a copy of the body
 * and crest over their roots, so the fan grows from behind the bird. Frozen time and reduced motion show the end pose.
 * Under free roam the bird is also the Estanque's archive boss (world/boss.ts, content/bosses/peacock.json): its first
 * display of the visit brings it to the boss's height, opens the fan on the boss's timeline and turns it slowly toward
 * the visitor's camera; from then on the boss draws the bird (the bed hides its own copy). On the garden wall the fan
 * spreads about three body widths and stays under the coping, and the plumes' tint pales from the rim to the centre,
 * so the pencil lines read as feathers rather than one flat colour. Under free roam the bird's upright neck and head
 * (world/peacock.head.ts) is placed with it on every write, at the size, foot and turn of the body drawn then.
 */
import type { BedBehaviour, Clock, QuadParams, SpriteRect } from '../../types.ts';
import { PEACOCK, STEP_FPS } from '../../core/motion.ts';
import type { StreamBedCtx } from '../bed.ts';
import type { BedScene3 } from '../layout.ts';
import { builtIn } from '../mode.ts';
import { peacockHead } from '../peacock.head.ts';
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
/** Under free roam the bird rests before the garden wall: a fan about three body widths across, under the coping. */
const ROAM_FAN = 1.25;
/** The outermost plumes keep this share of the bird's tint; the centre pair the whole of it. */
const RIM_SHADE = 0.82;

export default function estanque(ctx: StreamBedCtx): BedBehaviour {
  const { actors, machine, scene, sprites, boss, rig, setReflector } = ctx;
  const plumeA = sprites['es/plume-1'];
  const plumeB = sprites['es/plume-2'] ?? plumeA;
  const body: SpriteRect | undefined = sprites['es/peacock'];
  const crest: SpriteRect | undefined = sprites['es/peacock-crest'];
  if (plumeA === undefined || plumeB === undefined || body === undefined) return {};
  const items = (scene as BedScene3).layers.flatMap((l) => l.items).filter((it) => builtIn(it, ctx.mode));
  const bodyAt = items.find((it) => it.sprite === 'es/peacock');
  const crestAt = items.find((it) => it.sprite === 'es/peacock-crest');
  /** The bird's reflector in the water (garden/place.ts pondOf lists the reflecting items in this order), or -1. */
  const mirror = items.filter((it) => it.reflect).findIndex((it) => it === bodyAt);
  const mirrorW = bodyAt?.reflect?.w ?? 0;
  const bodyRect: SpriteRect = body;
  const bodyH = bodyAt?.h ?? BODY_H;
  const foot = { x: bodyAt?.x ?? 20, y: bodyAt?.y ?? 0, z: bodyAt?.z ?? -3.4 };
  const rump = { x: foot.x, y: foot.y + RUMP.up * bodyH, z: foot.z - RUMP.back };
  const hinge = -(bodyAt?.hinge ?? 0) * DEG;
  /** The bird's height now, its share of the drawn height, and its turn (radians added to every facing). */
  let size = bodyH;
  const fan = ctx.mode === 'roam' ? ROAM_FAN / BODY_H : 1 / BODY_H;
  let fanScale = bodyH * fan;
  let turn = 0;
  let hidden = false;
  const bodyNow = { x: foot.x, y: foot.y, z: foot.z, h: bodyH, hinge: bodyAt?.hinge ?? 0 };
  const crestNow = { x: 0, y: 0, z: 0, w: 0, hinge: crestAt?.hinge ?? 0 };

  // The bird's own tint (free roam dusks the white plate; the boss file's when it is the boss), shared by the plumes so
  // fan and body stay one paper.
  const plateTint = bodyAt?.tint ?? [1, 1, 1];
  const tint = boss?.def.tint ?? [...plateTint, 1];
  const plumeTint = new Float32Array(4);
  const q: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0.5, py: 0, uv: plumeA.uv, sway: 0, phase: 0, lift: 0, facing: 0, tint };
  const stillFlags = QUAD_FLAG.noLean | QUAD_FLAG.noShadow;
  const lastPose = PEACOCK.openPoses + STAGGER_POSES;
  let pose = 0;
  let shown = -1;
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
    const shade = 1 - (1 - RIM_SHADE) * reach * (side > 0 ? 1 : 0.8);
    for (let c = 0; c < 3; c++) plumeTint[c] = (tint[c] ?? 1) * shade;
    plumeTint[3] = tint[3] ?? 1;
    q.tint = plumeTint;
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
    q.tint = tint;
  }

  /** The boss's size and turn now: from the bird's height to the boss's, turned toward the camera. */
  function grow(): void {
    if (boss === null) return;
    const p = boss.run.pose;
    size = bodyH + (boss.def.scale - bodyH) * p.grow;
    fanScale = size * fan;
    rump.y = foot.y + RUMP.up * size;
    const toward = Math.atan2(rig.pose.x - foot.x, rig.pose.z - foot.z) - hinge;
    turn = p.turn * Math.max(-TURN_MAX, Math.min(TURN_MAX, toward));
    const k = size / bodyH;
    bodyNow.h = size;
    setReflector(mirror, size, mirrorW * k);
    if (crestAt !== undefined) {
      crestNow.x = foot.x + (crestAt.x - foot.x) * k;
      crestNow.y = foot.y + (crestAt.y - foot.y) * k;
      crestNow.z = crestAt.z;
      crestNow.w = (crestAt.w ?? 0.16) * k;
    }
    const drawn = boss.run.phase !== 'wait';
    if (drawn !== hidden) boss.own(drawn);
    hidden = drawn;
  }

  /** The head on the body drawn now: the boss's copy once it shows, else the bed's own plate. */
  function placeHead(): void {
    peacockHead.draw?.(foot.x, foot.y, foot.z, size, hinge + turn, hidden ? tint : plateTint);
  }

  function write(): void {
    grow();
    placeHead();
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

  placeHead();
  return {
    update(c: Clock) {
      const s = machine.state;
      const near = s.mode === 'garden' && s.bed === scene.id && s.phase !== 'travel';
      const target = near ? lastPose : 0;
      if (boss?.run.phase === 'play') pose = boss.run.pose.display * lastPose;
      else if (c.frozen || s.reduced) pose = target;
      // A first visit holds the fan shut until the boss opens it on its own timeline.
      else if (boss?.run.phase === 'wait') pose = 0;
      else {
        const steps = Math.min(c.dt, 0.1) * STEP_FPS;
        const closeStep = Math.ceil(lastPose / PEACOCK.closePoses);
        pose = pose < target ? Math.min(target, pose + steps) : Math.max(target, pose - steps * closeStep);
      }
      if (pose !== shown || (boss !== null && boss.run.version !== version)) write();
    },
    dispose() {
      actors.count = 0;
      peacockHead.draw?.(0, 0, 0, 0, 0, tint);
    },
  };
}
