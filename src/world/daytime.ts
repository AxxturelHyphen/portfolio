/**
 * The garden's day (pure, no three, no DOM): an hour (0..24, wrapping) to one palette that holds everything the light
 * needs. Keyframes sit on the hour axis and are eased with a smoothstep between neighbours, so the light is continuous
 * across 24 -> 0. Colours are linear RGB. The night keyframe is the lantern night the garden had before it had a day:
 * at night `place` is 1 and every place keeps its own sky, ambient and shadow (garden/place.ts), so a pinned night frame
 * is the old frame. The real-time pace of the hour lives in core/motion.ts (DAY).
 */
import { toLinear } from '../gl/colour.ts';

export type Rgb = [number, number, number];

export interface DayPalette {
  skyTop: Rgb;
  skyHorizon: Rgb;
  /** The sky's fill from above (uAmbient); the top of the hemisphere takes 1.25 of it. */
  ambient: Rgb;
  /** The warm bounce from the ground on faces turned down (uBounce); 0.8 of the ambient at night. */
  bounce: Rgb;
  shadow: Rgb;
  haze: Rgb;
  hazeDensity: number;
  /** The key light: the sun by day, the moon by night. Colour (with its strength) and the direction it comes from. */
  key: Rgb;
  keyDir: Rgb;
  rim: Rgb;
  /** How much each place keeps its own night colours (1 at night, 0 by day). */
  place: number;
  /** 0 at night, 1 in full day: the hue the paper keeps, the night closing in round the visitor, the ground's daylight. */
  day: number;
  /** Signed shadow map strength: above 0 the sun's map, below 0 the carried lantern's; it crosses zero at dusk and dawn. */
  shadowSide: number;
  /** The lanterns' pools on the ground and the paper (their flames always show). */
  lampPool: number;
  /** The project flowers' own warm pools. */
  invite: number;
  fireflies: number;
  /** Stars and the moon in the sky. */
  nightSky: number;
  /** The warm afterglow low on the sun's side of the sky, round sunrise and sunset. */
  glow: number;
  /** The sun disc in the sky and where it hangs: azimuth in degrees (negative is left) and elevation as a share of
   * the moon's, which each place hangs where its frame shows it, so the sun stays in view. */
  sunDisc: number;
  sunAz: number;
  sunEl: number;
}

/** The linear colour of an sRGB hex, scaled by `k`. Load time only. */
export function linearOf(hex: string, k = 1): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [toLinear(((n >> 16) & 255) / 255) * k, toLinear(((n >> 8) & 255) / 255) * k, toLinear((n & 255) / 255) * k];
}

