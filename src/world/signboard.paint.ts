/**
 * Paints free roam's signposts into one canvas atlas (layout in world/signboard.ts) as hand-cut, engraved paper like
 * the garden's archival cutouts: the wooden post with a knot or two, the arm with its brace and hooks, a small tin
 * lantern, and one plank per sign. A plank is faded bottle green paint, dry-brushed and hatched, scissor-cut with a
 * chipped corner worn back to wood and hung a degree or two off level, with a hand-ruled cream border, the place name
 * lettered in Kalnia cream and an engraved manicule pointing the way. Every part has a thin dark ink edge and no
 * sheen. Seeded, so a sign keeps its cut and wear; run at load and on a language change, never per frame.
 */
import { MANICULE } from '../core/manicule.ts';
import { cutOutline, dryBrush, hatch, knot, seeded, speckle, type Box, type Pt, type Rand } from './signboard.ink.ts';
import { ARM_RECT, ATLAS, BOARD, LANTERN_RECT, POST_RECT, plankRect } from './signboard.ts';

const EDGE = '#16110c';
const LETTERING = '#e3d7b7';
const PAINT = { base: '#36463b', chalk: '#8d9a86', shade: '#1b241e', fleck: '#d3d6c3' } as const;
const WOOD = { base: '#5a4630', shade: '#241a11', light: '#8c7150', bare: '#7b6446' } as const;
const IRON = '#1d1a17';
export const FONT_FAMILY = 'Kalnia, Georgia, "Times New Roman", serif';
/** Lettering size (m) for a one-line name, the least a name may shrink to, and the line step of a two-line name. */
const LETTER = { oneLine: 0.21, twoLine: 0.15, least: 0.105, lineStep: 1.05 } as const;
/** Inside the board: the border inset, the lettering's inset, the manicule's width and its gap to the name (m). */
const INNER = { border: 0.035, inset: 0.05, hand: 0.22, gap: 0.035 } as const;
/** How far off level a plank hangs (degrees, least and most), and the bite of its chipped corner (px). */
const TILT = { least: 0.8, most: 2 } as const;
const CHIP = { least: 18, most: 30 } as const;
/** The brace's reach along the arm from the post (m). */
const BRACE_REACH = 0.32;

/** Fills a cut outline with flat colour, lets `marks` texture it inside the cut, then inks its edge. */
function cutPiece(ctx: CanvasRenderingContext2D, path: Path2D, fill: string, edge: number, marks: () => void): void {
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  marks();
  ctx.restore();
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = edge;
  ctx.lineJoin = 'round';
  ctx.stroke(path);
}

/** Engraved wood inside a box: dry-brushed light and dark along the grain, hatched darker on one side. */
function woodMarks(ctx: CanvasRenderingContext2D, b: Readonly<Box>, upright: boolean, rand: Rand): void {
  dryBrush(ctx, b, WOOD.light, 0.45, 36, upright, rand);
  dryBrush(ctx, b, WOOD.shade, 0.5, 28, upright, rand);
  const angle = upright ? Math.PI / 2 : 0;
  hatch(ctx, b, angle, 5, WOOD.shade, 0.35, rand);
  const shade = upright ? { ...b, w: b.w * 0.4 } : { ...b, y: b.y + b.h * 0.55, h: b.h * 0.45 };
  hatch(ctx, shade, angle, 3, WOOD.shade, 0.6, rand);
}

function paintPost(ctx: CanvasRenderingContext2D, rand: Rand): void {
  const { x, y, w, h } = POST_RECT;
  const outline: Pt[] = [
    [x + 3.5, y + h], [x + 2, y + h * 0.72], [x + 5, y + h * 0.5], [x + 3, y + h * 0.3], [x + 4, y + 16], [x + w * 0.4, y + 2], [x + w - 4, y + 11],
    [x + w - 4, y + h * 0.29], [x + w - 0.5, y + h * 0.335], [x + w - 4, y + h * 0.38], [x + w - 6, y + h * 0.6], [x + w - 3, y + h * 0.8], [x + w - 3.5, y + h],
  ];
  cutPiece(ctx, cutOutline(outline, 18, 2, rand), WOOD.base, 2.6, () => {
    woodMarks(ctx, { x, y, w, h }, true, rand);
    knot(ctx, x + w - 8, y + h * 0.335, 3.4, 7, WOOD.shade, rand);
    knot(ctx, x + 10, y + h * (0.58 + rand() * 0.2), 3, 6, WOOD.shade, rand);
  });
}

