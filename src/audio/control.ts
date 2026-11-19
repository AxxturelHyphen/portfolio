import type { SoundEngine } from './engine.ts';

/**
 * When the garden may sound (no Web Audio in here, so it is cheap to load and easy to test). Browsers let sound start
 * only from a gesture, so nothing is made before one: the first walk, tap or key in the garden, with sound on and the
 * tab shown, makes the one AudioContext inside that gesture and loads the engine, which fades in over FADE_IN_S.
 * Turning sound off, leaving for the Herbario or hiding the tab fades the mix out and suspends the context, so it
 * costs nothing; coming back resumes it (a browser that wants a fresh gesture for that gets one from the next tap).
 * The sound tag's own clicks are not gestures here: the tag decides with SOUND_EVENT (audio/pref.ts).
 */

export const FADE_IN_S = 2;
const FADE_OUT_S = 0.4;
/** While a project is open the garden steps back to this share of its level. */
const DUCK = 0.5;

export type ContextLike = Pick<BaseAudioContext, 'state'> & { resume(): Promise<void>; suspend(): Promise<void> };

export interface SoundDeps<C extends ContextLike> {
  /** Where gestures are heard (window). */
  target: EventTarget;
  /** The document: its visibility. */
  doc: EventTarget & { readonly hidden: boolean };
  /** The visitor's choice when the garden starts. */
  on: boolean;
  /** Makes the context; null where Web Audio is missing. */
  makeContext(): C | null;
  loadEngine(ctx: C): Promise<SoundEngine>;
  /** A gesture on this target is not one for sound (the sound tag). */
  ignore(t: EventTarget | null): boolean;
}

export interface SoundControl {
  setOn(on: boolean): void;
  /** The garden is the mode shown (the Herbario is silent). */
  setGarden(shown: boolean): void;
  /** A project is open over the garden. */
  setDuck(duck: boolean): void;
  /** The visitor stands at (x, z). */
  hear(x: number, z: number): void;
  /** The music box was activated. */
  musicBox(): void;
}

const GESTURES = ['pointerup', 'keydown'] as const;

export function createSoundControl<C extends ContextLike>(d: SoundDeps<C>): SoundControl {
  let on = d.on;
  let garden = false;
  let duck = false;
  let ctx: C | null = null;
  let engine: SoundEngine | null = null;
  let boxWanted = false;
  let x = Number.NaN;
  let z = Number.NaN;
  let sleep: ReturnType<typeof setTimeout> | undefined;

  const wanted = (): boolean => on && garden && !d.doc.hidden;

  function wake(c: C): void {
    if (c.state !== 'running') c.resume().catch(() => undefined);
  }

  function apply(fadeS: number): void {
    if (ctx === null) return;
    clearTimeout(sleep);
    if (wanted()) {
      wake(ctx);
      engine?.fade(duck ? DUCK : 1, fadeS);
      return;
    }
    const c = ctx;
    const hidden = d.doc.hidden;
    engine?.fade(0, hidden ? 0 : FADE_OUT_S);
    const quiet = (): void => {
      if (!wanted() && c.state === 'running') c.suspend().catch(() => undefined);
    };
    if (hidden) quiet();
    else sleep = setTimeout(quiet, FADE_OUT_S * 1000 + 50);
  }

  function start(): void {
    if (ctx !== null) {
      wake(ctx);
      return;
    }
    const c = d.makeContext();
    if (c === null) return;
    ctx = c;
    wake(c);
    d.loadEngine(c).then(
      (e) => {
        engine = e;
        if (!Number.isNaN(x)) e.hear(x, z);
        apply(FADE_IN_S);
        if (boxWanted) e.musicBox();
        boxWanted = false;
      },
      () => undefined,
    );
  }

  const onGesture = (e: Event): void => {
    if (wanted() && !d.ignore(e.target)) start();
  };
  for (const type of GESTURES) d.target.addEventListener(type, onGesture, { capture: true, passive: true });
  d.doc.addEventListener('visibilitychange', () => apply(FADE_IN_S));

  return {
    setOn(next) {
      on = next;
      if (on && ctx === null && wanted()) start();
      else apply(FADE_IN_S);
    },
    setGarden(shown) {
      if (shown === garden) return;
      garden = shown;
      apply(FADE_IN_S);
    },
    setDuck(next) {
      if (next === duck) return;
      duck = next;
      apply(1);
    },
    hear(atX, atZ) {
      x = atX;
      z = atZ;
      if (engine !== null && wanted()) engine.hear(atX, atZ);
    },
    musicBox() {
      if (!wanted()) return;
      if (engine !== null) engine.musicBox();
      else boxWanted = true;
    },
  };
}