function unit(x: number, y: number, z: number): Rgb {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

interface Key { hour: number; p: DayPalette }

/**
 * The lantern night: the free-roam constants of gl/lights.ts (moon key #b3aacb x 1.15, rim #c9c4d8 x 0.65, roam haze
 * #2a2940 at 0.03, lamp #f8a946 x 5.8, invites #f5c584 x 5.0, fireflies #ffb766 x 1.4 as gains of 1) and the Rosaleda
 * roam dusk of garden/place.ts (sky #141a46 / #3f528a, ambient #424554, shadow #261e3d).
 */
export const NIGHT: DayPalette = {
  skyTop: linearOf('#141a46'),
  skyHorizon: linearOf('#3f528a'),
  ambient: linearOf('#424554'),
  bounce: linearOf('#424554', 0.8),
  shadow: linearOf('#261e3d'),
  haze: linearOf('#2a2940'),
  hazeDensity: 0.03,
  key: linearOf('#b3aacb', 1.15),
  keyDir: unit(-0.35, 0.8, 0.5),
  rim: linearOf('#c9c4d8', 0.65),
  place: 1,
  day: 0,
  shadowSide: -1,
  lampPool: 1,
  invite: 1,
  fireflies: 1,
  nightSky: 1,
  glow: 0,
  sunDisc: 0,
  sunAz: -30,
  sunEl: -0.5,
};

/** Dawn: a cool lilac sky going to apricot low down, the sun just up on the right, the lanterns burning low. */
const DAWN: DayPalette = {
  skyTop: linearOf('#4a5d93'),
  skyHorizon: linearOf('#e3b49a'),
  ambient: linearOf('#6f7590'),
  bounce: linearOf('#5d5048'),
  shadow: linearOf('#463a58'),
  haze: linearOf('#b8a8b0'),
  hazeDensity: 0.012,
  key: linearOf('#f6c9a0', 1.5),
  keyDir: unit(0.75, 0.3, 0.45),
  rim: linearOf('#f0c8a8', 0.5),
  place: 0.15,
  day: 0.65,
  shadowSide: 0.25,
  lampPool: 0.3,
  invite: 0.4,
  fireflies: 0,
  nightSky: 0.15,
  glow: 0.6,
  sunDisc: 0.9,
  sunAz: 26,
  sunEl: 0.45,
};

/** Day: a storybook blue with a warm pale band over the wall, a warm high sun from the upper left, blue shade. */
const DAY: DayPalette = {
  skyTop: linearOf('#3a76c4'),
  skyHorizon: linearOf('#8fb6dc'),
  ambient: linearOf('#6f7f9c'),
  bounce: linearOf('#806a48'),
  shadow: linearOf('#4a4048'),
  haze: linearOf('#a9b8c8'),
  hazeDensity: 0.006,
  key: linearOf('#ffeccb', 2.3),
  keyDir: unit(-0.5, 0.72, 0.5),
  rim: linearOf('#fff4dc', 0.35),
  place: 0,
  day: 1,
  shadowSide: 0.85,
  lampPool: 0.04,
  invite: 0.22,
  fireflies: 0,
  nightSky: 0,
  glow: 0,
  sunDisc: 1,
  sunAz: -22,
  sunEl: 0.95,
};

/** Golden hour: honey light low from the left, a peach horizon under a deepening blue, long soft shadows. */
const GOLDEN: DayPalette = {
  skyTop: linearOf('#5a7fb8'),
  skyHorizon: linearOf('#e6cdb0'),
  ambient: linearOf('#7a7c9a'),
  bounce: linearOf('#8a6038'),
  shadow: linearOf('#4a3e52'),
  haze: linearOf('#c8bfb4'),
  hazeDensity: 0.01,
  key: linearOf('#ffdcab', 2.0),
  keyDir: unit(-0.75, 0.4, 0.42),
  rim: linearOf('#ffd7a0', 0.55),
  place: 0,
  day: 0.95,
  shadowSide: 0.75,
  lampPool: 0.06,
  invite: 0.28,
  fireflies: 0,
  nightSky: 0,
  glow: 0.35,
  sunDisc: 1,
  sunAz: -20,
  sunEl: 0.6,
};

/** Dusk: the sun gone under the wall, a rose and amber afterglow under violet, the lanterns coming up. */
const DUSK: DayPalette = {
  skyTop: linearOf('#262a66'),
  skyHorizon: linearOf('#b98580'),
  ambient: linearOf('#5a5878'),
  bounce: linearOf('#5a4038'),
  shadow: linearOf('#2e2650'),
  haze: linearOf('#6a5a78'),
  hazeDensity: 0.026,
  key: linearOf('#e8a07a', 0.9),
  keyDir: unit(-0.82, 0.3, 0.2),
  rim: linearOf('#e8b4a0', 0.6),
  place: 0.35,
  day: 0.4,
  shadowSide: -0.35,
  lampPool: 0.65,
  invite: 0.75,
  fireflies: 0.6,
  nightSky: 0.35,
  glow: 0.7,
  sunDisc: 0,
  sunAz: -40,
  sunEl: -0.25,
};

/**
 * Hours on the 24 h axis, at the real-time pace of core/motion.ts DAY (2.4 h a minute): daylight 7.2 to 16.8, dusk to
 * 19.2, night to 4.8, dawn to 7.2. Night is held from 19.8 to 4.4.
 */
const KEYS: readonly Key[] = [
  { hour: 4.4, p: NIGHT },
  { hour: 6.0, p: DAWN },
  { hour: 8.4, p: DAY },
  { hour: 12.6, p: DAY },
  { hour: 15.8, p: GOLDEN },
  { hour: 18.0, p: DUSK },
  { hour: 19.8, p: NIGHT },
];

export const wrapHour = (h: number): number => ((h % 24) + 24) % 24;

function blend3(out: Rgb, a: Rgb, b: Rgb, k: number): void {
  out[0] = a[0] + (b[0] - a[0]) * k;
  out[1] = a[1] + (b[1] - a[1]) * k;
  out[2] = a[2] + (b[2] - a[2]) * k;
}

const RGB_FIELDS = ['skyTop', 'skyHorizon', 'ambient', 'bounce', 'shadow', 'haze', 'key', 'keyDir', 'rim'] as const;
const NUM_FIELDS = ['hazeDensity', 'place', 'day', 'shadowSide', 'lampPool', 'invite', 'fireflies', 'nightSky', 'glow', 'sunDisc', 'sunAz', 'sunEl'] as const;

/** A fresh palette to write into (load time). */
export function createPalette(): DayPalette {
  const p = { ...NIGHT };
  for (const f of RGB_FIELDS) p[f] = [...NIGHT[f]];
  return p;
}

/** Writes the palette of `hour` into `out`. No allocation. */
export function paletteAt(hour: number, out: DayPalette): DayPalette {
  const h = wrapHour(hour);
  let i = KEYS.length - 1;
  for (let j = 0; j < KEYS.length; j++) if (KEYS[j]!.hour <= h) i = j;
  const a = KEYS[i]!;
  const b = KEYS[(i + 1) % KEYS.length]!;
  const span = wrapHour(b.hour - a.hour);
  const t = span === 0 ? 0 : wrapHour(h - a.hour) / span;
  const k = t * t * (3 - 2 * t);
  for (let f = 0; f < RGB_FIELDS.length; f++) {
    const name = RGB_FIELDS[f]!;
    blend3(out[name], a.p[name], b.p[name], k);
  }
  for (let f = 0; f < NUM_FIELDS.length; f++) {
    const name = NUM_FIELDS[f]!;
    out[name] = a.p[name] + (b.p[name] - a.p[name]) * k;
  }
  const d = out.keyDir;
  const l = Math.hypot(d[0], d[1], d[2]);
  d[0] /= l;
  d[1] /= l;
  d[2] /= l;
  return out;
}
