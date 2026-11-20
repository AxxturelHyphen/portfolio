/**
 * The archive bosses (cook/PLAN_3D.md F5): giant paper puppets cut from natural-history plates, one per bed, from
 * content/bosses/<id>.json (checked at build by world/boss.schema.ts; the browser only casts). Parts are hinged cutout
 * quads: each hangs from its parent's pivot by an offset in the parent's frame (metres, scaled with the parent's seen
 * size), turns by its rest hinge plus the motion's angle (degrees, counter-clockwise as seen from the front), and the
 * root stands at `at`; the chain is solved on the stepped 12 fps clock. The first time per visit the visitor settles in
 * the boss's bed it plays its motion once (any key, click or tap lands the end pose) with a camera moment
 * (world/boss.camera.ts), then rests in its idle loop. Reduced motion and frozen time land the end pose with no camera
 * moment; the low tier shows the end pose, still. A boss whose sprites the atlas lacks is quietly left out.
 */
import { LessEqualDepth, type Material } from 'three';
import type { BedId, Clock, CutoutBatch, InstanceWriter, Machine, QuadParams, SpriteId, SpriteRect } from '../types.ts';
import { channelsSettled } from '../core/loop.ts';
import { STEP_FPS } from '../core/motion.ts';
import { bossCamera } from './boss.camera.ts';
import { MOTIONS, clamp01, createPose, type BossPose, type Motion } from './boss.motions.ts';
import { QUAD_FLAG, packPhase } from './quadflags.ts';

export interface BossPart { role: string; sprite: SpriteId; parent: string | null; pivot: [number, number]; offset: [number, number]; z: number; rest: number }
/** tint: the plates' night colour (rgb multiplier, opacity; a luma under 0.75 reads as a shaded layer), white if absent. */
export interface BossDef { id: string; bed: BedId; at: [number, number, number]; scale: number; tint?: [number, number, number, number]; parts: BossPart[]; motion: string }
export type BossPhase = 'wait' | 'play' | 'idle';

export const BOSS = {
  /** Seconds the visitor stays settled in the bed before the boss plays. */
  settleS: 0.6,
  /** The camera moment eases in over inS, out over the play's last outS, and back over backS after a skip. */
  inS: 0.9,
  outS: 1.1,
  backS: 0.7,
  /** Paint order step between parts (metres toward the eye). */
  zStep: 0.004,
} as const;

const DEG = Math.PI / 180;

/** The bosses that have played in this visit: page state, so a bed streamed out and back does not play again. */
const PLAYED = new Set<string>();

export interface BossRun {
  readonly phase: BossPhase;
  readonly pose: BossPose;
  /** Bumped whenever the stepped pose changes. */
  readonly version: number;
  /** The camera moment's share, 0 to 1 (continuous, not stepped). */
  readonly moment: number;
  readonly busy: boolean;
  /** One frame: `here` the visitor is settled in the bed, `still` reduced motion or frozen time. */
  step(c: Clock, here: boolean, still: boolean): void;
  /** Lands the end pose at once. */
  skip(): void;
}

export interface RunOptions { id: string; motion: Motion; /** The low tier: end pose, no motion. */ fixed: boolean; played?: Set<string> }

