/**
 * Paints free roam's signposts into one canvas atlas (layout in world/signboard.ts): the wooden post, the arm with its
 * brace and hooks, a small tin lantern, and one plank per sign. A plank is the garden label of the cane signs made
 * large: bottle green paint with a ruled cream border, worn back to wood at a corner or two, the place name lettered in
 * Kalnia cream on green with an engraved manicule pointing the way, cut out with a slightly uneven edge and a thin pale
 * paper rim like the archival cutouts. Run at load and on a language change, never per frame.
 */
import { MANICULE } from '../core/manicule.ts';
import { ARM_RECT, ATLAS, BOARD, LANTERN_RECT, POST_RECT, plankRect, type AtlasRect } from './signboard.ts';

const INK = '#efe6cf';
const PAINT = ['#334639', '#26372e', '#1e2c24'] as const;
const PAPER_RIM = '#d9ccb0';
const WOOD = ['#2f2416', '#6b5236', '#806442', '#4a3823'] as const;
const IRON = '#1d1a17';
export const FONT_FAMILY = 'Kalnia, Georgia, "Times New Roman", serif';
/** Lettering size (m) for a one-line name, the least a name may shrink to, and the line step of a two-line name. */
const LETTER = { oneLine: 0.25, twoLine: 0.19, least: 0.13, lineStep: 1.05 } as const;
/** Inside the board: the border inset, the manicule's width and its gap to the name (m). */
const INNER = { inset: 0.07, hand: 0.3, gap: 0.05 } as const;

/** A small seeded random, so every plank keeps its own wear and edge from one paint to the next. */
function seeded(seed: number): () => number {
  let a = seed * 2654435761;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An uneven cut outline round a box: each side in a few slightly wandering steps, the corners clipped. */
function cutPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, clip: number, rand: () => number): void {
  const j = (): number => (rand() - 0.5) * 2.2;
  const steps = 6;
  ctx.beginPath();
  ctx.moveTo(x + clip, y + j());
  for (let i = 1; i <= steps; i++) ctx.lineTo(x + clip + ((w - 2 * clip) * i) / steps, y + j());
  ctx.lineTo(x + w + j(), y + clip);
  for (let i = 1; i <= 2; i++) ctx.lineTo(x + w + j(), y + clip + ((h - 2 * clip) * i) / 2);
  ctx.lineTo(x + w - clip, y + h + j());
  for (let i = steps - 1; i >= 0; i--) ctx.lineTo(x + clip + ((w - 2 * clip) * i) / steps, y + h + j());
  ctx.lineTo(x + j(), y + h - clip);
  ctx.lineTo(x + j(), y + clip);
  ctx.closePath();
}

