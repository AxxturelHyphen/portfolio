/**
 * Hand marks for the signpost atlas (world/signboard.paint.ts), so the signs read as the garden's archival cutouts and
 * not as clean geometry: a scissor-cut outline, engraved hatching, dry-brush streaks and chalky speckle. Every mark
 * takes a seeded random, so a sign keeps the same cut and wear from one paint to the next. Run at paint time only.
 */

export type Rand = () => number;
export type Pt = readonly [number, number];

/** A small seeded random (mulberry32). */
export function seeded(seed: number): Rand {
  let a = seed * 2654435761;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A closed outline through `pts`, each side cut in short steps (about `step` px) that wander up to `amp` px off it. */
export function cutOutline(pts: readonly Pt[], step: number, amp: number, rand: Rand): Path2D {
  const path = new Path2D();
  path.moveTo(pts[0]![0], pts[0]![1]);
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const n = Math.max(1, Math.round(len / step));
    let drift = 0;
    for (let k = 1; k <= n; k++) {
      drift = k === n ? 0 : drift * 0.55 + (rand() - 0.5) * amp;
      const t = (k + (k === n ? 0 : (rand() - 0.5) * 0.4)) / n;
      path.lineTo(a[0] + dx * t - (dy / len) * drift, a[1] + dy * t + (dx / len) * drift);
    }
  });
  path.closePath();
  return path;
}

/** A box for the marks below (px). */
export interface Box { x: number; y: number; w: number; h: number }

/** Engraved hatching over a box: fine parallel strokes at `angle`, each broken in a few places and uneven in weight. */
export function hatch(ctx: CanvasRenderingContext2D, b: Readonly<Box>, angle: number, gap: number, color: string, alpha: number, rand: Rand): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const reach = Math.hypot(b.w, b.h) / 2;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let d = -reach; d < reach; d += gap * (0.75 + rand() * 0.5)) {
    ctx.globalAlpha = alpha * (0.45 + rand() * 0.55);
    ctx.lineWidth = (0.35 + rand() * 0.45) * gap * 0.5;
    const ox = cx - s * d;
    const oy = cy + c * d;
    ctx.beginPath();
    for (let t = -reach; t < reach;) {
      const len = reach * (0.2 + rand() * 0.9);
      ctx.moveTo(ox + c * t, oy + s * t);
      ctx.lineTo(ox + c * (t + len), oy + s * (t + len));
      t += len + gap * (0.6 + rand() * 2.5);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Dry-brush streaks in a box: short broken strokes of `color` along x (or along y when `upright`) catching the grain. */
export function dryBrush(ctx: CanvasRenderingContext2D, b: Readonly<Box>, color: string, alpha: number, count: number, upright: boolean, rand: Rand): void {
  const along = upright ? b.h : b.w;
  const across = upright ? b.w : b.h;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const a0 = (rand() * 1.2 - 0.1) * along;
    const len = along * (0.06 + rand() * 0.35);
    const q = rand() * across;
    const bend = (rand() - 0.5) * 1.6;
    ctx.globalAlpha = alpha * (0.3 + rand() * 0.7);
    ctx.lineWidth = 1 + rand() * 3;
    ctx.beginPath();
    if (upright) {
      ctx.moveTo(b.x + q, b.y + a0);
      ctx.quadraticCurveTo(b.x + q + bend, b.y + a0 + len / 2, b.x + q + bend * 0.4, b.y + a0 + len);
    } else {
      ctx.moveTo(b.x + a0, b.y + q);
      ctx.quadraticCurveTo(b.x + a0 + len / 2, b.y + q + bend, b.x + a0 + len, b.y + q + bend * 0.4);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Chalky speckle: tiny flecks of `color` scattered over a box. */
export function speckle(ctx: CanvasRenderingContext2D, b: Readonly<Box>, color: string, alpha: number, count: number, rand: Rand): void {
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha * (0.3 + rand() * 0.7);
    const size = 1 + rand() * 2;
    ctx.fillRect(b.x + rand() * b.w, b.y + rand() * b.h, size, size * (0.5 + rand()));
  }
  ctx.restore();
}

/** A knot in the wood: a dark heart in two uneven rings, the grain's eye. */
export function knot(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, ink: string, rand: Rand): void {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 0.45, ry * 0.45, rand() * 0.4 - 0.2, 0, Math.PI * 2);
  ctx.fill();
  for (const k of [1, 1.6]) {
    ctx.globalAlpha = 0.55 / k;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(x + (rand() - 0.5), y + (rand() - 0.5) * 2, rx * k, ry * k, rand() * 0.3 - 0.15, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