export function createBossRun(o: RunOptions): BossRun {
  const { motion } = o;
  const played = o.played ?? PLAYED;
  const pose = createPose(motion.roles);
  let phase: BossPhase = o.fixed || played.has(o.id) ? 'idle' : 'wait';
  let settled = 0;
  let from = 0;
  let shown = -1;
  let version = 0;
  let moment = 0;
  let skipped = false;
  let still = o.fixed;
  if (phase === 'idle') motion.idle(pose, 0);
  else motion.play(pose, 0);

  function rest(tick: number): void {
    phase = 'idle';
    from = tick;
    shown = -1;
  }

  return {
    get phase() { return phase; },
    pose,
    get version() { return version; },
    get moment() { return moment; },
    get busy() { return phase === 'play' || moment > 0; },
    skip() {
      if (phase === 'play') skipped = true;
    },
    step(c, here, stillNow) {
      const tick = Math.floor(c.t * STEP_FPS);
      still = o.fixed || stillNow;
      if (phase === 'wait') {
        settled = here ? settled + c.dt : 0;
        if (here && (still || settled >= BOSS.settleS)) {
          played.add(o.id);
          if (still) rest(tick);
          else {
            phase = 'play';
            from = tick;
            shown = -1;
          }
        }
      }
      const t = (tick - from) / STEP_FPS;
      if (phase === 'play' && (skipped || still || t >= motion.seconds)) rest(tick);
      if (phase === 'play' && !still) {
        moment = Math.min(clamp01(t / BOSS.inS), clamp01((motion.seconds - t) / BOSS.outS));
      } else {
        moment = still ? 0 : Math.max(0, moment - c.dt / BOSS.backS);
      }
      const at = phase === 'idle' && still ? 0 : tick - from;
      if (phase === 'wait' || at === shown) return;
      shown = at;
      if (phase === 'play') motion.play(pose, at / STEP_FPS);
      else motion.idle(pose, at / STEP_FPS);
      version++;
    },
  };
}

/** The solved puppet: n quads in paint order, written from a pose. */
export interface BossChain { readonly count: number; readonly page: number; write(pose: BossPose, out: InstanceWriter): void }

/** Null when a part's sprite is not in the atlas yet or the parts sit on more than one page (one batch per boss). */
export function createChain(def: BossDef, sprites: Readonly<Record<SpriteId, SpriteRect>>): BossChain | null {
  const parts = def.parts;
  const n = parts.length;
  const rects: SpriteRect[] = [];
  for (const p of parts) {
    const r = sprites[p.sprite];
    if (r === undefined || (rects[0] !== undefined && r.page !== rects[0].page)) return null;
    rects.push(r);
  }
  const root = parts.findIndex((p) => p.parent === null);
  const rootRect = rects[root];
  if (rootRect === undefined) return null;
  const parent = parts.map((p) => parts.findIndex((q) => q.role === p.parent));
  const order: number[] = [];
  const visit = (i: number): void => {
    if (order.includes(i)) return;
    const up = parent[i] ?? -1;
    if (up >= 0) visit(up);
    order.push(i);
  };
  for (let i = 0; i < n; i++) visit(i);
  const paint = parts.map((_, i) => i).sort((a, b) => (parts[a]?.z ?? 0) - (parts[b]?.z ?? 0));
  const metres = def.scale / Math.max(1e-6, rootRect.size[1]);
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  const angle = new Float64Array(n);
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  /** Only the root, standing on the ground, lays a ground shadow; every part casts the lantern's. */
  const ground = packPhase(0, QUAD_FLAG.noLean);
  const hung = packPhase(0, QUAD_FLAG.noLean | QUAD_FLAG.noShadow);
  const q: QuadParams = { x: 0, y: 0, z: 0, rot: 0, w: 0, h: 0, px: 0.5, py: 0, uv: rootRect.uv, sway: 0, phase: hung, lift: 0, facing: 0, tint: def.tint ?? [1, 1, 1, 1] };

  function solve(pose: BossPose): void {
    for (const i of order) {
      const p = parts[i];
      if (p === undefined) continue;
      const own = pose.parts[p.role];
      const up = parent[i] ?? -1;
      const base = up >= 0 ? (angle[up] ?? 0) : 0;
      angle[i] = base + (p.rest + (own?.angle ?? 0)) * DEG;
      sx[i] = own?.sx ?? 1;
      sy[i] = own?.sy ?? 1;
      if (up < 0) {
        u[i] = pose.dx;
        v[i] = pose.dy;
        continue;
      }
      const ox = p.offset[0] * (sx[up] ?? 1);
      const oy = p.offset[1] * (sy[up] ?? 1);
      const c = Math.cos(base);
      const s = Math.sin(base);
      u[i] = (u[up] ?? 0) + c * ox - s * oy;
      v[i] = (v[up] ?? 0) + s * ox + c * oy;
    }
  }

  return {
    count: n,
    page: rootRect.page,
    write(pose, out) {
      solve(pose);
      for (let k = 0; k < n; k++) {
        const i = paint[k] ?? 0;
        const p = parts[i];
        const r = rects[i];
        if (p === undefined || r === undefined) continue;
        q.x = def.at[0] + (u[i] ?? 0);
        q.y = def.at[1] + (v[i] ?? 0);
        q.z = def.at[2] + k * BOSS.zStep;
        q.rot = angle[i] ?? 0;
        q.w = r.size[0] * metres * (sx[i] ?? 1);
        q.h = r.size[1] * metres * (sy[i] ?? 1);
        q.px = p.pivot[0];
        q.py = 1 - p.pivot[1];
        q.uv = r.uv;
        q.phase = i === root && pose.dy === 0 ? ground : hung;
        out.set(k, q);
      }
      out.count = n;
      out.commit(0, n);
    },
  };
}

