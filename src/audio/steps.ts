/**
 * The visitor's footsteps, made in code (no recording), one per foot set down by the gait (world/puppet.gait.ts). On
 * the stone path a short dry tap: a burst of band-passed noise over a little low click. On soil and grass a soft
 * brushed thud: low-passed noise that swells in more slowly over a low thump. Each step's pitch, level and stretch of
 * noise come from a fixed hash of its number, so a walk sounds the same every time; feet alternate a hair left and
 * right. Far under the garden's ambience, and through the mix, so the sound toggle and the ducking hold for it too.
 */

interface Timbre {
  filter: BiquadFilterType;
  /** Noise filter frequency (Hz) and Q; attack and decay of the noise (seconds); its peak level. */
  hz: number; q: number; attack: number; decay: number; noise: number;
  /** The body under it: a sine starting at bodyHz, falling to bodyDrop of it over bodyDecay seconds, at peak body. */
  bodyHz: number; bodyDrop: number; bodyDecay: number; body: number;
}

const STONE: Timbre = { filter: 'bandpass', hz: 2600, q: 1.1, attack: 0.002, decay: 0.05, noise: 0.1, bodyHz: 170, bodyDrop: 0.6, bodyDecay: 0.03, body: 0.035 };
const SOIL: Timbre = { filter: 'lowpass', hz: 800, q: 0.5, attack: 0.02, decay: 0.15, noise: 0.13, bodyHz: 85, bodyDrop: 0.7, bodyDecay: 0.09, body: 0.04 };
/** Per step: pitch within +-pitch, level down by up to level, feet panned +-pan; the noise is NOISE_S long. */
const VARY = { pitch: 0.12, level: 0.3, pan: 0.06 } as const;
const NOISE_S = 0.5;
/** Each step is scheduled this far ahead (seconds), and its voices stop this long after the decay. */
const LEAD_S = 0.01;
const TAIL_S = 0.02;
const SILENT = 0.0001;

let noise: AudioBuffer | null = null;

/** White noise from a fixed generator, made once per sample rate. */
function noiseOf(ctx: BaseAudioContext): AudioBuffer {
  if (noise !== null && noise.sampleRate === ctx.sampleRate) return noise;
  const buf = ctx.createBuffer(1, Math.ceil(NOISE_S * ctx.sampleRate), ctx.sampleRate);
  const data = buf.getChannelData(0);
  let seed = 0x2f6b1d;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = seed / 0x80000000 - 1;
  }
  noise = buf;
  return buf;
}

/** A fixed hash of step n on channel k, in 0..1. */
export function stepHash(n: number, k: number): number {
  const h = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/** Rises from silence to `peak` over `attack`, then dies away over `decay`. */
function shape(g: AudioParam, t0: number, attack: number, decay: number, peak: number): void {
  g.setValueAtTime(SILENT, t0);
  g.linearRampToValueAtTime(peak, t0 + attack);
  g.exponentialRampToValueAtTime(SILENT, t0 + attack + decay);
}

/** Plays footstep number `n` into `out`: the stone tap on the path, the soft thud elsewhere. */
export function footstep(ctx: BaseAudioContext, out: AudioNode, stone: boolean, n: number): void {
  const s = stone ? STONE : SOIL;
  const pitch = 1 + VARY.pitch * (2 * stepHash(n, 1) - 1);
  const level = 1 - VARY.level * stepHash(n, 2);
  const t0 = ctx.currentTime + LEAD_S;
  const end = t0 + s.attack + s.decay + TAIL_S;
  const pan = ctx.createStereoPanner();
  pan.pan.value = n % 2 === 0 ? -VARY.pan : VARY.pan;
  pan.connect(out);

  const src = ctx.createBufferSource();
  src.buffer = noiseOf(ctx);
  src.playbackRate.value = pitch;
  const filter = ctx.createBiquadFilter();
  filter.type = s.filter;
  filter.frequency.value = s.hz * pitch;
  filter.Q.value = s.q;
  const env = ctx.createGain();
  shape(env.gain, t0, s.attack, s.decay, s.noise * level);
  src.connect(filter).connect(env).connect(pan);
  src.start(t0, stepHash(n, 3) * (NOISE_S / 2));
  src.stop(end);

  const body = ctx.createOscillator();
  body.frequency.setValueAtTime(s.bodyHz * pitch, t0);
  body.frequency.exponentialRampToValueAtTime(s.bodyHz * pitch * s.bodyDrop, t0 + s.bodyDecay);
  const bodyEnv = ctx.createGain();
  shape(bodyEnv.gain, t0, Math.min(s.attack, 0.005), s.bodyDecay, s.body * level);
  body.connect(bodyEnv).connect(pan);
  body.start(t0);
  body.stop(end);
  src.onended = () => pan.disconnect();
}
