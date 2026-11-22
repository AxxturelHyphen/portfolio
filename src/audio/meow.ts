/**
 * The cat's voice, made in code (no recording): a buzzing glottal source (a sawtooth with a little breath noise)
 * shaped by three moving band-pass formants. A meow goes from a closed nasal "m" through a bright open "e" (0.12 s in)
 * to a round "ow"; its pitch rises about a fourth and then glides down a fifth, with a soft attack and a slight vibrato
 * at the end. A chirp ("mrrp") is the short trilled greeting of a cat catching up: a quick lift of pitch through a
 * half-open vowel under a fast, deep flutter. Every call differs a little in pitch and length. Both go through the
 * mix, so the sound toggle and the ducking hold for them too. Pure scheduling on the given context, so an
 * OfflineAudioContext renders them the same (tests/unit/audio/meow.spec.ts).
 */

export type CatCall = 'meow' | 'chirp';

/** Formant frequencies (Hz) per vowel: F1, F2, F3; each formant's Q and level. */
type Vowel = readonly [number, number, number];
const NASAL: Vowel = [320, 1050, 2500];
const OPEN_E: Vowel = [780, 1950, 2900];
const ROUND_OW: Vowel = [560, 950, 2450];
const FORMANT_Q = [6, 9, 12] as const;
const FORMANT_GAIN = [1, 0.7, 0.3] as const;
/** Points of each pitch and formant curve. */
const CURVE_POINTS = 48;

/**
 * A call: length (s), pitch at the start (Hz), the random spread of both, attack and release (s), level, breath level,
 * the pitch (a ratio to the start) and formant i (Hz) at k of the way (0..1) for a call `dur` long, and the vibrato
 * (Hz, depth as a share of the pitch, from this share of the length on).
 */
interface Voice {
  s: number; hz: number; spread: number; attack: number; release: number; level: number; breath: number;
  pitch(k: number): number; formant(i: number, k: number, dur: number): number; vib: readonly [hz: number, depth: number, from: number];
}

const smooth = (k: number): number => k * k * (3 - 2 * k);
const between = (a: number, b: number, k: number): number => a + (b - a) * smooth(Math.min(1, Math.max(0, k)));

/** The meow's pitch: up a fourth by PEAK of the way, then down a fifth from there; its open "e" at E_AT seconds. */
const PEAK = 0.38;
const E_AT = 0.12;

const VOICES: Readonly<Record<CatCall, Voice>> = {
  meow: {
    s: 0.64, hz: 560, spread: 0.1, attack: 0.06, release: 0.12, level: 0.32, breath: 0.05,
    pitch: (k) => (k < PEAK ? between(1, 4 / 3, k / PEAK) : (4 / 3) / between(1, 3 / 2, (k - PEAK) / (1 - PEAK))),
    formant: (i, k, dur) => (k * dur < E_AT ? between(NASAL[i]!, OPEN_E[i]!, (k * dur) / E_AT) : between(OPEN_E[i]!, ROUND_OW[i]!, (k * dur - E_AT) / (dur - E_AT))),
    vib: [6.5, 0.025, 0.62],
  },
  chirp: {
    s: 0.2, hz: 640, spread: 0.08, attack: 0.02, release: 0.06, level: 0.26, breath: 0.02,
    pitch: (k) => 1 + 0.22 * Math.sin(Math.PI * Math.min(1, k * 1.6)),
    formant: (i, k) => NASAL[i]! + (OPEN_E[i]! - NASAL[i]!) * 0.7 * Math.sin(Math.PI * Math.min(1, k * 1.3)),
    vib: [32, 0.08, 0],
  },
};

let breath: AudioBuffer | null = null;

function breathOf(ctx: BaseAudioContext): AudioBuffer {
  if (breath !== null && breath.sampleRate === ctx.sampleRate) return breath;
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  breath = buf;
  return buf;
}

/** A curve of CURVE_POINTS values from fn(k), k from 0 to 1. */
function curve(fn: (k: number) => number): Float32Array {
  const out = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) out[i] = fn(i / (CURVE_POINTS - 1));
  return out;
}

/** Plays one call into `out` at `at` (default now); returns its length in seconds. */
export function catCall(ctx: BaseAudioContext, out: AudioNode, call: CatCall, at = ctx.currentTime, rnd: () => number = Math.random): number {
  const v = VOICES[call];
  const dur = v.s * (1 + (rnd() * 2 - 1) * v.spread);
  const hz = v.hz * (1 + (rnd() * 2 - 1) * v.spread);
  const end = at + dur;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(v.level, at + v.attack);
  env.gain.setValueAtTime(v.level, end - v.release);
  env.gain.linearRampToValueAtTime(0, end);
  env.connect(out);
  const mouth = ctx.createGain();
  for (let i = 0; i < 3; i++) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = FORMANT_Q[i]!;
    f.frequency.setValueCurveAtTime(curve((k) => v.formant(i, k, dur)), at, dur);
    const g = ctx.createGain();
    g.gain.value = FORMANT_GAIN[i]! * FORMANT_Q[i]! * 0.35;
    mouth.connect(f).connect(g).connect(env);
  }
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueCurveAtTime(curve((k) => hz * v.pitch(k)), at, dur);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = v.vib[0];
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, at);
  depth.gain.setValueAtTime(0, at + dur * v.vib[2]);
  depth.gain.linearRampToValueAtTime(hz * v.vib[1], end);
  lfo.connect(depth).connect(osc.frequency);
  const air = ctx.createBufferSource();
  air.buffer = breathOf(ctx);
  const airLevel = ctx.createGain();
  airLevel.gain.value = v.breath;
  osc.connect(mouth);
  air.connect(airLevel).connect(mouth);
  for (const s of [osc, lfo, air]) {
    s.start(at);
    s.stop(end);
  }
  osc.onended = () => env.disconnect();
  return dur;
}
