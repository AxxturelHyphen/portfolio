import { catCall, type CatCall } from './meow.ts';
import { purr } from './purr.ts';
import { footstep } from './steps.ts';
import { SOUNDS, clipsOf, fileOf, loopLength, type SoundId } from './sounds.ts';
import { dist, levelAt, panAt, perchFor, type SoundMap } from './space.ts';

/**
 * The garden's sound (its own chunk, loaded on the first gesture that starts sound): one AudioContext, every file
 * fetched and decoded once, after the garden is interactive. A cricket bed under everything; the Estanque water
 * louder as the visitor nears the pond; now and then a nightingale (or, rarely, an owl) from a tree or box a few metres
 * away; and the music box at the sundial, wound and played once when the visitor comes close, running
 * down at the end. Positional sounds are a gain and a stereo pan set from the visitor's ground position, at most ten
 * times a second, so the main thread does next to nothing. The low tier keeps the bed and the music box only.
 */

export interface SoundEngine {
  /** Brings the whole mix to `to` (0 to 1) over `seconds`. */
  fade(to: number, seconds: number): void;
  /** The visitor stands at (x, z). Allocates nothing. */
  hear(x: number, z: number): void;
  /** The cat calls (audio/meow.ts); after a meow it purrs once (audio/purr.ts). */
  cat(call: CatCall): void;
  /** Footstep number n, on the stone path or on soil and grass (audio/steps.ts). */
  step(stone: boolean, n: number): void;
}

export interface EngineOptions { map: SoundMap; full: boolean }

const MIX = { master: 0.8, crickets: 0.3, water: 0.45, nightingale: 0.4, owl: 0.28, box: 0.7 } as const;
/** A bed fades in over this long when it first starts (seconds). */
const BED_IN_S = 2;
/** Time constant of a level or pan following the visitor (seconds). */
const FOLLOW_S = 0.15;
const HEAR_EVERY_S = 0.1;
const WATER = { near: 1, far: 12 } as const;
/**
 * Music box: level by distance; starts within `start` metres, again only after the visitor went past `rearm` and
 * `rest` seconds of quiet. The tune starts `overlap` s before the winding ends; over its last `windDown` s it slows to
 * `slow` and fades out, like a spring running down.
 */
const BOX = { near: 1.5, far: 14, start: 1.6, rearm: 5, rest: 90, overlap: 0.5, windDown: 3, slow: 0.95 } as const;
/** Bird calls: the first after 6 to 12 s, then every 18 to 45 s, from a perch 3 to 18 m away (an owl 8 m or more). */
const BIRD = { first: [6, 12], every: [18, 45], near: 3, far: 18, fall: 22, owl: 0.2, owlNear: 8 } as const;

const between = (r: readonly [number, number]): number => r[0] + Math.random() * (r[1] - r[0]);

