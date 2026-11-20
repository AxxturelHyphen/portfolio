/// <reference types="node" />
// Recipes: archive/recipes/<atlas>.json, the cut and pack plan from cook/ART.md section 5. One recipe per atlas
// ('shared' or a bed id); each page is one depth band and lists the sprite jobs packed on it. Plate options (cut
// method, working resolution, regions cleared before keying) are per source id and shared by every job of a plate.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AtlasManifest, BloomDef, SpriteId } from '../../src/types.ts';
import { readJson } from './common.ts';
import type { Engrave } from './engrave.ts';
import type { Polygon } from './jobmatte.ts';

/** x0, y0, x1, y1 as fractions of the plate (ART crop convention). */
export type Box4 = [number, number, number, number];

/** Long side in px: a named class from ART section 5, 'native' (the cut's own resolution) or an exact number. */
export type SizeClass = 'small' | 'medium' | 'large' | 'hero' | 'native' | number;
export const CLASS_PX = { small: 256, medium: 512, large: 1024, hero: 2048 } as const;

/** Treatment codes of cook/ART.md: PK paper key, INK ink as alpha plus one wash, MASK flat silhouette. */
export type Treat = 'PK' | 'INK' | 'MASK';

/** Which pixels a tint touches, by hue in OKLab (soft masks, never hard edges). */
export type HueSel = 'all' | 'pink' | 'green' | 'pale' | 'warm';

export interface Tint {
  /** Gradient map shade, mid, light: luminance of the selected pixels mapped onto this ramp. */
  gm?: [string, string, string];
  /** Hue and chroma pulled toward this colour, value kept. */
  toward?: string;
  /** Blend of the re-tint with the plate, 0..1. */
  amount?: number;
  /** Ceiling on HSL saturation, 0..1, applied to the selected pixels. */
  sat?: number;
  /** How far value follows the gradient map, 0..1 (default 0.5: the plate's light and dark mostly kept). */
  value?: number;
  hue?: HueSel;
}

/** A painted-out box: everything, only what is not green (a flower off a plant), only what is green (leaves and
 * stems off a flower), or replaced by the plate's own texture from a box `clone` fractions to the side. */
export interface Removal { box: Box4; keep?: 'green' | 'nongreen'; clone?: [number, number]; fill?: string; /** Round-headed (an arch): the top of the box is a half ellipse. */ arch?: boolean }

export interface Job {
  id: SpriteId;
  source: string;
  crop: Box4;
  size: SizeClass;
  /** World height in metres at scale 1 (or width with `w`); with neither, the plate's `plateH` scale is used. */
  h?: number;
  w?: number;
  /** Pivot as a fraction, y up. Default: the lowest opaque point (pedicel, foot), at y 0. */
  pivot?: [number, number];
  treat?: Treat;
  /** Painted-out parts: whole box, or only the non-green pixels in it (flowers cut off a plant). */
  remove?: Removal[];
  /** Keep only the largest connected part inside the crop (drops neighbours that reach in). */
  largest?: boolean;
  /** Keep only whole parts: leaves and sprays the crop box cuts through are dropped (stems severed by an opening
   * of this many px first), so no part ends in a straight cut. */
  whole?: number;
  /** INK: drop components whose box is shorter than this share of the crop (lettering between the rings). */
  minExtent?: number;
  tint?: Tint[];
  /** Hand-tinted print pass for a photograph: soft tone steps, line screen, warm gradient map, chalk grain. */
  engrave?: Engrave;
  /** INK: line colour, wash colour and wash opacity. MASK: flat colour and baked blur in px. */
  ink?: { line: string; wash: string; washAlpha: number };
  mask?: { color: string; blur: number; luma?: [number, number]; close?: number };
  /** Pressed-paper normal: a wider bevel for big shapes, a finer one for engravings. */
  bevel?: number;
  flip?: boolean;
  /** Rotation in degrees applied before trimming (re-poses a part; ART "warps"). */
  rotate?: number;
  /** Mild warp for petal variants: horizontal shear and vertical squash, both small. */
  warp?: [number, number];
  /** Salient-object ML matte on this crop alone (plates on a painted ground; the plate's method is 'raw'). */
  ml?: boolean;
  /** Hand garbage matte: keep only what lies inside this polygon of plate fractions (feathered). */
  matte?: Polygon;
  /** Guide polygon for a dark animal on a green ground: the edge is keyed by colour inside a band of `band` px. */
  guide?: { poly: Polygon; band: number };
  /** LK: light figure on a dark ground, alpha from luminance lo (gone) to hi (opaque). */
  lumaKey?: [number, number];
  /** Code-drawn instead of cut: the source only supplies the stock texture (the [FILL] paper-cut Coupé). */
  drawn?: 'paper-car' | 'pin';
}

