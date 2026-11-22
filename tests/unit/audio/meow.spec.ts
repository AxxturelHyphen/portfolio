import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';

// The cat's voice (src/audio/meow.ts), rendered offline: a meow is audible, never clips, lasts 0.55 to 0.75 s and its
// pitch rises before it falls further; a chirp is short. The renders are written as wav files for a listen, into the
// test's output and, when MEOW_WAV_DIR names a folder, there too.

const RATE = 44100;

function keep(name: string, data: Float32Array): void {
  const bytes = wav(data);
  writeFileSync(test.info().outputPath(name), bytes);
  const dir = process.env['MEOW_WAV_DIR'];
  if (dir === undefined) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), bytes);
}

declare global {
  interface Window { catCall?: (ctx: BaseAudioContext, out: AudioNode, call: 'meow' | 'chirp', at?: number, rnd?: () => number) => number }
}

async function render(page: Page, call: 'meow' | 'chirp', seed: number): Promise<{ dur: number; data: Float32Array }> {
  const src = stripTypeScriptTypes(readFileSync(new URL('../../../src/audio/meow.ts', import.meta.url), 'utf8')).replace(/^export /gm, '');
  await page.setContent('<!doctype html><title>meow</title>');
  await page.addScriptTag({ content: `${src}\nwindow.catCall = catCall;` });
  const out = await page.evaluate(async ([c, s0, rate]) => {
    const ctx = new OfflineAudioContext(1, Math.ceil(rate * 1.1), rate);
    let s = s0;
    const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
    const dur = window.catCall!(ctx, ctx.destination, c, 0.05, rnd);
    const buf = await ctx.startRendering();
    return { dur, data: Array.from(buf.getChannelData(0)) };
  }, [call, seed, RATE] as const);
  return { dur: out.dur, data: Float32Array.from(out.data) };
}

function wav(data: Float32Array): Buffer {
  const b = Buffer.alloc(44 + data.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i]!)) * 32767), 44 + i * 2);
  return b;
}

/** Windows of 40 ms every 10 ms: their level and their pitch (autocorrelation, 250 to 1400 Hz). */
function analyse(data: Float32Array): { rms: number[]; hz: number[] } {
  const win = Math.round(RATE * 0.04);
  const hop = Math.round(RATE * 0.01);
  const rms: number[] = [];
  const hz: number[] = [];
  for (let o = 0; o + win < data.length; o += hop) {
    let e = 0;
    for (let i = 0; i < win; i++) e += data[o + i]! ** 2;
    rms.push(Math.sqrt(e / win));
    let best = 0;
    let bestLag = 0;
    for (let lag = Math.floor(RATE / 1400); lag <= Math.ceil(RATE / 250); lag++) {
      let c = 0;
      for (let i = 0; i + lag < win; i++) c += data[o + i]! * data[o + i + lag]!;
      if (c > best) {
        best = c;
        bestLag = lag;
      }
    }
    hz.push(bestLag > 0 ? RATE / bestLag : 0);
  }
  return { rms, hz };
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test('a meow: audible, unclipped, 0.55 to 0.75 s, its pitch rising about a fourth and then falling further', async ({ page }) => {
  for (const seed of [7, 1234, 98765]) {
    const { dur, data } = await render(page, 'meow', seed);
    if (seed === 7) keep('meow.wav', data);
    expect(dur).toBeGreaterThanOrEqual(0.55);
    expect(dur).toBeLessThanOrEqual(0.75);
    const peak = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak, 'not clipping').toBeLessThan(0.98);
    expect(peak, 'not silent').toBeGreaterThan(0.08);
    const { rms, hz } = analyse(data);
    const top = Math.max(...rms);
    const voiced = rms.map((r, i) => (r > top * 0.15 ? i : -1)).filter((i) => i >= 0);
    const span = (voiced[voiced.length - 1]! - voiced[0]!) * 0.01;
    expect(span, 'heard for most of its length').toBeGreaterThan(dur * 0.7);
    const n = voiced.length;
    const head = median(voiced.slice(0, Math.max(3, Math.round(n * 0.12))).map((i) => hz[i]!));
    const tail = median(voiced.slice(n - Math.max(3, Math.round(n * 0.12))).map((i) => hz[i]!));
    const middle = voiced.slice(Math.round(n * 0.25), Math.round(n * 0.55)).map((i) => hz[i]!);
    const high = median(middle);
    expect(high / head, `rises (${head.toFixed(0)} to ${high.toFixed(0)} Hz)`).toBeGreaterThan(1.15);
    expect(high / tail, `then falls further (${high.toFixed(0)} to ${tail.toFixed(0)} Hz)`).toBeGreaterThan(1.25);
    expect(tail, 'ending under where it began').toBeLessThan(head * 1.02);
  }
});

test('a chirp: short and audible, unclipped', async ({ page }) => {
  const { dur, data } = await render(page, 'chirp', 42);
  keep('chirp.wav', data);
  expect(dur).toBeGreaterThan(0.15);
  expect(dur).toBeLessThan(0.26);
  const peak = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  expect(peak).toBeLessThan(0.98);
  expect(peak).toBeGreaterThan(0.05);
});
