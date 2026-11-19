/**
 * The garden's recordings: one shipped file per archive source (public/audio/<source id>.webm, Opus, mono), cut,
 * filtered and levelled by the sound stage of npm run assets from archive/raw/textures/audio/. The same table tells
 * the stage what to cut and the engine (audio/engine.ts) where each clip sits in its file, so the two never drift.
 * A loop is one stretch with its tail crossfaded into its head, so it repeats without a seam. A set is several short
 * clips packed one after another with a short silence between them, so one fetch and one decode serve them all.
 */

export type SoundId = 'crickets' | 'water' | 'nightingale' | 'owl' | 'winding' | 'musicbox';

export interface SoundRecipe {
  /** The archive source id; also the shipped file's base name, which is how the licence check finds it. */
  source: string;
  /** The raw file under archive/raw/textures/audio/. */
  raw: string;
  /** Stretches of the raw file in seconds, [start, end]. A loop has exactly one. */
  cuts: readonly (readonly [number, number])[];
  /** Seconds of the loop's tail crossfaded into its head (loops only). */
  loopFade?: number;
  /** Band kept, in Hz: high-pass and low-pass corners. */
  band: readonly [number, number];
  /** Levelling: a bed to this mean level, a one-shot set to this peak (dBFS). */
  level: { mean: number } | { peak: number };
  kbps: number;
}

export const AUDIO_DIR = 'audio';
/** Silence between the clips of a set (seconds). */
export const CLIP_GAP_S = 0.5;
/** Fade at each clip's edges (seconds): a cut never clicks. */
export const CLIP_FADE_S = { in: 0.04, out: 0.25 } as const;

export const SOUNDS: Readonly<Record<SoundId, SoundRecipe>> = {
  crickets: {
    source: 'ia-aporee-24288-crickets-colchester',
    raw: 'ia-aporee-24288-crickets-colchester.mp3',
    cuts: [[60, 96]],
    loopFade: 4,
    band: [380, 12000],
    level: { mean: -26 },
    kbps: 40,
  },
  water: {
    source: 'ia-aporee-58600-spring-source-grzybowska',
    raw: 'ia-aporee-58600-spring-source-grzybowska.mp3',
    cuts: [[20, 50]],
    loopFade: 3,
    band: [120, 5000],
    level: { mean: -24 },
    kbps: 32,
  },
  nightingale: {
    source: 'ia-nightingale-song-may-2012',
    raw: 'ia-nightingale-song-may-2012.mp3',
    cuts: [[44.2, 48.2], [52.2, 56.3], [71.7, 74.6], [159.8, 162.1], [190.1, 192.8]],
    band: [900, 12000],
    level: { peak: -3 },
    kbps: 40,
  },
  owl: {
    source: 'ia-aporee-60828-long-eared-owl-utena',
    raw: 'ia-aporee-60828-long-eared-owl-utena.flac',
    cuts: [[45.1, 46.4], [63.4, 64.5]],
    band: [400, 8000],
    level: { peak: -4 },
    kbps: 32,
  },
  winding: {
    source: 'wc-winding-a-music-box',
    raw: 'wc-winding-a-music-box.ogg',
    cuts: [[0.1, 3.3]],
    band: [150, 12000],
    level: { peak: -6 },
    kbps: 32,
  },
  musicbox: {
    source: 'wc-musicbox-wound-clock-schlafe-prinzchen',
    raw: 'wc-musicbox-wound-clock-schlafe-prinzchen.ogg',
    cuts: [[65.9, 84.6]],
    band: [180, 14000],
    level: { peak: -3 },
    kbps: 56,
  },
};

export const fileOf = (id: SoundId): string => `${AUDIO_DIR}/${SOUNDS[id].source}.webm`;

/** Length of a loop as shipped: its stretch minus the tail folded into the head. */
export function loopLength(r: SoundRecipe): number {
  const [cut] = r.cuts;
  return cut === undefined ? 0 : cut[1] - cut[0] - (r.loopFade ?? 0);
}

/** Where each clip of a set starts in the shipped file and how long it lasts (seconds). */
export function clipsOf(r: SoundRecipe): { at: number; dur: number }[] {
  let at = 0;
  return r.cuts.map(([a, b]) => {
    const clip = { at, dur: b - a };
    at += b - a + CLIP_GAP_S;
    return clip;
  });
}
