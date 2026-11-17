import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBA_ASTC_4x4_Format,
  RGBA_BPTC_Format,
  RGBA_ETC2_EAC_Format,
  RGBA_PVRTC_2BPPV1_Format,
  RGBA_PVRTC_4BPPV1_Format,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT5_Format,
  RGB_ETC1_Format,
  RGB_ETC2_Format,
  RGB_PVRTC_2BPPV1_Format,
  RGB_PVRTC_4BPPV1_Format,
  RGB_S3TC_DXT1_Format,
  SRGBColorSpace,
  Texture,
} from 'three';
import type { CompressedTexture, WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { AtlasManifest, AtlasTextures, Gfx } from '../types.ts';

/**
 * Atlas loading: KTX2 (Basis Universal, transcoded in workers by three's KTX2Loader) with a PNG/WebP fallback so
 * flat placeholders work before any .ktx2 exists. Atlas file names in a manifest are relative to `./atlas/`;
 * the transcoder is served from `./basis/` (both under the relative base). Textures are returned NOT uploaded:
 * the residency calls `uploadTexture` once per frame, which also does the byte accounting.
 */
const ATLAS_DIR = 'atlas/';
const BASIS_DIR = 'basis/';
const WORKERS = 2;

/** Bits per pixel of a GPU format; everything uncompressed here is RGBA8. */
const BPP = new Map<number, number>([
  [RGBA_BPTC_Format, 8], [RGBA_ASTC_4x4_Format, 8], [RGBA_ETC2_EAC_Format, 8], [RGBA_S3TC_DXT5_Format, 8],
  [RGB_ETC1_Format, 4], [RGB_ETC2_Format, 4], [RGB_S3TC_DXT1_Format, 4], [RGBA_S3TC_DXT1_Format, 4],
  [RGB_PVRTC_4BPPV1_Format, 4], [RGBA_PVRTC_4BPPV1_Format, 4], [RGB_PVRTC_2BPPV1_Format, 2], [RGBA_PVRTC_2BPPV1_Format, 2],
]);
const RGBA8_BPP = 32;

type Kind = 'color' | 'normal';

let loader: KTX2Loader | null = null;
let residentBytes = 0;
const uploaded = new WeakMap<Texture, number>();

function ktx2(renderer: WebGLRenderer): KTX2Loader {
  if (loader === null) {
    const base = new URL(BASIS_DIR, document.baseURI).href;
    loader = new KTX2Loader().setTranscoderPath(base).setWorkerLimit(WORKERS).detectSupport(renderer);
  }
  return loader;
}

/** Resolves an atlas file name from a manifest against `./atlas/` under the document base. */
export function atlasUrl(name: string): string {
  return new URL(name, new URL(ATLAS_DIR, document.baseURI)).href;
}

/** GPU bytes of a texture from its size and format: w * h * bpp / 8, times 4/3 with mipmaps. */
export function textureBytes(tex: Texture): number {
  const image = tex.image as { width?: number; height?: number } | null;
  const w = image?.width ?? 0;
  const h = image?.height ?? 0;
  const compressed = (tex as Partial<CompressedTexture>).isCompressedTexture === true;
  const bpp = compressed ? (BPP.get(tex.format) ?? RGBA8_BPP) : RGBA8_BPP;
  const mips = compressed ? (tex.mipmaps?.length ?? 1) > 1 : tex.generateMipmaps;
  return Math.ceil(((w * h * bpp) / 8) * (mips ? 4 / 3 : 1));
}

/** Sum of the bytes of every texture uploaded through `uploadTexture` and not yet disposed. */
export function residentTextureBytes(): number {
  return residentBytes;
}

function onTextureDispose(event: { target: Texture }): void {
  const bytes = uploaded.get(event.target);
  if (bytes === undefined) return;
  uploaded.delete(event.target);
  residentBytes -= bytes;
  event.target.removeEventListener('dispose', onTextureDispose);
}

/** Uploads now (never on first draw) and counts the bytes until the texture is disposed. */
export function uploadTexture(gfx: Gfx, tex: Texture): number {
  gfx.renderer.initTexture(tex);
  if (uploaded.has(tex)) return 0;
  const bytes = textureBytes(tex);
  uploaded.set(tex, bytes);
  residentBytes += bytes;
  tex.addEventListener('dispose', onTextureDispose);
  return bytes;
}

function parseKtx2(renderer: WebGLRenderer, buffer: ArrayBuffer): Promise<CompressedTexture> {
  return new Promise((resolve, reject) => ktx2(renderer).parse(buffer, resolve, reject));
}

async function decodeImage(blob: Blob): Promise<Texture> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const tex = new Texture(bitmap);
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Bytes of atlas files fetched ahead (by file name). Each entry is taken once: the transcoder may detach it. */
export type PrefetchedPages = Map<string, ArrayBuffer>;

async function bytesOf(name: string, signal: AbortSignal, prefetched: PrefetchedPages | undefined): Promise<ArrayBuffer> {
  const held = prefetched?.get(name);
  if (held !== undefined) {
    prefetched?.delete(name);
    return held;
  }
  const response = await fetch(atlasUrl(name), { signal });
  if (!response.ok) throw new Error(`atlas ${name}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

/** Decodes one atlas page image, fetching it unless its bytes were prefetched. Colour is sampled as sRGB, normals as
 * linear data. No GPU work. */
export async function loadTexture(gfx: Gfx, name: string, kind: Kind, signal: AbortSignal, prefetched?: PrefetchedPages): Promise<Texture> {
  const bytes = await bytesOf(name, signal, prefetched);
  const tex = name.endsWith('.ktx2') ? await parseKtx2(gfx.renderer, bytes) : await decodeImage(new Blob([bytes]));
  if (signal.aborted) {
    tex.dispose();
    throw signal.reason;
  }
  tex.flipY = false;
  tex.colorSpace = kind === 'color' ? SRGBColorSpace : NoColorSpace;
  tex.magFilter = LinearFilter;
  tex.name = name;
  return tex;
}

/** Every page of a manifest, colour and normal, in page order. `gpuBytes` is what the upload will cost. */
export async function loadAtlas(gfx: Gfx, m: AtlasManifest, variant: 'hi' | 'lo', signal: AbortSignal, prefetched?: PrefetchedPages): Promise<AtlasTextures> {
  const settled = await Promise.allSettled(m.pages.flatMap((page) => [
    loadTexture(gfx, page.color[variant], 'color', signal, prefetched),
    loadTexture(gfx, page.normal[variant], 'normal', signal, prefetched),
  ]));
  const failed = settled.find((r) => r.status === 'rejected');
  if (failed !== undefined) {
    for (const r of settled) if (r.status === 'fulfilled') r.value.dispose();
    throw failed.reason;
  }
  const textures = settled.map((r) => (r as PromiseFulfilledResult<Texture>).value);
  const color = textures.filter((_, i) => i % 2 === 0);
  const normal = textures.filter((_, i) => i % 2 === 1);
  const gpuBytes = textures.reduce((sum, t) => sum + textureBytes(t), 0);
  return { color, normal, gpuBytes };
}
