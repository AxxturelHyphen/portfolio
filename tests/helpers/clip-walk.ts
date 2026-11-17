/// <reference types="node" />
// node tests/helpers/clip-walk.ts [round]  (default 02)
// One Playwright recording (1280x720, GPU headless, tier high) of the retouch walk: overview, walk from La Puerta to the
// Rosaleda, focus a rose so it blooms and its plant tag appears, View into the notebook, Esc. Writes
// cook/stills/rNN/clips/walk.mp4 and walk_sheet.jpg (10 fps, tiled), and prints what was visible at each step.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';
import { gpuLaunch } from './gpu.ts';
import { serveDist } from './server.ts';

const round = (process.argv[2] ?? '02').padStart(2, '0');
const dir = `cook/stills/r${round}/clips`;
mkdirSync(dir, { recursive: true });
const vp = { width: 1280, height: 720 };

type Api = { settled(): Promise<void>; goto(h: string, o?: { instant?: boolean }): Promise<void>; ready: Promise<void>; state(): { phase: string; bed: string | null } };
const api = <T>(page: Page, fn: (a: Api) => Promise<T> | T): Promise<T> =>
  page.evaluate(async (src) => {
    const a = (window as unknown as { __jardin: Api }).__jardin;
    await a.ready;
    return ((0, eval)(`(${src})`) as (x: Api) => unknown)(a);
  }, fn.toString()) as Promise<T>;

const probe = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(() => {
    const tag = document.getElementById('label-card');
    const r = tag?.getBoundingClientRect();
    const dlg = document.getElementById('panel') as HTMLDialogElement | null;
    return {
      iw: innerWidth,
      ih: innerHeight,
      canvas: (() => { const c = document.getElementById('garden')?.getBoundingClientRect(); return c ? `${c.width}x${c.height}` : 'none'; })(),
      tagOpacity: tag ? Number(getComputedStyle(tag).opacity) : -1,
      tagBox: r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : 'none',
      tagText: (tag?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
      panelOpen: dlg?.open === true,
    };
  });

async function main(): Promise<void> {
  const gpu = gpuLaunch();
  const server = await serveDist();
  const browser = await chromium.launch({ headless: gpu.headless, args: gpu.args });
  const tmp = `${dir}/.walk`;
  rmSync(tmp, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, recordVideo: { dir: tmp, size: vp } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('/favicon.ico') && errors.push(m.text()));
  const log = async (step: string): Promise<void> => console.log(`${step}: ${JSON.stringify(await probe(page))}`);
  try {
    await page.goto(`${server.url}?mode=garden&tier=high&bench=1#/`);
    await page.waitForFunction(() => (window as unknown as { __jardin?: unknown }).__jardin !== undefined, undefined, { timeout: 30000 });
    await api(page, (a) => a.settled());
    await page.waitForTimeout(1500);
    await log('overview');
    // Walk: La Puerta, then the Rosaleda through its signpost (the real control), falling back to the API.
    await api(page, (a) => a.goto('#/b/puerta'));
    await page.waitForTimeout(900);
    await log('puerta');
    const sign = page.getByRole('link', { name: /Rosaleda/ }).or(page.getByRole('button', { name: /Rosaleda/ })).first();
    if (await sign.isVisible().catch(() => false)) await sign.click();
    else console.log('signpost to Rosaleda not found from La Puerta, using api.goto');
    await api(page, (a) => a.settled());
    if ((await api(page, (a) => a.state().bed)) !== 'rosaleda') await api(page, (a) => a.goto('#/b/rosaleda'));
    await page.waitForTimeout(1000);
    await log('rosaleda');
    // Focus a rose with the pointer: it blooms and its plant tag appears.
    const rose = page.locator('.px-slot[data-project]').first();
    const box = await rose.boundingBox();
    if (box === null) throw new Error('no project proxy in the Rosaleda');
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
    await page.waitForTimeout(1600);
    await log('focus');
    // View: click the flower.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('dialog#panel[open]').waitFor({ timeout: 8000 }).catch(() => undefined);
    await api(page, (a) => a.settled());
    await page.waitForTimeout(1600);
    await log('notebook');
    await page.keyboard.press('Escape');
    await api(page, (a) => a.settled());
    await page.waitForTimeout(1200);
    await log('after esc');
  } finally {
    await ctx.close();
    await browser.close();
    await server.close();
  }
  const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'));
  if (webm === undefined) throw new Error('no video written');
  renameSync(`${tmp}/${webm}`, `${tmp}/in.webm`);
  const mp4 = `${dir}/walk.mp4`;
  const enc = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', `${tmp}/in.webm`, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', mp4], { encoding: 'utf8' });
  if (enc.status !== 0) throw new Error(`encode failed ${enc.stderr.split('\n')[0]}`);
  const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }).stdout.trim());
  const frames = Math.max(1, Math.ceil(dur * 10));
  const cols = 8;
  const sheet = `${dir}/walk_sheet.jpg`;
  const sh = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-vf', `fps=10,scale=200:-2,tile=${cols}x${Math.ceil(frames / cols)}:padding=2:color=black`, '-frames:v', '1', '-q:v', '5', sheet], { encoding: 'utf8' });
  if (sh.status !== 0) throw new Error(`sheet failed ${sh.stderr.split('\n')[0]}`);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`walk: ${mp4} + ${sheet} (${dur.toFixed(1)} s, ${frames} frames at 10 fps)${errors.length > 0 ? ` ERRORS ${errors.length}: ${errors[0]}` : ''}`);
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.log(`clip failed: ${String((e as Error).message ?? e)}`);
    process.exit(1);
  },
);
