import { isFill, onlyFill } from '../content/herbario/html.ts';
import type { Lang, Project } from '../types.ts';

/**
 * What the project film shows and when it moves, without the DOM. A media entry with a real src becomes a frame of
 * its kind; an owner gap becomes a plate frame: an archival flower plate of its own, named by its real title, never
 * passed off as the project. A gap with no plate left stays blank film. The strip always carries at least MIN_FRAMES
 * (gaps pad it) and at most MAX_FRAMES.
 */

export type FrameKind = 'image' | 'video' | 'plate' | 'blank';

export interface Frame {
  kind: FrameKind;
  /** '' for a blank frame. */
  src: string;
  /** What a screen reader hears for the frame: a plate's real title. */
  alt: string;
  /** The plate's short name, printed on the frame; '' for every other kind. */
  caption: string;
}

/** An archive plate an owner gap shows (src/content/frames.json, written by `npm run assets frames`). */
export interface Plate {
  src: string;
  title: string;
  name: string;
}

export const MIN_FRAMES = 2;
export const MAX_FRAMES = 4;

/** Seconds a frame rests in the gate before the strip is pulled on by itself. */
export const REST_S = 6.5;
/** Milliseconds of one pull through the gate. */
export const PULL_MS = 420;

type Media = Project['media'][number];

const blank = (alt: string): Frame => ({ kind: 'blank', src: '', alt, caption: '' });

/** The frame a media entry becomes. `blankAlt` names a gap, `fallbackAlt` a real frame whose alt is a gap. */
export function frameOf(m: Media, l: Lang, blankAlt: string, fallbackAlt: string): Frame {
  if (isFill(m.src) || m.src.trim() === '') return blank(blankAlt);
  const alt = m.alt[l];
  return { kind: m.type, src: m.src, alt: onlyFill(alt) || alt.trim() === '' ? fallbackAlt : alt, caption: '' };
}

/** The strip: real media first as given, gaps padded to MIN_FRAMES, each gap given the next plate while any are left. */
export function framesOf(p: Pick<Project, 'media' | 'title'>, l: Lang, blankAlt: string, plates: readonly Plate[]): Frame[] {
  const out = p.media.slice(0, MAX_FRAMES).map((m) => frameOf(m, l, blankAlt, p.title));
  while (out.length < MIN_FRAMES) out.push(blank(blankAlt));
  let next = 0;
  return out.map((f) => {
    const plate = f.kind === 'blank' ? plates[next++] : undefined;
    return plate === undefined ? f : { kind: 'plate', src: plate.src, alt: plate.title, caption: plate.name };
  });
}

/** The index one step on, wrapping at both ends. */
export const stepOf = (i: number, n: number, dir: 1 | -1): number => (((i + dir) % n) + n) % n;

/** How the film may move under the visitor's settings and the page's mode. */
export interface Motion {
  /** The strip is pulled on by itself after REST_S. */
  auto: boolean;
  /** A change of frame slides with a gate weave; false: it changes at once. */
  pull: boolean;
}

/** Reduced motion: no auto-advance, no weave, frames change at once. Frozen time and stills: no auto-advance. */
export function motionOf(reduced: boolean, still: boolean): Motion {
  return { auto: !reduced && !still, pull: !reduced && !still };
}

/** Whether the film runs on by itself right now. */
export function runs(m: Motion, shown: boolean, held: boolean, stopped: boolean, hidden: boolean): boolean {
  return m.auto && shown && !held && !stopped && !hidden;
}
