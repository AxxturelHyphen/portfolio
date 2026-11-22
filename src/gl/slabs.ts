import type { Slab } from '../world/slabs.ts';
import { hash01 } from '../world/wall.ts';
import type { SolidBuilder } from './masonry.ts';
import type { SolidPaint } from './solid.paint.ts';

/**
 * The path's slabs (world/slabs.ts outlines) as solid stones into a builder: each stands on the soil with straight
 * sides, a bevelled rim and a top a few centimetres proud, tilted a little and slightly crowned, its tone varied from a
 * fixed hash. The ground under them paints only the mortar (gl/ground.ts setSlabs). Load time only.
 */

/**
 * Top height over the soil (least, spread), the tilt (m per m at most), the crown at the seed, how far the bevel runs
 * in from the outline and how far it drops (m). Tops stay near the walk height (core/terrain.ts TERRAIN.slab, 3 cm), so
 * the visitor's feet sit on them.
 */
const SLAB = { top: [0.031, 0.008], tilt: 0.012, crown: 0.002, bevel: 0.012, drop: 0.008 } as const;
/** The path stone's paint, and the spread of its tone between stones. */
const LOOK: SolidPaint = { tile: 'tile/paper', tint: [1.15, 1.1, 1.03], path: true };
const TONE = 0.22;
/** How much of the bevel's normal leans outward (the rest is up). */
const BEVEL_LEAN = 0.75;

/** Every slab into the builder, each with its own tone. */
export function slabStones(b: SolidBuilder, slabs: readonly Slab[]): void {
  for (const s of slabs) {
    const k = 1 - TONE / 2 + TONE * hash01(s.id, 0x5b);
    b.paint({ ...LOOK, tint: [LOOK.tint[0] * k, LOOK.tint[1] * k, LOOK.tint[2] * k] });
    slab(b, s);
  }
}

function slab(b: SolidBuilder, s: Slab): void {
  const o = s.outline;
  const n = o.length / 2;
  const top = SLAB.top[0] + SLAB.top[1] * hash01(s.id, 0x71);
  const gx = SLAB.tilt * (hash01(s.id, 0x13) * 2 - 1);
  const gz = SLAB.tilt * (hash01(s.id, 0x29) * 2 - 1);
  const ny = 1 / Math.hypot(gx, 1, gz);
  const heightAt = (x: number, z: number): number => top + gx * (x - s.x) + gz * (z - s.z);
  const out: number[] = [];
  const inner: number[] = [];
  for (let i = 0; i < n; i++) {
    const dx = o[i * 2]! - s.x;
    const dz = o[i * 2 + 1]! - s.z;
    const len = Math.hypot(dx, dz) || 1;
    out.push(dx / len, dz / len);
    const keep = Math.max(0.2, 1 - SLAB.bevel / len);
    inner.push(s.x + dx * keep, s.z + dz * keep);
  }
  // The top: a fan from the crowned seed over the inner ring.
  const centre = b.vertex(s.x, top + SLAB.crown, s.z, -gx * ny, ny, -gz * ny);
  for (let i = 0; i < n; i++) b.vertex(inner[i * 2]!, heightAt(inner[i * 2]!, inner[i * 2 + 1]!), inner[i * 2 + 1]!, -gx * ny, ny, -gz * ny);
  for (let i = 0; i < n; i++) b.triangle(centre, centre + 1 + i, centre + 1 + ((i + 1) % n));
  // The bevel from the inner ring down to the outline, then the side down to the soil.
  const up = Math.sqrt(1 - BEVEL_LEAN * BEVEL_LEAN);
  const ring = centre + 1 + n;
  for (let i = 0; i < n; i++) {
    const x = o[i * 2]!;
    const z = o[i * 2 + 1]!;
    const ux = out[i * 2]!;
    const uz = out[i * 2 + 1]!;
    const y = heightAt(x, z) - SLAB.drop;
    b.vertex(x, y, z, ux * BEVEL_LEAN, up, uz * BEVEL_LEAN);
    b.vertex(inner[i * 2]!, heightAt(inner[i * 2]!, inner[i * 2 + 1]!), inner[i * 2 + 1]!, ux * BEVEL_LEAN, up, uz * BEVEL_LEAN);
    b.vertex(x, y, z, ux, 0, uz);
    b.vertex(x, 0, z, ux, 0, uz);
  }
  for (let i = 0; i < n; i++) {
    const a = ring + i * 4;
    const c = ring + ((i + 1) % n) * 4;
    b.quad(a, c, c + 1, a + 1);
    b.quad(a + 3, c + 3, c + 2, a + 2);
  }
}