function paintArm(ctx: CanvasRenderingContext2D, rand: Rand): void {
  const { x, y, w, h } = ARM_RECT;
  const px = ATLAS.woodPxM;
  const beam = Math.round(BOARD.arm.beam * px);
  const postX = x - BOARD.arm.from * px;
  const reach = postX + BRACE_REACH * px;
  const brace: Pt[] = [[postX + 1, y + h - 1], [postX + 7, y + h - 1], [reach + 4, y + beam - 1], [reach - 4, y + beam - 1]];
  cutPiece(ctx, cutOutline(brace, 12, 1.6, rand), WOOD.base, 2, () => woodMarks(ctx, { x: postX, y: y + beam, w: reach - postX + 4, h: h - beam }, false, rand));
  const beamOutline: Pt[] = [
    [x + 2, y + 3.5], [x + w * 0.5, y + 3], [x + w - 4, y + 2.5], [x + w - 2, y + beam * 0.6], [x + w - 5, y + beam + 1], [x + w * 0.5, y + beam + 1.5], [x + 2, y + beam + 2],
  ];
  cutPiece(ctx, cutOutline(beamOutline, 20, 2, rand), WOOD.base, 2.2, () => woodMarks(ctx, { x, y, w, h: beam + 2 }, false, rand));
  // Iron rings under the beam where the plank's bridle and the lantern hang.
  ctx.strokeStyle = IRON;
  ctx.lineWidth = 1.6;
  for (const at of [BOARD.plank.hookAt, BOARD.lantern.at]) {
    ctx.beginPath();
    ctx.arc(postX + at * px, y + beam + 4.5, 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** A pierced tin lantern: hook ring, cap, four panes of warm glass between dark bars, a base, all inked round. */
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
  const glass = ctx.createRadialGradient(cx, r.y + r.h * 0.55, 2, cx, r.y + r.h * 0.55, r.w * 0.5);
  glass.addColorStop(0, '#fbeec4');
  glass.addColorStop(0.5, '#eacb88');
  glass.addColorStop(1, '#ad8549');
  ctx.fillStyle = glass;
  ctx.fillRect(r.x + 9, capB, r.w - 18, baseT - capB);
  ctx.fillStyle = '#2a2520';
  for (const x of [r.x + 7, cx - 1.5, r.x + r.w - 10]) ctx.fillRect(x, capB, 3, baseT - capB);
  ctx.fillRect(r.x + 5, baseT, r.w - 10, r.y + r.h - 2 - baseT);
  ctx.beginPath();
  ctx.moveTo(cx - 4, r.y + ring);
  ctx.lineTo(cx + 4.5, r.y + ring + 0.5);
  ctx.lineTo(r.x + r.w - 5.5, capB);
  ctx.lineTo(r.x + 6, capB + 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.strokeRect(r.x + 7, capB, r.w - 14, r.y + r.h - 2 - capB);
}

/** The name in one line, or two split at the space nearest the middle, at the largest size that fits, hand painted. */
function letter(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, w: number, h: number, rand: Rand): void {
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
  const step = size * LETTER.lineStep;
  const write = (dx: number, dy: number, style: string, alpha: number): void => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = style;
    lines.forEach((l, i) => ctx.fillText(l, cx + dx, cy + dy + (i - (lines.length - 1) / 2) * step + size * 0.04));
  };
  write(0, 1.2, EDGE, 0.45);
  write(0, 0, LETTERING, 0.92);
  write(0.7, -0.5, LETTERING, 0.3);
  ctx.globalAlpha = 1;
  // The brush runs dry here and there: thin streaks of the board's paint across the letters.
  const box = { x: cx - w / 2, y: cy - (step * lines.length) / 2, w, h: step * lines.length };
  dryBrush(ctx, box, PAINT.base, 0.55, 26, false, rand);
}

function paintHand(ctx: CanvasRenderingContext2D, x: number, cy: number, w: number, dir: -1 | 1): void {
  const k = w / 48;
  const hand = new Path2D(MANICULE);
  ctx.save();
  ctx.translate(dir > 0 ? x : x + w, cy - 12 * k);
  ctx.scale(dir * k, k);
  ctx.strokeStyle = LETTERING;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 0.9;
  ctx.stroke(hand);
  ctx.translate(0.3, -0.25);
  ctx.globalAlpha = 0.3;
  ctx.stroke(hand);
  ctx.restore();
}

/** The board's outline about its centre: a box not quite square at its corners, three clipped and one chipped. */
function boardOutline(hw: number, hh: number, rand: Rand): { outline: Pt[]; chipAt: Pt } {
  const j = (): number => (rand() - 0.5) * 8;
  const corners: Pt[] = [[-hw + j(), -hh + j()], [hw + j(), -hh + j()], [hw + j(), hh + j()], [-hw + j(), hh + j()]];
  const chipped = Math.floor(rand() * 4);
  const outline: Pt[] = [];
  let chipAt: Pt = corners[chipped]!;
  corners.forEach((c, i) => {
    const prev = corners[(i + 3) % 4]!;
    const next = corners[(i + 1) % 4]!;
    const inLen = Math.hypot(c[0] - prev[0], c[1] - prev[1]);
    const outLen = Math.hypot(next[0] - c[0], next[1] - c[1]);
    const back = (d: number): [number, number] => [c[0] - ((c[0] - prev[0]) / inLen) * d, c[1] - ((c[1] - prev[1]) / inLen) * d];
    const on = (d: number): [number, number] => [c[0] + ((next[0] - c[0]) / outLen) * d, c[1] + ((next[1] - c[1]) / outLen) * d];
    if (i !== chipped) {
      const k = 3 + rand() * 5;
      outline.push(back(k), on(k));
      return;
    }
    const a = CHIP.least + rand() * (CHIP.most - CHIP.least);
    const b = CHIP.least + rand() * (CHIP.most - CHIP.least);
    const deep = back(a * 0.55);
    const along = on(b * 0.55);
    outline.push(back(a), [deep[0] + along[0] - c[0], deep[1] + along[1] - c[1]], on(b));
    chipAt = [(deep[0] + along[0]) / 2, (deep[1] + along[1]) / 2];
  });
  return { outline, chipAt };
}

/** Bare wood showing where the paint wore off round the chipped corner. */
function wear(ctx: CanvasRenderingContext2D, at: Pt, rand: Rand): void {
  const blob: Pt[] = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const r = 7 + rand() * 9;
    blob.push([at[0] + Math.cos(a) * r * 1.4, at[1] + Math.sin(a) * r]);
  }
  const patch = cutOutline(blob, 5, 1.6, rand);
  ctx.fillStyle = WOOD.bare;
  ctx.globalAlpha = 0.85;
  ctx.fill(patch);
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.clip(patch);
  hatch(ctx, { x: at[0] - 24, y: at[1] - 18, w: 48, h: 36 }, 0, 2.2, WOOD.shade, 0.45, rand);
  ctx.restore();
}

function paintPlank(ctx: CanvasRenderingContext2D, i: number, name: string, dir: -1 | 1): void {
  const r = plankRect(i);
  const px = ATLAS.plankPxM;
  const rand = seeded(i + 11);
  ctx.clearRect(r.x, r.y, r.w, r.h);
  const m = BOARD.plank.margin * px;
  const hw = (BOARD.plank.w * px) / 2;
  const hh = (BOARD.plank.h * px) / 2;
  const cx = r.x + r.w / 2;
  const cy = r.y + m + BOARD.plank.bridle * px + hh;
  const tilt = ((TILT.least + rand() * (TILT.most - TILT.least)) * Math.PI / 180) * (rand() < 0.5 ? -1 : 1);
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  // The bridle: two cords from the board's top, a little slack, up to one ring on the arm's hook.
  const ringY = r.y + m + 3;
  ctx.strokeStyle = '#2b231b';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    const lx = side * hw * 0.8;
    const ly = -hh + 3;
    const ex = cx + lx * cos - ly * sin;
    const ey = cy + lx * sin + ly * cos;
    ctx.moveTo(cx, ringY + 2);
    ctx.quadraticCurveTo((cx + ex) / 2 + side * 2, (ringY + ey) / 2 + 2, ex, ey);
  }
  ctx.stroke();
  ctx.strokeStyle = IRON;
  ctx.beginPath();
  ctx.arc(cx, ringY, 3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  const board: Box = { x: -hw - 4, y: -hh - 4, w: 2 * hw + 8, h: 2 * hh + 8 };
  const { outline, chipAt } = boardOutline(hw, hh, rand);
  const cut = cutOutline(outline, 16, 4, rand);
  ctx.fillStyle = PAINT.base;
  ctx.fill(cut);
  ctx.save();
  ctx.clip(cut);
  dryBrush(ctx, board, PAINT.chalk, 0.2, 70, false, rand);
  dryBrush(ctx, board, PAINT.shade, 0.35, 45, false, rand);
  hatch(ctx, board, -0.85, 5.5, PAINT.shade, 0.3, rand);
  hatch(ctx, { ...board, y: hh * 0.2, h: hh }, -0.85, 3.6, PAINT.shade, 0.45, rand);
  wear(ctx, chipAt, rand);
  speckle(ctx, board, PAINT.fleck, 0.14, 220, rand);
  ctx.restore();

  // The hand-ruled border, broken where the brush lifted.
  const bi = INNER.border * px;
  const ruled = cutOutline([[-hw + bi, -hh + bi], [hw - bi, -hh + bi], [hw - bi, hh - bi], [-hw + bi, hh - bi]], 24, 2, rand);
  ctx.setLineDash([40 + rand() * 60, 2 + rand() * 3, 70 + rand() * 80, 3 + rand() * 4]);
  ctx.strokeStyle = 'rgb(227 215 183 / 0.42)';
  ctx.lineWidth = 2.4;
  ctx.stroke(ruled);
  ctx.setLineDash([]);

  const handW = INNER.hand * px;
  const gap = INNER.gap * px;
  const innerX = -hw + INNER.inset * px;
  const innerW = 2 * hw - 2 * INNER.inset * px;
  const textW = innerW - handW - gap;
  const handX = dir > 0 ? innerX + innerW - handW : innerX;
  const textX = dir > 0 ? innerX : innerX + handW + gap;
  paintHand(ctx, handX, 0, handW, dir);
  letter(ctx, name, textX + textW / 2, 0, textW, 2 * hh - 2 * INNER.inset * px, rand);

  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 3.2;
  ctx.lineJoin = 'round';
  ctx.stroke(cut);
  ctx.restore();
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
