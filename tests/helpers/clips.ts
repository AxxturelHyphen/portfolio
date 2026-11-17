/// <reference types="node" />
// node tests/helpers/clips.ts [round]  (default 01)
// Four short Playwright recordings of the realtime app (tier high, GPU) into cook/stills/rNN/clips/, each with an mp4 and a
// contact sheet (10 fps, tiled): 1 panel open and close with Esc mid-iris, 2 travel across three beds, 3 garden to Herbario
// and back, 4 mobile swipe. Recording is Playwright recordVideo (25 fps VP8), transcoded to H.264.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { chromium, type Browser, type Page } from '@playwright/test';
import { gpuLaunch } from './gpu.ts';
import { serveDist } from './server.ts';

const round = (process.argv[2] ?? '01').padStart(2, '0');
const dir = `cook/stills/r${round}/clips`;
mkdirSync(dir, { recursive: true });

type Api = { send(e: unknown): void; settled(): Promise<void>; goto(h: string, o?: { instant?: boolean }): Promise<void>; ready: Promise<void> };
const api = <T>(page: Page, fn: (a: Api) => Promise<T> | T): Promise<T> =>
  page.evaluate(async (src) => {
    const a = (window as unknown as { __jardin: Api }).__jardin;
    await a.ready;
    return ((0, eval)(`(${src})`) as (x: Api) => unknown)(a);
  }, fn.toString()) as Promise<T>;

async function record(browser: Browser, name: string, url: string, vp: { width: number; height: number }, mobile: boolean, run: (page: Page) => Promise<void>): Promise<void> {
  const tmp = `${dir}/.${name}`;
  rmSync(tmp, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, recordVideo: { dir: tmp, size: vp } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('/favicon.ico') && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => (window as unknown as { __jardin?: unknown }).__jardin !== undefined, undefined, { timeout: 30000 });
  await api(page, (a) => a.settled());
  await page.waitForTimeout(600);
  await run(page);
  await page.waitForTimeout(600);
  await ctx.close();
  const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'));
  if (webm === undefined) throw new Error(`${name}: no video written`);
  const mp4 = `${dir}/${name}.mp4`;
  renameSync(`${tmp}/${webm}`, `${tmp}/in.webm`);
  const enc = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', `${tmp}/in.webm`, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', mp4], { encoding: 'utf8' });
  if (enc.status !== 0) throw new Error(`${name}: encode failed ${enc.stderr.split('\n')[0]}`);
  const cols = 6;
  const cellW = mobile ? 128 : 256;
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' });
  const frames = Math.max(1, Math.ceil(Number(probe.stdout.trim()) * 10));
  const rows = Math.ceil(frames / cols);
  const sheet = `${dir}/${name}_sheet.jpg`;
  const sh = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-vf', `fps=10,scale=${cellW}:-2,tile=${cols}x${rows}:padding=2:color=black`, '-frames:v', '1', '-q:v', '4', sheet], { encoding: 'utf8' });
  if (sh.status !== 0) throw new Error(`${name}: sheet failed ${sh.stderr.split('\n')[0]}`);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`${name}: ${mp4} + ${sheet} (${frames} frames at 10 fps)${errors.length > 0 ? ` ERRORS ${errors.length}: ${errors[0]}` : ''}`);
}

async function main(): Promise<void> {
  const gpu = gpuLaunch();
  const server = await serveDist();
  const browser = await chromium.launch({ headless: gpu.headless, args: gpu.args });
  const wide = { width: 1280, height: 720 };
  const u = (q: string, hash = '#/'): string => `${server.url}?${q}&tier=high&bench=1${hash}`;
  try {
    await record(browser, '1-panel-esc', u('mode=garden', '#/b/rosaleda'), wide, false, async (page) => {
      await api(page, (a) => a.goto('#/b/rosaleda'));
      await api(page, (a) => a.send({ type: 'OPEN', id: 'garagic' }));
      await page.waitForTimeout(260); // mid-iris
      await page.keyboard.press('Escape');
      await api(page, (a) => a.settled());
      await page.waitForTimeout(400);
      await api(page, (a) => a.send({ type: 'OPEN', id: 'garagic' }));
      await api(page, (a) => a.settled());
      await page.waitForTimeout(900);
      await page.keyboard.press('Escape');
      await api(page, (a) => a.settled());
    });
    await record(browser, '2-travel', u('mode=garden'), wide, false, async (page) => {
      const names = ['La Puerta', 'Rosaleda', 'Estanque de la Luna'];
      for (const n of names) {
        await page.getByRole('button', { name: n }).or(page.getByRole('link', { name: n })).first().click();
        await api(page, (a) => a.settled());
        await page.waitForTimeout(700);
      }
    });
    await record(browser, '3-garden-herbario', u('mode=garden', '#/b/rosaleda'), wide, false, async (page) => {
      await page.getByRole('button', { name: 'Herbario' }).or(page.getByRole('link', { name: 'Herbario' })).first().click();
      await page.locator('html[data-mode="herbario"]').waitFor({ timeout: 10000 });
      await api(page, (a) => a.settled());
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: 'Garden' }).or(page.getByRole('link', { name: 'Garden' })).first().click();
      await page.locator('html[data-mode="garden"]').waitFor({ timeout: 10000 });
      await api(page, (a) => a.settled());
      await page.waitForTimeout(800);
    });
    await record(browser, '4-mobile-swipe', u('mode=garden', '#/b/rosaleda'), { width: 390, height: 844 }, true, async (page) => {
      const cdp = await page.context().newCDPSession(page);
      const swipe = async (x0: number, x1: number, y: number): Promise<void> => {
        const steps = 12;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
        for (let i = 1; i <= steps; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y }] });
          await page.waitForTimeout(16);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      await swipe(320, 70, 420);
      await api(page, (a) => a.settled());
      await page.waitForTimeout(500);
      await swipe(320, 70, 420);
      await api(page, (a) => a.settled());
      await page.waitForTimeout(500);
      await swipe(70, 320, 420);
      await api(page, (a) => a.settled());
    });
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