/** What the peacock's Estanque behaviour reads of its boss. */
export interface BossHandle { readonly def: BossDef; readonly run: BossRun; own(hidden: boolean): void }

export interface BossKit {
  def: BossDef;
  sprites: Readonly<Record<SpriteId, SpriteRect>>;
  machine: Machine;
  /** The visitor's [x, z] under free roam: the boss waits until it stands still. */
  visitor: Float32Array | null;
  low: boolean;
  /** A cutout batch on an atlas page of the bed: the bed shows, reveals and frees it with its own. */
  batch(page: number, capacity: number): CutoutBatch;
  /** Hides or shows the bed's own copies of the motion's owned sprites. */
  own(hidden: boolean): void;
}

export interface Boss extends BossHandle { readonly busy: boolean; update(c: Clock): void; dispose(): void }

export function createBoss(k: BossKit): Boss | null {
  const motion = MOTIONS[k.def.motion];
  if (motion === undefined) return null;
  const chain = motion.roles.length > 0 ? createChain(k.def, k.sprites) : null;
  if (motion.roles.length > 0 && chain === null) return null;
  const batch = chain === null ? null : k.batch(chain.page, chain.count);
  // Drawn after the bed's own paper: the depth it wrote keeps what stands in front of the boss in front.
  if (batch !== null) (batch.mesh.material as Material).depthFunc = LessEqualDepth;
  const writer = batch?.writer ?? null;
  const run = createBossRun({ id: k.def.id, motion, fixed: k.low });
  let written = -1;
  let camera = false;
  const seen = new Float32Array(2);
  let listen: AbortController | null = null;

  function hear(on: boolean): void {
    if (on === (listen !== null) || typeof window === 'undefined') return;
    if (!on) {
      listen?.abort();
      listen = null;
      return;
    }
    listen = new AbortController();
    const opts = { capture: true, passive: true, signal: listen.signal };
    const skip = (): void => run.skip();
    window.addEventListener('keydown', skip, opts);
    window.addEventListener('pointerdown', skip, opts);
  }

  return {
    def: k.def,
    run,
    own: k.own,
    get busy() { return run.busy; },
    update(c) {
      const s = k.machine.state;
      const v = k.visitor;
      const standing = v === null || (v[0] === seen[0] && v[1] === seen[1]);
      if (v !== null) seen.set(v);
      const here = s.mode === 'garden' && s.bed === k.def.bed && (s.phase === 'bed' || s.phase === 'focus') && channelsSettled(k.machine) && standing;
      run.step(c, here, c.frozen || s.reduced);
      if (s.bed === k.def.bed) bossCamera.phase = run.phase;
      hear(run.phase === 'play');
      if (run.moment > 0 || camera) {
        bossCamera.amount = run.moment;
        camera = run.moment > 0;
      }
      if (writer === null || chain === null || run.version === written) return;
      written = run.version;
      if (run.phase !== 'wait') chain.write(run.pose, writer);
      else if (writer.count !== 0) {
        writer.count = 0;
        writer.commit(0, 0);
      }
    },
    dispose() {
      hear(false);
      if (camera) bossCamera.amount = 0;
      if (writer !== null) writer.count = 0;
    },
  };
}