export function createEngine(ctx: AudioContext, o: EngineOptions): SoundEngine {
  const { map } = o;
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const loaded: Partial<Record<SoundId, AudioBuffer>> = {};
  const loading = new Map<SoundId, Promise<AudioBuffer | null>>();
  function load(id: SoundId): Promise<AudioBuffer | null> {
    let p = loading.get(id);
    if (p === undefined) {
      p = fetch(new URL(fileOf(id), document.baseURI).href)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => (loaded[id] = buf))
        .catch(() => null);
      loading.set(id, p);
    }
    return p;
  }

  /** A gain into a stereo pan into the mix: one positional voice. */
  function voice(level: number): { gain: GainNode; pan: StereoPannerNode } {
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    gain.gain.value = level;
    gain.connect(pan).connect(master);
    return { gain, pan };
  }

  /** A looping bed through `out`, faded in from silence. */
  function startLoop(id: SoundId, out: AudioNode): void {
    const buf = loaded[id];
    if (buf === undefined) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopEnd = Math.min(buf.duration, loopLength(SOUNDS[id]));
    const fadeIn = ctx.createGain();
    fadeIn.gain.setValueAtTime(0, ctx.currentTime);
    fadeIn.gain.linearRampToValueAtTime(1, ctx.currentTime + BED_IN_S);
    src.connect(fadeIn).connect(out);
    src.start();
  }

  const bed = ctx.createGain();
  bed.gain.value = MIX.crickets;
  bed.connect(master);
  const water = voice(0);
  const box = voice(0);
  const boxEnv = ctx.createGain();
  boxEnv.connect(box.gain);

  let ex = Number.NaN;
  let ez = Number.NaN;
  let lastHear = -1;
  let boxOn = false;
  let boxArmed = true;
  let boxQuietAt = -Infinity;
  let boxAsked = false;

  const follow = (p: AudioParam, v: number): void => {
    if (Math.abs(p.value - v) > 0.005) p.setTargetAtTime(v, ctx.currentTime, FOLLOW_S);
  };

  function place(): void {
    if (Number.isNaN(ex)) return;
    follow(water.gain.gain, MIX.water * levelAt(Math.max(0, dist(map.pond, ex, ez) - map.pond.r), WATER.near, WATER.far));
    follow(water.pan.pan, panAt(map.pond.x - ex));
    if (!boxOn) return;
    follow(box.gain.gain, MIX.box * levelAt(dist(map.box, ex, ez), BOX.near, BOX.far));
    follow(box.pan.pan, panAt(map.box.x - ex));
  }

  function playBox(): void {
    boxArmed = false;
    if (boxOn || boxAsked) return;
    const wind = loaded.winding;
    const tune = loaded.musicbox;
    if (wind === undefined || tune === undefined) {
      boxAsked = true;
      void Promise.all([load('winding'), load('musicbox')]).then(([a, b]) => {
        boxAsked = false;
        if (a !== null && b !== null) playBox();
      });
      return;
    }
    const [w] = clipsOf(SOUNDS.winding);
    const [t] = clipsOf(SOUNDS.musicbox);
    if (w === undefined || t === undefined) return;
    boxOn = true;
    const t0 = ctx.currentTime + 0.05;
    const tuneAt = t0 + w.dur - BOX.overlap;
    const end = tuneAt + t.dur;
    box.gain.gain.cancelScheduledValues(t0);
    box.gain.gain.setValueAtTime(Number.isNaN(ex) ? MIX.box : MIX.box * levelAt(dist(map.box, ex, ez), BOX.near, BOX.far), t0);
    box.pan.pan.setValueAtTime(Number.isNaN(ex) ? 0 : panAt(map.box.x - ex), t0);
    boxEnv.gain.cancelScheduledValues(t0);
    boxEnv.gain.setValueAtTime(1, t0);
    boxEnv.gain.setValueAtTime(1, end - BOX.windDown);
    boxEnv.gain.linearRampToValueAtTime(0, end);
    const winding = ctx.createBufferSource();
    winding.buffer = wind;
    winding.connect(boxEnv);
    winding.start(t0, w.at, w.dur);
    const melody = ctx.createBufferSource();
    melody.buffer = tune;
    melody.playbackRate.setValueAtTime(1, end - BOX.windDown);
    melody.playbackRate.linearRampToValueAtTime(BOX.slow, end);
    melody.connect(boxEnv);
    melody.start(tuneAt, t.at, t.dur);
    melody.stop(end);
    melody.onended = () => {
      boxOn = false;
      boxQuietAt = ctx.currentTime;
    };
  }

  /** One call from a perch near the visitor, then the next one is set. */
  function call(): void {
    window.setTimeout(call, between(BIRD.every) * 1000);
    if (ctx.state !== 'running' || Number.isNaN(ex)) return;
    const owl = Math.random() < BIRD.owl;
    const buf = owl ? loaded.owl : loaded.nightingale;
    const perch = perchFor(map.perches, ex, ez, owl ? BIRD.owlNear : BIRD.near, BIRD.far, Math.random());
    if (buf === undefined || perch === null) return;
    const clips = clipsOf(SOUNDS[owl ? 'owl' : 'nightingale']);
    const clip = clips[Math.floor(Math.random() * clips.length)];
    if (clip === undefined) return;
    const v = voice((owl ? MIX.owl : MIX.nightingale) * levelAt(dist(perch, ex, ez), BIRD.near, BIRD.fall));
    v.pan.pan.value = panAt(perch.x - ex);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.97 + Math.random() * 0.06;
    src.connect(v.gain);
    src.start(ctx.currentTime + 0.05, clip.at, clip.dur);
    src.onended = () => v.pan.disconnect();
  }

  void load('crickets').then(() => {
    startLoop('crickets', bed);
    if (!o.full) return;
    void load('water').then(() => startLoop('water', water.gain));
    void Promise.all([load('nightingale'), load('owl')]).then(() => window.setTimeout(call, between(BIRD.first) * 1000));
    void load('winding').then(() => load('musicbox'));
  });

  return {
    fade(to, seconds) {
      const g = master.gain;
      const now = ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      if (seconds > 0) g.linearRampToValueAtTime(to * MIX.master, now + seconds);
      else g.setValueAtTime(to * MIX.master, now);
    },
    hear(x, z) {
      const now = ctx.currentTime;
      if (now - lastHear < HEAR_EVERY_S || (x === ex && z === ez)) return;
      lastHear = now;
      ex = x;
      ez = z;
      place();
      const d = dist(map.box, x, z);
      if (!boxOn && boxArmed && d < BOX.start) playBox();
      else if (!boxOn && !boxArmed && d > BOX.rearm && now - boxQuietAt > BOX.rest) boxArmed = true;
    },
    cat(call) {
      const s = catCall(ctx, master, call);
      if (call === 'meow') setTimeout(() => purr(ctx, master), s * 1000);
    },
    step(stone, n) {
      if (ctx.state === 'running') footstep(ctx, master, stone, n);
    },
  };
}
