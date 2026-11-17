/// <reference types="node" />
// node tests/helpers/clips-r03.ts [round] [names,comma]  (default round 03, all five clips)
// Playwright recordVideo 1280x720 (GPU headless, explicit viewport, tier high) into cook/stills/rNN/clips/, each an mp4 plus
// a tiled 10 fps contact sheet: a-intro (cold load, the kaleidoscope resolving onto the garden), b-walk (La Puerta through
// every bed to La Salida), c-notebook (focus a rose, bloom, plant tag, View, Esc mid-iris, again fully open and close),
// d-peacock (the fan at the Estanque), e-exit (Exit to the Herbario and back). Prints probes so the log shows what was visible.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { chromium, type Browser, type Page } from '@playwright/test';
import { gpuLaunch } from './gpu.ts';
import { serveDist } from './server.ts';

const round = (process.argv[2] ?? '03').padStart(2, '0');
const only = process.argv[3]?.split(',') ?? null;
const dir = `cook/stills/r${round}/clips`;
mkdirSync(dir, { recursive: true });
const vp = { width: 1280, height: 720 };

type Api = { settled(): Promise<void>; goto(h: string, o?: { instant?: boolean }): Promise<void>; send(e: unknown): void; ready: Promise<void>; state(): { phase: string; bed: string | null; mode: string } };
const api = <T>(page: Page, fn: (a: Api) => Promise<T> | T): Promise<T> =>
  page.evaluate(async (src) => {
    const a = (window as unknown as { __jardin: Api }).__jardin;
    await a.ready;
    return ((0, eval)(`(${src})`) as (x: Api) => unknown)(a);
  }, fn.toString()) as Promise<T>;

const probe = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(() => {
    const tag = document.querySelector('#label-card, .pl-tag');
    const dlg = document.getElementById('panel') as HTMLDialogElement | null;
    const c = document.getElementById('garden')?.getBoundingClientRect();
    return {
      inner: `${innerWidth}x${innerHeight}`,
      canvas: c ? `${c.width}x${c.height}` : 'none',
      tag: tag ? Number(getComputedStyle(tag).opacity) : -1,
      panelOpen: dlg?.open === true,
      mode: document.documentElement.dataset.mode ?? '',
    };
  });

async function record(browser: Browser, url: string, name: string, cold: boolean, run: (page: Page, log: (s: string) => Promise<void>) => Promise<void>): Promise<void> {
  const tmp = `${dir}/.${name}`;
  rmSync(tmp, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, recordVideo: { dir: tmp, size: vp } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('/favicon.ico') && errors.push(m.text()));
  const log = async (s: string): Promise<void> => console.log(`  ${name} ${s}: ${JSON.stringify(await probe(page))}`);
  await page.goto(url);
  if (!cold) {
    await page.waitForFunction(() => (window as unknown as { __jardin?: unknown }).__jardin !== undefined, undefined, { timeout: 30000 });
    await api(page, (a) => a.settled());
    await page.waitForTimeout(800);
  }
  await run(page, log);
  await page.waitForTimeout(700);
  await ctx.close();
  const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'));
  if (webm === undefined) throw new Error(`${name}: no video written`);
  renameSync(`${tmp}/${webm}`, `${tmp}/in.webm`);
  const mp4 = `${dir}/${name}.mp4`;
  const enc = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', `${tmp}/in.webm`, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', mp4], { encoding: 'utf8' });
  if (enc.status !== 0) throw new Error(`${name}: encode failed ${enc.stderr.split('\n')[0]}`);
  const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }).stdout.trim());
  const frames = Math.max(1, Math.ceil(dur * 10));
  const cols = 8;
  const sheet = `${dir}/${name}_sheet.jpg`;
  const sh = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-vf', `fps=10,scale=200:-2,tile=${cols}x${Math.ceil(frames / cols)}:padding=2:color=black`, '-frames:v', '1', '-q:v', '5', sheet], { encoding: 'utf8' });
  if (sh.status !== 0) throw new Error(`${name}: sheet failed ${sh.stderr.split('\n')[0]}`);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`${name}: ${mp4} + ${sheet} (${dur.toFixed(1)} s, ${frames} frames)${errors.length > 0 ? ` ERRORS ${errors.length}: ${errors[0]}` : ''}`);
}

