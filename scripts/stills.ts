/// <reference types="node" />
// npm run stills -- S01,S03 [--round NN] [--no-build]
// Opens ?shot=<id>&tier=high&t=<frozen> on the GPU (headed when a display exists), waits for window.__jardin.ready
// (DOM ready for the shots marked wait:'dom', i.e. S10), writes cook/stills/rNN/<shot>.png at 1920x1080 (S11 at
// 390x844), then one contact sheet _sheet.jpg for every still in the round. Shot list: tests/shots.json plus the
// overrides in content/garden.json. ?bench=1 is added because window.__jardin exists only with it in a build.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { ensureBuild } from '../tests/helpers/build.ts';
import { gpuLaunch } from '../tests/helpers/gpu.ts';
import { serveDist } from '../tests/helpers/server.ts';
import { loadShots, pickShots, type ShotDef } from '../tests/helpers/shots.ts';

export function currentRound(base = 'cook/stills'): string {
  if (!existsSync(base)) return '01';
  const rounds = readdirSync(base).flatMap((d) => (/^r(\d+)$/.test(d) ? [Number(d.slice(1))] : []));
  return String(rounds.length > 0 ? Math.max(...rounds) : 1).padStart(2, '0');
}

function contactSheet(dir: string): void {
  const pngs = readdirSync(dir).filter((f) => /^S\d\d\.png$/.test(f)).sort();
  if (pngs.length === 0) return;
  const cols = Math.min(3, pngs.length);
  const rows = Math.ceil(pngs.length / cols);
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const f of pngs) args.push('-i', `${dir}/${f}`);
  const cells = pngs.map((f, i) => `[${i}:v]scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,drawtext=text='${f.slice(0, 3)}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4[v${i}]`);
  const chain = `${pngs.map((_, i) => `[v${i}]`).join('')}concat=n=${pngs.length}:v=1:a=0,tile=${cols}x${rows}:padding=4:color=black[o]`;
  args.push('-filter_complex', [...cells, chain].join(';'), '-map', '[o]', '-frames:v', '1', '-q:v', '4', `${dir}/_sheet.jpg`);
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) console.log(`contact sheet failed: ${r.stderr.split('\n')[0]}`);
  else console.log(`wrote ${dir}/_sheet.jpg (${pngs.length} stills)`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--round');
  const round = ri >= 0 ? String(argv[ri + 1] ?? '').padStart(2, '0') : currentRound();
  const noBuild = argv.includes('--no-build');
  const list = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--round');
  const all = loadShots();
  const shots: ShotDef[] = pickShots(list ?? all.map((s) => s.id).join(','), all);

  if (!noBuild) {
    const err = ensureBuild();
    if (err !== null) {
      console.log(err);
      return 1;
    }
  }
  const dir = `cook/stills/r${round}`;
  mkdirSync(dir, { recursive: true });
  const gpu = gpuLaunch();
  const server = await serveDist();
  const browser = await chromium.launch({ headless: gpu.headless, args: gpu.args });
  console.log(`gpu: ${gpu.mode}; server ${server.url}; round r${round}`);
  const failed: string[] = [];
  try {
    for (const s of shots) {
      const [w, h] = s.viewport;
      const touch = w < 600;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch });
      const page = await ctx.newPage();
      const q = new URLSearchParams({ shot: s.id, tier: 'high', t: String(s.t), bench: '1' });
      if (s.mode !== null) q.set('mode', s.mode);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      try {
        await page.goto(`${server.url}?${q.toString()}${s.hash}`);
        if (s.wait === 'dom') {
          await page.locator('html[data-mode]').waitFor({ state: 'attached' });
          await page.locator('#herbario article').first().waitFor({ state: 'attached', timeout: 15000 });
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
        } else {
          await page.waitForFunction(() => (window as unknown as { __jardin?: unknown }).__jardin !== undefined, undefined, { timeout: 30000 });
          // S01 holds the intro channel mid-turn on purpose (garden/index.ts introShot), so the machine never rests: settled() would never
          // resolve. Wait for ready, then a fixed beat for the intro atlas to transcode and upload.
          const held = s.id === 'S01';
          await page.evaluate(async (hold) => {
            const api = (window as unknown as { __jardin: { ready: Promise<void>; settled(): Promise<void> } }).__jardin;
            await api.ready;
            if (!hold) await api.settled();
          }, held);
          if (held) await page.waitForTimeout(2500);
          // settled() can return while the target bed is still streaming (phase 'bed', intent project): wait for the real target.
          const target = /^#\/(b|p)\/([a-z0-9-]+)$/.exec(s.hash);
          if (target !== null) {
            const isProject = target[1] === 'p';
            const bed = target[2] ?? '';
            await page
              .waitForFunction(
                ([proj, b]) => {
                  const api = (window as unknown as { __jardin: { state(): { phase: string }; residency(): Record<string, string> } }).__jardin;
                  return proj === 'p' ? api.state().phase === 'inspect' : api.residency()[b ?? ''] === 'active';
                },
                [isProject ? 'p' : 'b', bed],
                { timeout: 30000, polling: 100 },
              )
              .catch(() => undefined);
            await page.evaluate(() => (window as unknown as { __jardin: { settled(): Promise<void> } }).__jardin.settled());
          }
        }
        await page.evaluate(() => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))));
        // Owner rule: the canvas fills the whole viewport. Assert it before every capture (S10 is the DOM-only Herbario).
        const view = await page.evaluate(() => {
          const c = document.getElementById('garden');
          const r = c?.getBoundingClientRect();
          return { iw: innerWidth, ih: innerHeight, cw: r?.width ?? 0, ch: r?.height ?? 0, ox: document.documentElement.scrollWidth - innerWidth, oy: document.documentElement.scrollHeight - innerHeight, hidden: getComputedStyle(document.documentElement).overflowY === 'hidden', gutter: innerWidth - document.documentElement.clientWidth };
        });
        if (view.iw !== w || view.ih !== h) throw new Error(`viewport mismatch: inner ${view.iw}x${view.ih}, wanted ${w}x${h}`);
        if (s.wait !== 'dom' && (Math.abs(view.cw - w) > 1 || Math.abs(view.ch - h) > 1)) throw new Error(`canvas ${view.cw}x${view.ch} does not fill ${w}x${h}`);
        // The garden page clips overflow on <html> (the hidden Herbario DOM is taller), so only a visible scrollbar gutter or a scrollable overflow counts. S10 is the Herbario and scrolls by design.
        if (s.wait !== 'dom' && (view.gutter > 0 || view.ox > 1 || (view.oy > 1 && !view.hidden))) throw new Error(`page scrolls (${view.ox},${view.oy}, gutter ${view.gutter})`);
        const out = `${dir}/${s.id}.png`;
        rmSync(out, { force: true });
        await page.screenshot({ path: out, type: 'png' });
        console.log(`wrote ${out} (${w}x${h})${errors.length > 0 ? ` page errors: ${errors.length}` : ''}`);
      } catch (e) {
        failed.push(s.id);
        console.log(`FAIL ${s.id}: ${String((e as Error).message).split('\n')[0]}`);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  contactSheet(dir);
  return failed.length > 0 ? 1 : 0;
}

process.exit(await main());
