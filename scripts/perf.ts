/// <reference types="node" />
// npm run perf [-- --tier high|mid|low] [--route auto|garden|herbario] [--no-build]
// ?bench=1 scripted tour. Prints ONE JSON line on stdout (diagnostics go to stderr):
//   { tier, route, drawCallsP95, textureMB, heapMB, frameAvg, frameP95, longTasks, longTasksOver100, devMachine }
// With the garden running, window.__jardin.tour() visits every bed and returns the line. Until then the Herbario
// route is measured (scroll, open and close a project) and the garden fields are null. Frame times are labelled
// "dev machine": only the counts are the gate. Low tier runs ?tier=low under 4x CPU throttle.
import { chromium, type Page } from '@playwright/test';
import { ensureBuild } from '../tests/helpers/build.ts';
import { gpuLaunch } from '../tests/helpers/gpu.ts';
import { serveDist } from '../tests/helpers/server.ts';

const argv = process.argv.slice(2);
const opt = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? dflt) : dflt;
};
const tier = opt('tier', 'high');
const route = opt('route', 'auto');
const log = (m: string): void => void console.error(`perf: ${m}`);
const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

interface Line {
  tier: string;
  route: 'garden' | 'herbario';
  drawCallsP95: number | null;
  textureMB: number | null;
  heapMB: number | null;
  frameAvg: number | null;
  frameP95: number | null;
  longTasks: number;
  longTasksOver100: number;
  devMachine: true;
}

async function heapMB(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const h = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
  return h.usedSize / 2 ** 20;
}

/** n: every long task; over100: those over 100 ms that started after load (garden ready), the spec section 10 gate.
 * loadMax: the longest task during load, informational. */
async function longTasks(page: Page): Promise<{ n: number; over100: number; loadMax: number }> {
  return page.evaluate(() => {
    const w = window as unknown as { __lt?: Array<[number, number]>; __readyAt?: number };
    const l = w.__lt ?? [];
    const at = w.__readyAt ?? 0;
    return {
      n: l.length,
      over100: l.filter(([s, d]) => s >= at && d > 100).length,
      loadMax: Math.round(Math.max(0, ...l.filter(([s]) => s < at).map(([, d]) => d))),
    };
  });
}

/** Scroll the Herbario top to bottom, then open and close the first project, recording rAF deltas throughout. */
async function herbarioRun(page: Page): Promise<{ deltas: number[] }> {
  await page.evaluate(() => {
    const w = window as unknown as { __d: number[]; __stop: boolean };
    w.__d = [];
    w.__stop = false;
    let last = performance.now();
    const tick = (n: number): void => {
      w.__d.push(n - last);
      last = n;
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let i = 1; i <= 24; i++) {
    await page.evaluate((y) => scrollTo(0, y), Math.round((height * i) / 24));
    await page.waitForTimeout(80);
  }
  await page.evaluate(() => scrollTo(0, 0));
  const target = page.locator('article[data-flower] .h-title').first();
  if ((await target.count()) > 0) {
    for (let i = 0; i < 3; i++) {
      await target.click().catch(() => undefined);
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  }
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const w = window as unknown as { __d: number[]; __stop: boolean };
    w.__stop = true;
    return { deltas: w.__d.slice(1, -1) };
  });
}

async function main(): Promise<number> {
  if (!argv.includes('--no-build')) {
    const err = ensureBuild();
    if (err !== null) {
      log(err);
      return 1;
    }
  }
  const gpu = gpuLaunch();
  const server = await serveDist();
  const browser = await chromium.launch({ headless: gpu.headless, args: gpu.args });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => {
      const w = window as unknown as { __lt: Array<[number, number]> };
      w.__lt = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) w.__lt.push([e.startTime, e.duration]);
      }).observe({ type: 'longtask', buffered: true });
    });
    const page = await ctx.newPage();
    if (tier === 'low') await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
    log(`gpu ${gpu.mode}, tier ${tier}`);

    let line: Line | null = null;
    if (route !== 'herbario') {
      await page.goto(`${server.url}?mode=garden&bench=1&tier=${tier}`);
      const has = await page.waitForFunction(() => (window as unknown as { __jardin?: unknown }).__jardin !== undefined, undefined, { timeout: route === 'garden' ? 30000 : 5000 }).then(() => true, () => false);
      if (has) {
        const t = await page.evaluate(async () => {
          const api = (window as unknown as { __jardin: { ready: Promise<void>; tour(): Promise<Record<string, number | string>> } }).__jardin;
          await api.ready;
          (window as unknown as { __readyAt: number }).__readyAt = performance.now();
          return api.tour();
        });
        const lt = await longTasks(page);
        if (lt.loadMax > 100) log(`note: a ${lt.loadMax} ms long task during load (before ready), not counted in longTasksOver100`);
        line = {
          tier: String(t['tier'] ?? tier), route: 'garden', drawCallsP95: Number(t['drawCallsP95']), textureMB: Number(t['textureMB']),
          heapMB: round(Number(t['heapMB'])), frameAvg: round(Number(t['frameAvg'])), frameP95: round(Number(t['frameP95'])),
          longTasks: Math.max(Number(t['longTasks'] ?? 0), lt.n), longTasksOver100: lt.over100, devMachine: true,
        };
      } else if (route === 'garden') {
        log('window.__jardin never appeared');
        return 1;
      } else log('no window.__jardin yet: measuring the Herbario route');
    }
    if (line === null) {
      await page.goto(`${server.url}?mode=herbario&bench=1&tier=${tier}`);
      await page.locator('#herbario article').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(1500);
      const { deltas } = await herbarioRun(page);
      const sorted = [...deltas].sort((a, b) => a - b);
      const lt = await longTasks(page);
      line = {
        tier, route: 'herbario', drawCallsP95: null, textureMB: null, heapMB: round(await heapMB(page)),
        frameAvg: sorted.length ? round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null,
        frameP95: sorted.length ? round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0) : null,
        longTasks: lt.n, longTasksOver100: lt.over100, devMachine: true,
      };
    }
    console.log(JSON.stringify(line));
    return 0;
  } finally {
    await browser.close();
    await server.close();
  }
}

process.exit(await main());