/** Fine wood grain: thin darker strokes along the length of a box. */
function grain(ctx: CanvasRenderingContext2D, r: Readonly<AtlasRect>, across: boolean, rand: () => number, alpha: number): void {
  ctx.save();
  ctx.strokeStyle = `rgb(20 14 8 / ${alpha})`;
  ctx.lineWidth = 1;
  const n = Math.round((across ? r.h : r.w) / 3);
  for (let i = 0; i < n; i++) {
    const at = (i + rand()) * 3;
    ctx.beginPath();
    if (across) {
      ctx.moveTo(r.x, r.y + at);
      ctx.bezierCurveTo(r.x + r.w * 0.3, r.y + at + rand() * 2 - 1, r.x + r.w * 0.7, r.y + at + rand() * 2 - 1, r.x + r.w, r.y + at);
    } else {
      ctx.moveTo(r.x + at, r.y);
      ctx.lineTo(r.x + at + rand() * 2 - 1, r.y + r.h);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function woodFill(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, WOOD[0]);
  g.addColorStop(0.3, WOOD[2]);
  g.addColorStop(0.65, WOOD[1]);
  g.addColorStop(1, WOOD[3]);
  return g;
}

function paintPost(ctx: CanvasRenderingContext2D, rand: () => number): void {
  const r = POST_RECT;
  const inset = 3;
  const cap = 10;
  ctx.fillStyle = woodFill(ctx, r.x + inset, 0, r.x + r.w - inset, 0);
  ctx.beginPath();
  ctx.moveTo(r.x + inset, r.y + r.h);
  ctx.lineTo(r.x + inset, r.y + cap);
  ctx.lineTo(r.x + r.w / 2, r.y + 1);
  ctx.lineTo(r.x + r.w - inset, r.y + cap);
  ctx.lineTo(r.x + r.w - inset, r.y + r.h);
  ctx.closePath();
  ctx.fill();
  grain(ctx, { x: r.x + inset, y: r.y + cap, w: r.w - 2 * inset, h: r.h - cap }, false, rand, 0.35);
}

function paintArm(ctx: CanvasRenderingContext2D, rand: () => number): void {
  const r = ARM_RECT;
  const px = ATLAS.woodPxM;
  const beam = Math.round(BOARD.arm.beam * px);
  const postX = r.x - BOARD.arm.from * px;
  ctx.fillStyle = woodFill(ctx, 0, r.y + 1, 0, r.y + beam);
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, beam - 1);
  grain(ctx, { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: beam - 1 }, true, rand, 0.3);
  // The brace from the post up under the beam.
  ctx.strokeStyle = WOOD[1];
  ctx.lineWidth = 5;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(postX + 3, r.y + r.h - 2);
  ctx.lineTo(postX + 0.42 * px, r.y + beam);
  ctx.stroke();
  // Iron rings under the beam where the plank's bridle and the lantern hang.
  ctx.strokeStyle = IRON;
  ctx.lineWidth = 1.6;
  for (const at of [BOARD.plank.hookAt, BOARD.lantern.at]) {
    ctx.beginPath();
    ctx.arc(postX + at * px, r.y + beam + 2.5, 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** A pierced tin lantern: hook ring, cap, four panes of warm glass between dark bars, a base. */
function paintLantern(ctx: CanvasRenderingContext2D): void {
  const r = LANTERN_RECT;
  const cx = r.x + r.w / 2;
  const ring = r.h * 0.1;
  const capB = r.y + r.h * 0.3;
  const baseT = r.y + r.h * 0.86;
  ctx.strokeStyle = IRON;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, r.y + ring * 0.6, ring * 0.45, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#2a2520';
  ctx.beginPath();
  ctx.moveTo(cx - 4, r.y + ring);
  ctx.lineTo(cx + 4, r.y + ring);
  ctx.lineTo(r.x + r.w - 6, capB);
  ctx.lineTo(r.x + 6, capB);
  ctx.closePath();
  ctx.fill();
  const glass = ctx.createRadialGradient(cx, r.y + r.h * 0.55, 2, cx, r.y + r.h * 0.55, r.w * 0.5);
  glass.addColorStop(0, '#fff3c8');
  glass.addColorStop(0.5, '#f2cf86');
  glass.addColorStop(1, '#b98a46');
  ctx.fillStyle = glass;
  ctx.fillRect(r.x + 9, capB, r.w - 18, baseT - capB);
  ctx.fillStyle = '#2a2520';
  for (const x of [r.x + 7, cx - 1.5, r.x + r.w - 10]) ctx.fillRect(x, capB, 3, baseT - capB);
  ctx.fillRect(r.x + 5, baseT, r.w - 10, r.y + r.h - 2 - baseT);
}

/** The name in one line, or two split at the space nearest the middle, at the largest size that fits (px). */
function letter(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, w: number, h: number): void {
  const px = ATLAS.plankPxM;
  const fit = (size: number, lines: readonly string[]): number => {
    ctx.font = `400 ${size}px ${FONT_FAMILY}`;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    return Math.min(size, (size * w) / widest, h / (lines.length * LETTER.lineStep));
  };
  let lines: string[] = [name];
  let size = fit(LETTER.oneLine * px, lines);
  const space = name.indexOf(' ', Math.floor(name.length / 2) - 3);
  if (size < LETTER.twoLine * px && space > 0) {
    const two = [name.slice(0, space), name.slice(space + 1)];
    const twoSize = fit(LETTER.twoLine * px, two);
    if (twoSize > size) {
      lines = two;
      size = twoSize;
    }
  }
  size = Math.max(size, LETTER.least * px);
  ctx.font = `400 ${size}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  ctx.shadowColor = 'rgb(0 0 0 / 0.55)';
  ctx.shadowOffsetY = 1.5;
  const step = size * LETTER.lineStep;
  lines.forEach((l, i) => ctx.fillText(l, cx, cy + (i - (lines.length - 1) / 2) * step + size * 0.04));
  ctx.shadowColor = 'transparent';
}

function paintHand(ctx: CanvasRenderingContext2D, x: number, cy: number, w: number, dir: -1 | 1): void {
  const k = w / 48;
  ctx.save();
  ctx.translate(dir > 0 ? x : x + w, cy - 12 * k);
  ctx.scale(dir * k, k);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(MANICULE));
  ctx.restore();
}

function paintPlank(ctx: CanvasRenderingContext2D, i: number, name: string, dir: -1 | 1): void {
  const r = plankRect(i);
  const px = ATLAS.plankPxM;
  const rand = seeded(i + 11);
  ctx.clearRect(r.x, r.y, r.w, r.h);
  const m = BOARD.plank.margin * px;
  const bw = BOARD.plank.w * px;
  const bh = BOARD.plank.h * px;
  const bx = r.x + m;
  const by = r.y + m + BOARD.plank.bridle * px;
  const hookX = r.x + r.w / 2;
  // The bridle: two cords from the board's top corners up to one ring on the arm's hook.
  ctx.strokeStyle = '#3a3027';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(bx + bw * 0.1, by + 3);
  ctx.lineTo(hookX, r.y + m + 5);
  ctx.lineTo(bx + bw * 0.9, by + 3);
  ctx.stroke();
  ctx.strokeStyle = IRON;
  ctx.beginPath();
  ctx.arc(hookX, r.y + m + 3, 3, 0, Math.PI * 2);
  ctx.stroke();
  // Paper rim, then the painted board cut a little inside it.
  ctx.fillStyle = PAPER_RIM;
  cutPath(ctx, bx, by, bw, bh, 7, rand);
  ctx.fill();
  const paint = ctx.createLinearGradient(bx, by, bx + bw * 0.08, by + bh);
  paint.addColorStop(0, PAINT[0]);
  paint.addColorStop(0.55, PAINT[1]);
  paint.addColorStop(1, PAINT[2]);
  ctx.fillStyle = paint;
  cutPath(ctx, bx + 2.5, by + 2.5, bw - 5, bh - 5, 6, rand);
  ctx.fill();
  ctx.save();
  ctx.clip();
  grain(ctx, { x: bx, y: by, w: bw, h: bh }, true, rand, 0.22);
  // Worn back to wood at a corner or two.
  for (let k = 0; k < 2; k++) {
    const wx = bx + (k === 0 ? 0.92 + rand() * 0.05 : 0.02 + rand() * 0.05) * bw;
    const wy = by + (k === 0 ? 0.82 : 0.12) * bh;
    const wear = ctx.createRadialGradient(wx, wy, 0, wx, wy, 9 + rand() * 6);
    wear.addColorStop(0, 'rgb(128 100 66 / 0.85)');
    wear.addColorStop(0.6, 'rgb(128 100 66 / 0.45)');
    wear.addColorStop(1, 'rgb(128 100 66 / 0)');
    ctx.fillStyle = wear;
    ctx.fillRect(wx - 16, wy - 16, 32, 32);
  }
  ctx.restore();
  // The ruled cream border.
  const inset = INNER.inset * px * 0.55;
  ctx.strokeStyle = 'rgb(239 230 207 / 0.42)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bx + inset, by + inset, bw - 2 * inset, bh - 2 * inset);
  const handW = INNER.hand * px;
  const gap = INNER.gap * px;
  const innerX = bx + INNER.inset * px;
  const innerW = bw - 2 * INNER.inset * px;
  const textW = innerW - handW - gap;
  const cy = by + bh / 2;
  const handX = dir > 0 ? innerX + innerW - handW : innerX;
  const textX = dir > 0 ? innerX : innerX + handW + gap;
  paintHand(ctx, handX, cy, handW, dir);
  letter(ctx, name, textX + textW / 2, cy, textW, bh - 2 * INNER.inset * px);
}

/** The atlas canvas, square, cleared. */
export function createAtlasCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = ATLAS.side;
  c.height = ATLAS.side;
  return c;
}

/** Paints the shared parts and every plank (`names[i]` and `dirs[i]` for sign i) into the atlas. */
export function paintAtlas(canvas: HTMLCanvasElement, names: readonly string[], dirs: readonly (-1 | 1)[]): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const rand = seeded(3);
  paintPost(ctx, rand);
  paintArm(ctx, rand);
  paintLantern(ctx);
  names.forEach((n, i) => paintPlank(ctx, i, n, dirs[i] ?? 1));
}

/** Waits for the display face at the size the planks use (a missing face resolves too: the fallback letters then). */
export async function displayFontReady(): Promise<void> {
  await document.fonts.load(`400 ${Math.round(LETTER.oneLine * ATLAS.plankPxM)}px ${FONT_FAMILY}`).catch(() => undefined);
}
