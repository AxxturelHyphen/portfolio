import { terrainY } from '../core/terrain.ts';
import { TUFT, TUFT_SPREAD } from '../world/grass.ts';
import { hash01 } from '../world/wall.ts';
import type { SolidBuilder } from './masonry.ts';
import type { SolidPaint } from './solid.paint.ts';

/**
 * The lawn's low nap as real geometry (world/grass.ts places the tufts) in the garden's solids drawn before the cards,
 * so it costs no draw call on any tier, takes the lanterns through the shared solid material and lets the plants paint
 * over it as over the ground. A tuft is 3 to 7 thin blades fanned about its own turn toward the lens (the follow
 * camera always looks north, so every blade shows its front face), splayed back and leaning its own way, each blade a
 * bent strip in two triangles: the root's, whose apex is the bend on the blade's left edge, and the tip's, whose right
 * edge runs straight from the root. The root's triangle takes the darker tone and the tip's the tuft's own olive or
 * sage (a solid's paint is flat per triangle, from its last vertex). Normals lean to the sky, so the nap lights as the
 * lawn under it does and never sparkles blade by blade. Load time only.
 */

const BLADES = { min: 3, max: 7 } as const;
/** A tuft's blade height (m) and each blade's share of it, clamped to the nap's 5 to 25 cm. */
const TALL = { min: 0.07, max: 0.2, jitter: [0.6, 1.3], clamp: [0.05, 0.25] } as const;
/**
 * Blade width at the root (m), the bend's share of the height, the bend's offset left of the axis as a share of the
 * root's half width, and how far the root sinks.
 */
const BLADE = { w: [0.013, 0.02], mid: 0.55, midW: 0.6, sink: 0.012 } as const;
/** Turn (rad either way of the lens), the fan of the blades about it, the splay back, the bend at the tip, the tuft's lean. */
const POSE = { turn: 0.55, fan: 1.3, jitter: 0.25, splay: [0.12, 0.42], bend: [0.25, 0.7], lean: 0.32 } as const;
/** The face's share in the normal next to the sky's. */
const FACE = 0.35;
/** The tufts' tones: muted olive to sage under the shared paper tile, the root's darker share and a jitter of value. */
const OLIVE = [0.95, 1.6, 0.8] as const;
const SAGE = [0.78, 1.5, 1.12] as const;
const ROOT = 0.55;
const VALUE = 0.28;
const SALT = { blades: 0xb1, turn: 0xb2, leanA: 0xb3, leanM: 0xb4, tall: 0xb5, hue: 0xb6, value: 0xb7 } as const;
const BLADE_SALT = { yaw: 0xc1, at: 0xc2, off: 0xc3, tall: 0xc4, splay: 0xc5, bend: 0xc6, w: 0xc7 } as const;

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

function paints(seed: number): [SolidPaint, SolidPaint] {
  const hue = hash01(seed, SALT.hue);
  const v = 1 + VALUE * (2 * hash01(seed, SALT.value) - 1);
  const tip: [number, number, number] = [0, 1, 2].map((k) => mix(OLIVE[k]!, SAGE[k]!, hue) * v) as [number, number, number];
  return [{ tile: 'tile/paper', tint: [tip[0] * ROOT, tip[1] * ROOT, tip[2] * ROOT] }, { tile: 'tile/paper', tint: tip }];
}

/** One bent blade from its root (x, z), facing yaw, tilted by (tx, tz) per unit of height, bent back by `bend` at its tip. */
function blade(b: SolidBuilder, tip: SolidPaint, x: number, z: number, yaw: number, h: number, w: number, tx: number, tz: number, bend: number): void {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const sx = fz / 2;
  const sz = -fx / 2;
  const nl = Math.hypot(FACE, 1);
  const nx = (fx * FACE) / nl;
  const ny = 1 / nl;
  const nz = (fz * FACE) / nl;
  const y = terrainY(x, z) - BLADE.sink;
  const lower = (h * BLADE.mid) / Math.hypot(tx, 1, tz);
  const mx = x + tx * lower;
  const my = y + lower;
  const mz = z + tz * lower;
  const ux = tx - fx * bend;
  const uz = tz - fz * bend;
  const upper = (h * (1 - BLADE.mid)) / Math.hypot(ux, 1, uz);
  const wm = w * BLADE.midW;
  const b0 = b.vertex(x - sx * w, y, z - sz * w, nx, ny, nz);
  const b1 = b.vertex(x + sx * w, y, z + sz * w, nx, ny, nz);
  const m = b.vertex(mx - sx * wm, my, mz - sz * wm, nx, ny, nz);
  b.triangle(b0, b1, m);
  b.paint(tip);
  b.triangle(m, b1, b.vertex(mx + ux * upper, my + upper, mz + uz * upper, nx, ny, nz));
}

/** Adds every tuft (world/grass.ts grassTufts) to a solids builder, standing on the free-roam ground. */
export function grassInto(b: SolidBuilder, tufts: Float32Array): void {
  for (let t = 0; t + TUFT <= tufts.length; t += TUFT) {
    const x = tufts[t]!;
    const z = tufts[t + 1]!;
    const seed = tufts[t + 2]!;
    const [root, tip] = paints(seed);
    const n = BLADES.min + Math.floor(hash01(seed, SALT.blades) * (BLADES.max - BLADES.min + 1));
    const turn = POSE.turn * (2 * hash01(seed, SALT.turn) - 1);
    const leanA = 2 * Math.PI * hash01(seed, SALT.leanA);
    const leanM = POSE.lean * hash01(seed, SALT.leanM);
    const tall = mix(TALL.min, TALL.max, hash01(seed, SALT.tall));
    for (let i = 0; i < n; i++) {
      const s = seed * 8 + i;
      const yaw = turn + ((i + 0.5) / n - 0.5) * POSE.fan + POSE.jitter * (2 * hash01(s, BLADE_SALT.yaw) - 1);
      const at = 2 * Math.PI * hash01(s, BLADE_SALT.at);
      const off = TUFT_SPREAD * Math.sqrt(hash01(s, BLADE_SALT.off));
      const h = Math.min(TALL.clamp[1], Math.max(TALL.clamp[0], tall * mix(TALL.jitter[0], TALL.jitter[1], hash01(s, BLADE_SALT.tall))));
      const splay = mix(POSE.splay[0], POSE.splay[1], hash01(s, BLADE_SALT.splay));
      const tx = -Math.sin(yaw) * splay + Math.sin(leanA) * leanM;
      const tz = -Math.cos(yaw) * splay + Math.cos(leanA) * leanM;
      b.paint(root);
      blade(b, tip, x + Math.cos(at) * off, z + Math.sin(at) * off, yaw, h, mix(BLADE.w[0], BLADE.w[1], hash01(s, BLADE_SALT.w)), tx, tz,
        mix(POSE.bend[0], POSE.bend[1], hash01(s, BLADE_SALT.bend)));
    }
  }
}
