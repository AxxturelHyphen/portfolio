/// <reference types="node" />
// P1 placeholder art: flat cut-paper silhouettes in the look-target palette (cook/SHOTS.md), a 1 to 2 px pale rim and
// a small registration cross that marks every sprite as a placeholder. The shape is picked from the sprite id.
import { edgeDistance } from './normal.ts';
import { raster, type Raster } from './raster.ts';

type Prim =
  | { k: 'ell'; cx: number; cy: number; rx: number; ry: number; rot?: number; c: string }
  | { k: 'rect'; x0: number; y0: number; x1: number; y1: number; c: string }
  | { k: 'tri'; p: [number, number, number, number, number, number]; c: string };
const ERASE = 'erase';

export const INK = {
  roseShade: '#890b13', rose: '#a83038', roseLight: '#c56966', roseDusty: '#b38783',
  lilacDeep: '#746583', lilacShade: '#91809a', lilac: '#a294a8', lilacLight: '#b6a9b9',
  leafShade: '#21422f', leaf: '#3b614c', leafLight: '#5d816d',
  ochreDeep: '#7b6648', ochre: '#a59174', ochreLight: '#bba373', terracotta: '#b86f52',
  moon: '#ddd4cb', goldShade: '#8b663a', gold: '#c29f5b', rim: '#f3e6cf', slate: '#5d6c71', slateLight: '#7f9193',
} as const;

export type ShapeKind = 'rose' | 'lily' | 'pod' | 'bud' | 'foliage' | 'grass' | 'tree' | 'stone' | 'wall' | 'arch' | 'ivy' | 'pad' | 'stalk' | 'frame' | 'bird' | 'branch' | 'moth' | 'blob';
export interface Shape { kind: ShapeKind; size: [number, number] /* world units at scale 1 */; pivot: [number, number] /* fraction, y up */ }

const BOTTOM: [number, number] = [0.5, 0];
const CENTRE: [number, number] = [0.5, 0.5];
/** First match wins. Sizes fit a 9 unit wide bed seen from about 1.5 units up (content/beds/*.json, all scale 1). */
const RULES: [RegExp, ShapeKind, [number, number], [number, number]][] = [
  [/swallow|peacock|bird/, 'bird', [0.5, 0.3], CENTRE], [/moth|polilla/, 'moth', [0.3, 0.2], CENTRE],
  [/back-wall|end-wall/, 'wall', [3.6, 3.0], BOTTOM], [/hedge/, 'foliage', [9.6, 1.8], BOTTOM], [/wall-pier|gate-post|pier/, 'stone', [0.8, 3.2], BOTTOM],
  [/wall/, 'wall', [9.6, 2.6], BOTTOM], [/arch|gate|door/, 'arch', [2.4, 3.2], BOTTOM], [/curtain/, 'ivy', [3.0, 3.0], BOTTOM],
  [/ivy-corner/, 'ivy', [1.6, 1.6], BOTTOM], [/ivy|vine|creeper/, 'ivy', [1.2, 2.4], BOTTOM], [/cypress/, 'tree', [1.2, 5.5], BOTTOM],
  [/trunk/, 'stalk', [0.8, 5.0], BOTTOM], [/tree|willow/, 'tree', [3.0, 4.5], BOTTOM], [/branch|ribbon/, 'branch', [3.0, 0.6], CENTRE],
  [/pond-rim|floor|path|stone-bed/, 'stone', [3.6, 0.5], BOTTOM], [/stone-edge|step/, 'stone', [4.0, 0.35], BOTTOM],
  [/plinth|pedestal|sundial/, 'stone', [0.6, 1.0], BOTTOM], [/cloche/, 'blob', [0.8, 0.9], BOTTOM], [/stone|rock|urn/, 'stone', [1.4, 0.9], BOTTOM],
  [/frame|postcard|portrait/, 'frame', [0.8, 1.0], BOTTOM], [/pad/, 'pad', [0.9, 0.25], BOTTOM], [/fern|grass|reed/, 'grass', [1.2, 0.9], BOTTOM],
  [/iris-leaves|leaves|leaf|bush|shrub/, 'foliage', [1.4, 1.0], BOTTOM], [/thorn-cane|canes/, 'stalk', [1.4, 2.0], BOTTOM],
  [/stem|stalk|stake|cane/, 'stalk', [0.15, 1.2], BOTTOM], [/rose|rosa|bloom|flower/, 'rose', [0.7, 1.0], BOTTOM],
  [/lily|nymph|lotus/, 'lily', [0.8, 0.6], BOTTOM], [/pod|seed/, 'pod', [0.5, 0.8], BOTTOM], [/bud/, 'bud', [0.4, 0.8], BOTTOM],
];

