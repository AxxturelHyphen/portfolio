// Test-only cutouts for the gl-look page: real archive plates (archive/raw, gitignored, local only) keyed off their
// paper in a canvas, packed into one 2048 atlas page with a normal map from luminance height plus an alpha bevel.
// This stands in for the pipeline's cutout, sprite, normal and pack stages so the look can be judged on real plates.

export interface PlateSprite { name: string; uv: [number, number, number, number]; aspect: number }
export interface PlateAtlas { color: HTMLCanvasElement; normal: HTMLCanvasElement; sprites: Record<string, PlateSprite> }

/** Source plate and its crop (fractions of the image: x, y, w, h), chosen to skip lettering and plate borders. */
interface PlateDef { name: string; file: string; crop: [number, number, number, number] }

const PLATES: PlateDef[] = [
  { name: 'hero', file: 'roses/cma_1943_139.jpg', crop: [0.12, 0.06, 0.76, 0.78] },
  { name: 'roseB', file: 'roses/cma_1943_141.jpg', crop: [0.1, 0.05, 0.8, 0.66] },
  { name: 'pompon', file: 'roses/cma_1943_142.jpg', crop: [0.1, 0.05, 0.8, 0.8] },
  { name: 'damask', file: 'roses/cma_1965_291.jpg', crop: [0.1, 0.05, 0.8, 0.8] },
  { name: 'gallica', file: 'roses/cma_1965_293.jpg', crop: [0.1, 0.05, 0.8, 0.8] },
  { name: 'rambler', file: 'roses/cma_1965_295.jpg', crop: [0.08, 0.04, 0.84, 0.82] },
  { name: 'cane', file: 'roses/cma_1955_469.jpg', crop: [0.1, 0.05, 0.8, 0.8] },
  { name: 'poppy', file: 'roses/wel_kbzakfgk.jpg', crop: [0.08, 0.06, 0.84, 0.78] },
  { name: 'buttercup', file: 'roses/wel_r9zz3hu7.jpg', crop: [0.08, 0.06, 0.84, 0.8] },
  { name: 'grass', file: 'roses/wel_g4mzdzcp.jpg', crop: [0.06, 0.05, 0.88, 0.8] },
  { name: 'thorn', file: 'roses/wel_kmsvg748.jpg', crop: [0.08, 0.05, 0.84, 0.82] },
  { name: 'ivy', file: 'roses/wel_etaatwun.jpg', crop: [0.08, 0.06, 0.84, 0.8] },
];

const PAGE = 2048;
const MAX_SIDE = 480;
const GUTTER = 12;

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`plate missing: ${src}`));
    img.src = src;
  });
}

/** Keys the paper away: distance from the paper colour (median of the crop border) plus darkness, soft threshold. */
function keyPaper(data: ImageData): void {
  const { width: w, height: h, data: px } = data;
  const border: number[][] = [[], [], []];
  for (let x = 0; x < w; x += 3) for (const y of [1, h - 2]) for (let c = 0; c < 3; c++) border[c]?.push(px[(y * w + x) * 4 + c] ?? 0);
  for (let y = 0; y < h; y += 3) for (const x of [1, w - 2]) for (let c = 0; c < 3; c++) border[c]?.push(px[(y * w + x) * 4 + c] ?? 0);
  const paper = border.map((v) => v.sort((a, b) => a - b)[v.length >> 1] ?? 240);
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4] ?? 0, g = px[i * 4 + 1] ?? 0, b = px[i * 4 + 2] ?? 0;
    const d = Math.hypot(r - (paper[0] ?? 0), g - (paper[1] ?? 0), b - (paper[2] ?? 0));
    const t = Math.min(1, Math.max(0, (d - 22) / 38));
    const a = t * t * (3 - 2 * t);
    px[i * 4 + 3] = Math.round(a * 255);
    if (a > 0.9) { sr += r; sg += g; sb += b; n++; }
  }
  // Transparent texels take the plant's mean colour, so filtering never bleeds paper into the edge.
  const mr = n > 0 ? sr / n : 100, mg = n > 0 ? sg / n : 100, mb = n > 0 ? sb / n : 100;
  for (let i = 0; i < w * h; i++) {
    const a = (px[i * 4 + 3] ?? 0) / 255;
    if (a < 0.5) { px[i * 4] = mr; px[i * 4 + 1] = mg; px[i * 4 + 2] = mb; }
  }
}

/** Normal map from a blurred luminance height inside the shape plus a bevel from the alpha edge. */
function normalOf(data: ImageData): ImageData {
  const { width: w, height: h, data: px } = data;
  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = (px[i * 4 + 3] ?? 0) / 255;
    const l = (0.3 * (px[i * 4] ?? 0) + 0.59 * (px[i * 4 + 1] ?? 0) + 0.11 * (px[i * 4 + 2] ?? 0)) / 255;
    height[i] = a * (0.6 + 0.4 * l);
  }
  const blur = new Float32Array(w * h);
  const R = 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let k = -R; k <= R; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)); s += height[y * w + xx] ?? 0; c++; }
    blur[y * w + x] = s / c;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let k = -R; k <= R; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)); s += blur[yy * w + x] ?? 0; c++; }
    height[y * w + x] = s / c;
  }
  const out = new ImageData(w, h);
  const at = (x: number, y: number): number => height[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] ?? 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 6;
    const dy = (at(x, y - 1) - at(x, y + 1)) * 6;
    const len = Math.hypot(dx, dy, 1);
    const o = (y * w + x) * 4;
    out.data[o] = Math.round((-dx / len * 0.5 + 0.5) * 255);
    out.data[o + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
    out.data[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
    out.data[o + 3] = 255;
  }
  return out;
}

export async function buildPlateAtlas(base: string): Promise<PlateAtlas> {
  const color = document.createElement('canvas');
  const normal = document.createElement('canvas');
  color.width = normal.width = PAGE;
  color.height = normal.height = PAGE;
  const cc = color.getContext('2d', { willReadFrequently: true });
  const nc = normal.getContext('2d');
  if (cc === null || nc === null) throw new Error('no 2d context');
  nc.fillStyle = 'rgb(128,128,255)';
  nc.fillRect(0, 0, PAGE, PAGE);
  const sprites: Record<string, PlateSprite> = {};
  let x = GUTTER, y = GUTTER, row = 0;
  const work = document.createElement('canvas');
  const wc = work.getContext('2d', { willReadFrequently: true });
  if (wc === null) throw new Error('no 2d context');
  for (const p of PLATES) {
    const img = await load(base + p.file);
    const [cx, cy, cw, ch] = p.crop;
    const sw = img.width * cw, sh = img.height * ch;
    const k = MAX_SIDE / Math.max(sw, sh);
    const w = Math.round(sw * k), h = Math.round(sh * k);
    if (x + w + GUTTER > PAGE) { x = GUTTER; y += row + GUTTER * 2; row = 0; }
    work.width = w;
    work.height = h;
    wc.drawImage(img, img.width * cx, img.height * cy, sw, sh, 0, 0, w, h);
    const data = wc.getImageData(0, 0, w, h);
    keyPaper(data);
    cc.putImageData(data, x, y);
    nc.putImageData(normalOf(data), x, y);
    sprites[p.name] = { name: p.name, aspect: w / h, uv: [x / PAGE, 1 - (y + h) / PAGE, (x + w) / PAGE, 1 - y / PAGE] };
    x += w + GUTTER * 2;
    row = Math.max(row, h);
  }
  return { color, normal, sprites };
}
