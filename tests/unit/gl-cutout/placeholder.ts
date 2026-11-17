// Flat placeholder atlas for the gl-cutout test page: four procedural shapes in a 2 x 2 page (512 px, 8 px gutter),
// with a matching half-size normal map from the shape's height field. Encoded as PNG blob URLs, so the page also
// exercises the PNG fallback of src/gl/ktx2.ts.

type Height = (x: number, y: number) => number; // x, y in -1..1 (y up); > 0 inside

export interface PlaceholderSprite { uv: [number, number, number, number]; aspect: number; tint: [number, number, number] }

const PAGE = 512;
const CELL = PAGE / 2;
const GUTTER = 8;

const bloom: Height = (x, y) => {
  const r = Math.hypot(x, y);
  const edge = 0.62 + 0.3 * Math.abs(Math.cos(Math.atan2(y, x) * 3));
  return 1 - r / edge;
};
const leaf: Height = (x, y) => 1 - Math.hypot(x / (0.55 * (1 - y * y) + 0.02), y / 0.95);
const tuft: Height = (x, y) => {
  let best = -1;
  for (let k = -2; k <= 2; k++) {
    const lean = k * 0.18 * (y + 1);
    const width = 0.12 * (1 - (y + 1) / 2) + 0.01;
    best = Math.max(best, 1 - Math.abs(x - lean - k * 0.08) / width - Math.max(0, y - (0.9 - Math.abs(k) * 0.25)) * 8);
  }
  return best;
};
const pod: Height = (x, y) => 1 - Math.hypot(x / 0.8, (y + 0.1) / 0.7);

const SHAPES: { h: Height; tint: [number, number, number]; aspect: number }[] = [
  { h: bloom, tint: [0.95, 0.55, 0.62], aspect: 1 },
  { h: leaf, tint: [0.32, 0.62, 0.48], aspect: 0.7 },
  { h: tuft, tint: [0.5, 0.66, 0.42], aspect: 0.8 },
  { h: pod, tint: [0.92, 0.76, 0.42], aspect: 1 },
];

export const SPRITES: PlaceholderSprite[] = SHAPES.map((s, i) => {
  const cx = (i % 2) * CELL + GUTTER;
  const cy = Math.floor(i / 2) * CELL + GUTTER;
  return { uv: [cx / PAGE, cy / PAGE, (cx + CELL - 2 * GUTTER) / PAGE, (cy + CELL - 2 * GUTTER) / PAGE], aspect: s.aspect, tint: s.tint };
});

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function paint(size: number, write: (d: Uint8ClampedArray, o: number, h: Height, x: number, y: number, eps: number) => void): ImageData {
  const img = new ImageData(size, size);
  const cell = size / 2;
  const gutter = (GUTTER * size) / PAGE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = Math.floor(px / cell) + 2 * Math.floor(py / cell);
      const shape = SHAPES[i];
      if (shape === undefined) continue;
      const inner = cell - 2 * gutter;
      const x = ((px % cell) - gutter + 0.5) / inner * 2 - 1;
      const y = 1 - ((py % cell) - gutter + 0.5) / inner * 2;
      write(img.data, (py * size + px) * 4, shape.h, x / shape.aspect, y, 2 / inner);
    }
  }
  return img;
}

async function toUrl(img: ImageData): Promise<string> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2d context');
  ctx.putImageData(img, 0, 0);
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
}

export async function drawPlaceholderAtlas(): Promise<{ color: string; normal: string }> {
  const color = paint(PAGE, (d, o, h, x, y, eps) => {
    const v = h(x, y);
    const a = clamp01(v / (eps * 2) + 0.5);
    const shade = 0.78 + 0.22 * clamp01(v * 2);
    const vein = 1 - 0.12 * Math.exp(-Math.abs(x) * 40);
    // Colour bled into the gutter (alpha 0) so mip filtering never darkens the edge.
    d[o] = 255 * shade * vein; d[o + 1] = 255 * shade * vein; d[o + 2] = 255 * shade * vein; d[o + 3] = 255 * a;
  });
  const normal = paint(PAGE / 2, (d, o, h, x, y, eps) => {
    const e = eps * 2;
    const dx = (Math.max(h(x + e, y), 0) - Math.max(h(x - e, y), 0)) / (2 * e);
    const dy = (Math.max(h(x, y + e), 0) - Math.max(h(x, y - e), 0)) / (2 * e);
    const k = 0.35;
    const len = Math.hypot(dx * k, dy * k, 1);
    d[o] = ((-dx * k) / len * 0.5 + 0.5) * 255; d[o + 1] = ((-dy * k) / len * 0.5 + 0.5) * 255; d[o + 2] = (1 / len * 0.5 + 0.5) * 255; d[o + 3] = 255;
  });
  return { color: await toUrl(color), normal: await toUrl(normal) };
}