async function main(): Promise<void> {
  const gpu = gpuLaunch();
  const server = await serveDist();
  const browser = await chromium.launch({ headless: gpu.headless, args: gpu.args });
  const u = (hash = '#/'): string => `${server.url}?mode=garden&tier=high&bench=1${hash}`;
  const want = (n: string): boolean => only === null || only.includes(n);
  try {
    if (want('a-intro')) {
      await record(browser, u(), 'a-intro', true, async (page, log) => {
        await page.waitForTimeout(500);
        await log('t+0.5');
        await page.waitForFunction(() => (window as unknown as { __jardin?: unknown }).__jardin !== undefined, undefined, { timeout: 30000 });
        await log('api up');
        await api(page, (a) => a.settled());
        await page.waitForTimeout(1500);
        await log('resolved');
      });
    }
    if (want('b-walk')) {
      await record(browser, u(), 'b-walk', false, async (page, log) => {
        for (const b of ['puerta', 'rosaleda', 'estanque', 'semillero', 'gruta', 'salida']) {
          await api(page, (a) => a.settled());
          await page.evaluate((id) => (window as unknown as { __jardin: Api }).__jardin.goto(`#/b/${id}`), b);
          await page.waitForTimeout(1100);
          await log(b);
        }
      });
    }
    if (want('c-notebook')) {
      await record(browser, u('#/b/rosaleda'), 'c-notebook', false, async (page, log) => {
        const rose = page.locator('.px-slot[data-project]').first();
        const box = await rose.boundingBox();
        if (box === null) throw new Error('no project proxy in the Rosaleda');
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await page.mouse.move(vp.width / 2, vp.height / 2);
        await page.mouse.move(cx, cy, { steps: 14 });
        await page.waitForTimeout(1800);
        await log('focus, bloom, tag');
        await page.mouse.click(cx, cy);
        await page.locator('dialog#panel[open]').waitFor({ timeout: 8000 }).catch(() => undefined);
        await page.waitForTimeout(260);
        await log('mid-iris');
        await page.keyboard.press('Escape');
        await api(page, (a) => a.settled());
        await page.waitForTimeout(600);
        await log('after esc mid-iris');
        const b2 = await page.locator('.px-slot[data-project]').first().boundingBox();
        const x2 = (b2?.x ?? box.x) + (b2?.width ?? box.width) / 2;
        const y2 = (b2?.y ?? box.y) + (b2?.height ?? box.height) / 2;
        await page.mouse.move(x2, y2, { steps: 4 });
        await page.waitForTimeout(900);
        await page.mouse.click(x2, y2);
        await page.locator('dialog#panel[open]').waitFor({ timeout: 8000 }).catch(() => undefined);
        await api(page, (a) => a.settled());
        await page.waitForTimeout(1800);
        await log('notebook open');
        await page.keyboard.press('Escape');
        await api(page, (a) => a.settled());
        await page.waitForTimeout(1000);
        await log('closed');
      });
    }
    if (want('d-peacock')) {
      await record(browser, u('#/b/semillero'), 'd-peacock', false, async (page, log) => {
        await page.evaluate(() => (window as unknown as { __jardin: Api }).__jardin.goto('#/b/estanque'));
        await page.waitForTimeout(2600);
        await log('fan open');
        await page.evaluate(() => (window as unknown as { __jardin: Api }).__jardin.goto('#/b/gruta'));
        await page.waitForTimeout(900);
        await log('away');
      });
    }
    if (want('e-exit')) {
      await record(browser, u('#/b/rosaleda'), 'e-exit', false, async (page, log) => {
        const exit = page.locator('#toggles .tg-exit');
        await log('before');
        await exit.click();
        await page.locator('html[data-mode="herbario"]').waitFor({ timeout: 10000 });
        await api(page, (a) => a.settled());
        await page.waitForTimeout(1600);
        await log('herbario');
        await page.locator('.tg-exit').first().click();
        await page.locator('html[data-mode="garden"]').waitFor({ timeout: 10000 });
        await api(page, (a) => a.settled());
        await page.waitForTimeout(1200);
        await log('back');
      });
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.log(`clips failed: ${String((e as Error).message ?? e)}`);
    process.exit(1);
  },
);