export function shapeOf(id: string): Shape {
  const s = (id.split('/').pop() ?? id).toLowerCase();
  for (const [re, kind, size, pivot] of RULES) if (re.test(s)) return { kind, size: [size[0], size[1]], pivot: [pivot[0], pivot[1]] };
  return { kind: 'blob', size: [1, 1], pivot: [BOTTOM[0], BOTTOM[1]] };
}

function petals(n: number, cx: number, cy: number, dist: number, rx: number, ry: number, c: string, phase = 0): Prim[] {
  const out: Prim[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    out.push({ k: 'ell', cx: cx + Math.cos(a) * dist, cy: cy + Math.sin(a) * dist, rx, ry, rot: a, c });
  }
  return out;
}

/** open: 0 = closed bud, 1 = full bloom (only used by the flower kinds). */
function prims(kind: ShapeKind, open: number): Prim[] {
  const o = Math.max(0, Math.min(1, open));
  switch (kind) {
    case 'rose': return [
      { k: 'rect', x0: 0.47, y0: 0, x1: 0.53, y1: 0.62, c: INK.leafShade },
      { k: 'ell', cx: 0.32, cy: 0.3, rx: 0.16, ry: 0.06, rot: 0.5, c: INK.leaf },
      ...petals(7, 0.5, 0.72, 0.16 * o, 0.07 + 0.11 * o, 0.06 + 0.08 * o, INK.roseShade, 0.3),
      ...petals(5, 0.5, 0.72, 0.08 * o, 0.05 + 0.08 * o, 0.05 + 0.06 * o, INK.rose),
      { k: 'ell', cx: 0.5, cy: 0.72, rx: 0.06 + 0.03 * o, ry: 0.07, c: INK.roseLight },
    ];
    case 'lily': return [
      { k: 'ell', cx: 0.5, cy: 0.12, rx: 0.48, ry: 0.12, c: INK.leaf },
      { k: 'ell', cx: 0.5, cy: 0.12, rx: 0.42, ry: 0.08, c: INK.leafLight },
      ...[-0.9, -0.45, 0, 0.45, 0.9].map((a): Prim => ({ k: 'ell', cx: 0.5 + Math.sin(a) * 0.18 * (0.3 + o), cy: 0.3 + 0.25 * (0.4 + 0.6 * o) * Math.cos(a), rx: 0.05 + 0.03 * o, ry: 0.12 + 0.12 * o, rot: -a, c: INK.lilacLight })),
      { k: 'ell', cx: 0.5, cy: 0.32, rx: 0.06, ry: 0.05, c: INK.gold },
    ];
    case 'pod': return [
      { k: 'rect', x0: 0.47, y0: 0, x1: 0.53, y1: 0.35, c: INK.leafShade },
      { k: 'ell', cx: 0.5, cy: 0.62, rx: 0.3 + 0.08 * o, ry: 0.34, c: INK.ochreDeep },
      { k: 'ell', cx: 0.5, cy: 0.62, rx: 0.18 + 0.1 * o, ry: 0.3, c: INK.ochre },
      { k: 'rect', x0: 0.485, y0: 0.32, x1: 0.515, y1: 0.92, c: INK.terracotta },
    ];
    case 'bud': return [
      { k: 'rect', x0: 0.46, y0: 0, x1: 0.54, y1: 0.55, c: INK.leafShade },
      { k: 'ell', cx: 0.5, cy: 0.7, rx: 0.2 + 0.18 * o, ry: 0.22, c: INK.leaf },
      { k: 'tri', p: [0.3, 0.72, 0.7, 0.72, 0.5, 0.98], c: INK.roseDusty },
    ];
    case 'foliage': return [
      { k: 'ell', cx: 0.3, cy: 0.35, rx: 0.28, ry: 0.34, c: INK.leafShade }, { k: 'ell', cx: 0.7, cy: 0.38, rx: 0.28, ry: 0.36, c: INK.leafShade },
      { k: 'ell', cx: 0.5, cy: 0.55, rx: 0.3, ry: 0.42, c: INK.leaf }, { k: 'ell', cx: 0.62, cy: 0.62, rx: 0.14, ry: 0.18, c: INK.leafLight },
    ];
    case 'grass': return [0.15, 0.28, 0.4, 0.5, 0.6, 0.72, 0.85].map((x, i): Prim => ({
      k: 'tri', p: [x - 0.06, 0, x + 0.06, 0, x + (i % 2 ? 0.08 : -0.08), 0.6 + 0.4 * ((i * 37) % 10) / 10], c: i % 3 ? INK.leaf : INK.leafLight,
    }));
    case 'tree': return [
      { k: 'rect', x0: 0.44, y0: 0, x1: 0.56, y1: 0.5, c: INK.ochreDeep },
      { k: 'ell', cx: 0.5, cy: 0.66, rx: 0.48, ry: 0.32, c: INK.leafShade }, { k: 'ell', cx: 0.42, cy: 0.74, rx: 0.3, ry: 0.22, c: INK.leaf },
      { k: 'ell', cx: 0.6, cy: 0.82, rx: 0.2, ry: 0.14, c: INK.leafLight },
    ];
    case 'stone': return [
      { k: 'ell', cx: 0.5, cy: 0.45, rx: 0.5, ry: 0.45, c: INK.lilacShade }, { k: 'rect', x0: 0.0, y0: 0, x1: 1, y1: 0.45, c: INK.lilacShade },
      { k: 'ell', cx: 0.45, cy: 0.62, rx: 0.32, ry: 0.18, c: INK.lilac },
    ];
    case 'arch': return [
      { k: 'ell', cx: 0.5, cy: 0.62, rx: 0.5, ry: 0.38, c: INK.ochreDeep }, { k: 'rect', x0: 0, y0: 0, x1: 1, y1: 0.62, c: INK.ochreDeep },
      { k: 'ell', cx: 0.5, cy: 0.6, rx: 0.32, ry: 0.26, c: ERASE }, { k: 'rect', x0: 0.18, y0: 0, x1: 0.82, y1: 0.6, c: ERASE },
      { k: 'rect', x0: 0.02, y0: 0, x1: 0.1, y1: 0.6, c: INK.ochre }, { k: 'rect', x0: 0.9, y0: 0, x1: 0.98, y1: 0.6, c: INK.ochre },
    ];
    case 'ivy': {
      const out: Prim[] = [{ k: 'rect', x0: 0.48, y0: 0, x1: 0.52, y1: 1, c: INK.leafShade }];
      for (let i = 0; i < 9; i++) out.push({ k: 'ell', cx: 0.5 + (i % 2 ? 0.2 : -0.2), cy: 0.06 + i * 0.11, rx: 0.22, ry: 0.06, rot: i % 2 ? 0.4 : -0.4, c: i % 3 ? INK.leaf : INK.leafLight });
      return out;
    }
    case 'moth': return [
      { k: 'ell', cx: 0.3, cy: 0.6, rx: 0.26, ry: 0.32, c: INK.lilacShade }, { k: 'ell', cx: 0.7, cy: 0.6, rx: 0.26, ry: 0.32, c: INK.lilacShade },
      { k: 'ell', cx: 0.34, cy: 0.3, rx: 0.18, ry: 0.22, c: INK.lilac }, { k: 'ell', cx: 0.66, cy: 0.3, rx: 0.18, ry: 0.22, c: INK.lilac },
      { k: 'ell', cx: 0.5, cy: 0.48, rx: 0.05, ry: 0.36, c: INK.lilacDeep },
    ];
    case 'wall': return [
      { k: 'rect', x0: 0, y0: 0, x1: 1, y1: 0.9, c: INK.lilacShade }, { k: 'rect', x0: 0, y0: 0.86, x1: 1, y1: 1, c: INK.lilac },
      { k: 'rect', x0: 0, y0: 0, x1: 1, y1: 0.08, c: INK.lilacDeep },
    ];
    case 'pad': return [{ k: 'ell', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5, c: INK.leaf }, { k: 'tri', p: [0.5, 0.5, 0.95, 0.75, 0.95, 0.25], c: ERASE }];
    case 'stalk': return [
      { k: 'rect', x0: 0.35, y0: 0, x1: 0.65, y1: 1, c: INK.leafShade },
      { k: 'ell', cx: 0.5, cy: 0.55, rx: 0.5, ry: 0.06, rot: 0.3, c: INK.leaf },
    ];
    case 'frame': return [
      { k: 'rect', x0: 0, y0: 0, x1: 1, y1: 1, c: INK.goldShade }, { k: 'rect', x0: 0.08, y0: 0.08, x1: 0.92, y1: 0.92, c: INK.gold },
      { k: 'rect', x0: 0.16, y0: 0.16, x1: 0.84, y1: 0.84, c: INK.moon },
    ];
    case 'bird': return [
      { k: 'tri', p: [0.05, 0.9, 0.45, 0.5, 0.6, 0.55], c: INK.slate }, { k: 'tri', p: [0.95, 0.9, 0.55, 0.5, 0.4, 0.55], c: INK.slate },
      { k: 'ell', cx: 0.5, cy: 0.45, rx: 0.2, ry: 0.14, c: INK.slateLight }, { k: 'tri', p: [0.4, 0.4, 0.6, 0.4, 0.5, 0.0], c: INK.slate },
    ];
    case 'branch': return [{ k: 'tri', p: [0, 0.3, 0, 0.7, 1, 0.5], c: INK.ochreDeep }, { k: 'ell', cx: 0.7, cy: 0.62, rx: 0.08, ry: 0.2, rot: 0.6, c: INK.leaf }];
    case 'blob': return [{ k: 'ell', cx: 0.5, cy: 0.5, rx: 0.48, ry: 0.48, c: INK.lilacDeep }, { k: 'ell', cx: 0.45, cy: 0.56, rx: 0.3, ry: 0.3, c: INK.lilac }];
  }
}