/** A bloom whose poses are separate drawings (lily, pod, bud): frames listed by pose, duplicates are held poses. */
export interface Sequence { id: string; kind: BloomDef['kind']; frames: SpriteId[]; rest: BloomDef['rest'] }

/** Bloom frames composited from nested layers of one drawing (cook/ART.md section 3.5). */
export interface BloomLayers {
  id: string;
  /** Sprite ids of the drawn stages, poses 0 up to the first layered pose. */
  stages: SpriteId[];
  /** The full-bloom job; its layers become the last three poses. */
  full: Job;
  /** Radius of the middle ring as a fraction of the bloom radius; the cut snaps to petal edges. */
  ring: number;
  /** Prefix of the three layered frames: <prefix>-7, -8, -9 (heart and middle, guards tucked, the plate). */
  prefix: string;
  kind: BloomDef['kind'];
  rest: BloomDef['rest'];
}

export interface PlateOpts {
  /** Working long side of the cut; raise it for 'native' parts. */
  side?: number;
  /** 'raw': no key at all, the plate stays opaque (dark aquatint masses keyed later by luminance in MASK). */
  method?: 'classical' | 'ml' | 'raw';
  /** Why the method was forced, logged in the source's edits. */
  why?: string;
  /** Regions cleared before keying (captions, plate numbers). */
  drop?: Box4[];
  /** Metres per plate height, for parts that keep the plate's own scale (bloom stages). */
  plateH?: number;
}

export interface Recipe {
  atlas: AtlasManifest['id'];
  plates: Record<string, PlateOpts>;
  pages: { band: string; jobs: Job[]; blooms?: BloomLayers[]; sequences?: Sequence[]; flags?: FlagJob }[];
  /** Repeat-wrapped textures, each packed as a page of its own after the band pages. */
  tiles?: TileJob[];
}

/** A tileable ground or wall texture through the plate pass: a page of its own, repeat-wrapped at runtime. */
export interface TileJob {
  id: SpriteId;
  source: string;
  /** Poly Haven normal map that is kept for relighting. */
  normalFile?: string;
  size: number;
  /** World metres one tile covers. */
  metres: number;
  /** Gradient map shade, mid, light. */
  gm: [string, string, string];
  /** Line pitch of the engraver's screen in mm of world. */
  pitchMm: number;
  /** Plain stock (paper, card, metal): resized and graded only, no line screen. */
  stock?: boolean;
  /** Extra softening of the photo's detail before the tone steps, px (busy stone reads calmer). */
  soft?: number;
}

/** Single flagstones cut along the joints of a stone path photo, then through the plate pass. */
export interface FlagJob { prefix: string; source: string; count: number; size: number; metres: number; gm: [string, string, string]; pitchMm: number }

export const RECIPE_DIR = 'archive/recipes';

export function readRecipes(): Recipe[] {
  if (!existsSync(RECIPE_DIR)) return [];
  return readdirSync(RECIPE_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const r = readJson<Recipe>(join(RECIPE_DIR, f));
    if (typeof r.atlas !== 'string' || !Array.isArray(r.pages)) throw new Error(`${RECIPE_DIR}/${f}: needs atlas and pages`);
    return r;
  });
}

/** Every page's sprite ids in a recipe, in page order (jobs, bloom frames and stages, tiles, flags). */
export function recipePageIds(r: Recipe): SpriteId[][] {
  return r.pages.map((p) => [
    ...p.jobs.map((j) => j.id),
    ...(p.blooms ?? []).flatMap((b) => [`${b.prefix}-7`, `${b.prefix}-8`, `${b.prefix}-9`]),
    ...(p.flags === undefined ? [] : Array.from({ length: p.flags.count }, (_, k) => `${p.flags!.prefix}-${k + 1}`)),
  ]);
}

export const hexRgb = (hex: string): [number, number, number] => {
  const v = Number.parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
