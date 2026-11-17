// Binary morphology on w*h masks (Uint8Array, 1 = set): exact Euclidean distance transform, dilate, erode,
// close, connected components and hole filling. Build time only.

export interface Mask { w: number; h: number; m: Uint8Array }

export const mask = (w: number, h: number): Mask => ({ w, h, m: new Uint8Array(w * h) });

const INF = 1e20;

/** 1D squared distance transform (Felzenszwalb and Huttenlocher 2012) of f into d, n samples. */
function dt1(f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array, n: number): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = 0;
    for (;;) {
      const p = v[k]!;
      s = (f[q]! + q * q - (f[p]! + p * p)) / (2 * q - 2 * p);
      if (s > z[k]! || k === 0) break;
      k--;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const p = v[k]!;
    d[q] = (q - p) * (q - p) + f[p]!;
  }
}

/** Euclidean distance in px from every pixel to the nearest pixel where target(i) is true (0 on target pixels).
 * Pixels outside the image count as target when borderIsTarget. */
export function distanceTo(w: number, h: number, target: (i: number) => boolean, borderIsTarget = false): Float32Array {
  const pad = borderIsTarget ? 1 : 0;
  const W = w + pad * 2;
  const H = h + pad * 2;
  const g = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ix = x - pad;
      const iy = y - pad;
      const inside = ix >= 0 && iy >= 0 && ix < w && iy < h;
      g[y * W + x] = !inside || target(iy * w + ix) ? 0 : INF;
    }
  }
  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = g[y * W + x]!;
    dt1(f, d, v, z, H);
    for (let y = 0; y < H; y++) g[y * W + x] = d[y]!;
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = g[y * W + x]!;
    dt1(f, d, v, z, W);
    for (let x = 0; x < W; x++) g[y * W + x] = d[x]!;
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(g[(y + pad) * W + x + pad]!);
  return out;
}

export function dilate(a: Mask, r: number): Mask {
  const d = distanceTo(a.w, a.h, (i) => a.m[i] === 1);
  const out = mask(a.w, a.h);
  for (let i = 0; i < d.length; i++) out.m[i] = d[i]! <= r ? 1 : 0;
  return out;
}

export function erode(a: Mask, r: number): Mask {
  const d = distanceTo(a.w, a.h, (i) => a.m[i] === 0);
  const out = mask(a.w, a.h);
  for (let i = 0; i < d.length; i++) out.m[i] = d[i]! > r ? 1 : 0;
  return out;
}

export const close = (a: Mask, r: number): Mask => erode(dilate(a, r), r);
export const open = (a: Mask, r: number): Mask => dilate(erode(a, r), r);

export interface Components { labels: Int32Array /* 0 = none, else 1..count */; count: number; area: number[]; box: [number, number, number, number][] /* x0, y0, x1, y1 inclusive */; touchesBorder: boolean[] }

/** 8-connected components of the pixels where on(i) is true. Index 0 of area, box and touchesBorder is unused. */
export function components(w: number, h: number, on: (i: number) => boolean): Components {
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  const area = [0];
  const box: [number, number, number, number][] = [[0, 0, 0, 0]];
  const touchesBorder = [false];
  let count = 0;
  for (let s = 0; s < w * h; s++) {
    if (labels[s] !== 0 || !on(s)) continue;
    count++;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    labels[s] = count;
    let n = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    while (head < tail) {
      const i = queue[head++]!;
      const x = i % w;
      const y = (i - x) / w;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (labels[j] !== 0 || !on(j)) continue;
          labels[j] = count;
          queue[tail++] = j;
        }
      }
    }
    area.push(n);
    box.push([x0, y0, x1, y1]);
    touchesBorder.push(x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1);
  }
  return { labels, count, area, box, touchesBorder };
}

/** Sets every hole (unset region not connected to the image border) for which fillIt(area, mean score over the
 * hole) holds. Returns the number of pixels set. */
export function fillHoles(a: Mask, score: Float32Array, fillIt: (area: number, meanScore: number) => boolean): number {
  const bg = components(a.w, a.h, (i) => a.m[i] === 0);
  const sum = new Float64Array(bg.count + 1);
  for (let i = 0; i < a.m.length; i++) sum[bg.labels[i]!]! += score[i]!;
  let filled = 0;
  const take = new Uint8Array(bg.count + 1);
  for (let k = 1; k <= bg.count; k++) if (!bg.touchesBorder[k] && fillIt(bg.area[k]!, sum[k]! / bg.area[k]!)) take[k] = 1;
  for (let i = 0; i < a.m.length; i++) {
    if (take[bg.labels[i]!] === 1) {
      a.m[i] = 1;
      filled++;
    }
  }
  return filled;
}

/** Number of set pixels with at least one unset 4-neighbour (or on the image border). */
export function perimeter(a: Mask): number {
  let n = 0;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const i = y * a.w + x;
      if (a.m[i] === 0) continue;
      if (x === 0 || y === 0 || x === a.w - 1 || y === a.h - 1 || a.m[i - 1] === 0 || a.m[i + 1] === 0 || a.m[i - a.w] === 0 || a.m[i + a.w] === 0) n++;
    }
  }
  return n;
}

export const count = (a: Mask): number => a.m.reduce((s, v) => s + v, 0);
