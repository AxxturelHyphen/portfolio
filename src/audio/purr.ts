/**
 * The cat's purr, made in code (no recording): low-passed noise whose level trembles at PURR.hz, faded in and out over
 * PURR.s. Quiet under the garden; it goes through the mix, so the sound toggle and the ducking hold for it too.
 */

const PURR = { s: 1.5, hz: 25, lowpass: 240, attack: 0.2, release: 0.6, level: 0.9 } as const;

let noise: AudioBuffer | null = null;

function noiseOf(ctx: BaseAudioContext): AudioBuffer {
  if (noise !== null && noise.sampleRate === ctx.sampleRate) return noise;
  const buf = ctx.createBuffer(1, Math.ceil(PURR.s * ctx.sampleRate), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise = buf;
  return buf;
}

/** Plays one purr into `out`, starting now. */
export function purr(ctx: BaseAudioContext, out: AudioNode): void {
  const now = ctx.currentTime;
  const end = now + PURR.s;
  const src = ctx.createBufferSource();
  src.buffer = noiseOf(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = PURR.lowpass;
  const tremble = ctx.createGain();
  tremble.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = PURR.hz;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(tremble.gain);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(PURR.level, now + PURR.attack);
  env.gain.setValueAtTime(PURR.level, end - PURR.release);
  env.gain.linearRampToValueAtTime(0, end);
  src.connect(filter).connect(tremble).connect(env).connect(out);
  src.start(now);
  lfo.start(now);
  src.stop(end);
  lfo.stop(end);
  src.onended = () => {
    env.disconnect();
    depth.disconnect();
  };
}