function hit(p: Prim, u: number, v: number): boolean {
  if (p.k === 'rect') return u >= p.x0 && u <= p.x1 && v >= p.y0 && v <= p.y1;
  if (p.k === 'ell') {
    const c = Math.cos(-(p.rot ?? 0));
    const s = Math.sin(-(p.rot ?? 0));
    const x = (u - p.cx) * c - (v - p.cy) * s;
    const y = (u - p.cx) * s + (v - p.cy) * c;
    return (x / p.rx) ** 2 + (y / p.ry) ** 2 <= 1;
  }
  const [ax, ay, bx, by, cx, cy] = p.p;
  const e = (x0: number, y0: number, x1: number, y1: number): number => (x1 - x0) * (v - y0) - (y1 - y0) * (u - x0);
  const d1 = e(ax, ay, bx, by);
  const d2 = e(bx, by, cx, cy);
  const d3 = e(cx, cy, ax, ay);
  return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
}

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

function ink(list: Prim[], u: number, v: number): string | null {
  let c: string | null = null;
  for (const p of list) if (hit(p, u, v)) c = p.c === ERASE ? null : p.c;
  return c;
}

/** Draws a placeholder sprite of w x h px (straight alpha, top row first). */
export function drawPlaceholder(kind: ShapeKind, w: number, h: number, open = 1): Raster {
  const list = prims(kind, open);
  const out = raster(w, h);
  const SS = [0.25, 0.75];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let cover = 0;
      for (const sy of SS) for (const sx of SS) if (ink(list, (x + sx) / w, 1 - (y + sy) / h) !== null) cover++;
      if (cover === 0) continue;
      const c = ink(list, (x + 0.5) / w, 1 - (y + 0.5) / h) ?? ink(list, (x + 0.25) / w, 1 - (y + 0.25) / h) ?? INK.lilac;
      out.data.set([...rgb(c), Math.round((cover / 4) * 255)], (y * w + x) * 4);
    }
  }
  const dist = edgeDistance(out);
  const rim = rgb(INK.rim);
  const mark = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const mx = Math.round(w / 2);
  const my = Math.round(h / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if ((out.data[i + 3] ?? 0) === 0) continue;
      const d = dist[y * w + x] ?? 0;
      const cross = (x === mx && Math.abs(y - my) <= mark) || (y === my && Math.abs(x - mx) <= mark);
      const k = cross ? 0.7 : d < 1.5 ? 0.55 : 0;
      for (let j = 0; j < 3; j++) out.data[i + j] = Math.round((out.data[i + j] ?? 0) * (1 - k) + (rim[j] ?? 0) * k);
    }
  }
  return out;
}
