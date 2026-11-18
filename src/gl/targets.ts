import { LinearFilter, SRGBColorSpace, UnsignedByteType, WebGLRenderTarget } from 'three';

/** Pixel size of a buffer for a CSS size at `dpr`, scaled down uniformly so w * h stays under `pixelCap`. */
export interface PixelSize { w: number; h: number }
export function fitPixels(cssW: number, cssH: number, dpr: number, pixelCap: number, out: PixelSize): PixelSize {
  let w = Math.max(1, cssW * dpr);
  let h = Math.max(1, cssH * dpr);
  const over = (w * h) / pixelCap;
  if (over > 1) {
    const k = 1 / Math.sqrt(over);
    w *= k;
    h *= k;
  }
  out.w = Math.max(1, Math.floor(w));
  out.h = Math.max(1, Math.floor(h));
  return out;
}

/**
 * The scene target: allocated once per resize at dprMax under pixelCap. DPR changes and the panel scale only move the
 * viewport sub-rect (`setScale`), never reallocate. Colour is SRGB8_ALPHA8: shaders write linear, blending happens in
 * linear, and the film pass samples linear values back (it must encode to sRGB for the canvas). A depth buffer only
 * under free roam (`depth`): cutouts keep their paint order but write depth, so actors that move between them (the
 * carried lantern) can be drawn last with a depth test. The rail has none.
 */
export interface SceneTarget {
  readonly target: WebGLRenderTarget;
  readonly bytes: number;
  readonly scale: number;
  resize(w: number, h: number): boolean;
  setScale(k: number): void;
  dispose(): void;
}

const BYTES_PER_PIXEL = 4;
/** A 24-bit depth renderbuffer is stored in 4 bytes per pixel. */
const DEPTH_BYTES_PER_PIXEL = 4;
const MIN_SCALE = 0.25;

export function createSceneTarget(depth: boolean): SceneTarget {
  const target = new WebGLRenderTarget(1, 1, {
    colorSpace: SRGBColorSpace,
    type: UnsignedByteType,
    depthBuffer: depth,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  target.scissorTest = true;
  let scale = 1;

  const applyViewport = (): void => {
    const w = Math.max(1, Math.round(target.width * scale));
    const h = Math.max(1, Math.round(target.height * scale));
    target.viewport.set(0, 0, w, h);
    target.scissor.set(0, 0, w, h);
  };

  return {
    target,
    get bytes(): number { return target.width * target.height * (BYTES_PER_PIXEL + (depth ? DEPTH_BYTES_PER_PIXEL : 0)); },
    get scale(): number { return scale; },
    resize(w: number, h: number): boolean {
      if (w === target.width && h === target.height) return false;
      target.setSize(w, h);
      applyViewport();
      return true;
    },
    setScale(k: number): void {
      const next = k < MIN_SCALE ? MIN_SCALE : k > 1 ? 1 : k;
      if (next === scale) return;
      scale = next;
      applyViewport();
    },
    dispose(): void { target.dispose(); },
  };
}
