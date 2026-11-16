/// <reference types="node" />
// npm run budgets: measures spec section 10 on the build output (builds first when dist is stale).
// One line per budget: "budget <name> value=<v> limit=<l> pass|fail". Exit 1 when any fails.
//  - app-js-gzip-kb: gzip of every dist JS file except the three.js chunk (name three*, or a chunk bigger than
//    150 KB containing WebGLRenderer) and basis/draco decoders; limit 150.
//  - first-load-download-mb: encoded bytes of everything fetched until the garden is ready (idle fallback when no
//    test API yet), fonts excluded, served gzip like a static host; limit 3.
//  - bed-payload-mb: per bed, atlas manifest plus its hi pages; limit 2 each. n/a until public/atlas exists.
//  - Lighthouse on ?mode=herbario: performance >= 90, accessibility >= 95, CLS 0, LCP <= 1.8 s with simulated
//    fast 4G (rtt 60 ms, 9 Mbps, CPU x4).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import lighthouse from 'lighthouse';
import { chromium } from '@playwright/test';
import { ensureBuild } from '../tests/helpers/build.ts';
import { serveDist } from '../tests/helpers/server.ts';

interface Row { name: string; value: string; limit: string; pass: boolean; note?: string }
const rows: Row[] = [];
const add = (name: string, value: number | null, limit: string, pass: boolean, note?: string): void => {
  rows.push({ name, value: value === null ? 'n/a' : String(Math.round(value * 1000) / 1000), limit, pass, ...(note !== undefined ? { note } : {}) });
};

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function appJs(): void {
  let total = 0;
  const skipped: string[] = [];
  for (const f of walk('dist').filter((f) => f.endsWith('.js'))) {
    const buf = readFileSync(f);
    const name = f.split('/').pop() ?? f;
    const isThree = /^three/i.test(name) || (buf.length > 150_000 && buf.includes('WebGLRenderer'));
    if (isThree || /basis|draco/i.test(name)) {
      skipped.push(name);
      continue;
    }
    total += gzipSync(buf, { level: 9 }).length;
  }
  add('app-js-gzip-kb', total / 1024, '<=150', total / 1024 <= 150, skipped.length ? `excluded ${skipped.join(',')}` : 'no three chunk yet');
}

function bedPayload(): void {
  const beds = walk('dist/atlas').filter((f) => /\/atlas\/[a-z]+\.json$/.test(f) && !/overview|shared/.test(f));
  if (beds.length === 0) {
    add('bed-payload-mb', null, '<=2 each', true, 'no beds yet');
    return;
  }
  for (const f of beds) {
    const m = JSON.parse(readFileSync(f, 'utf8')) as { id: string; pages: { color: { hi: string }; normal: { hi: string } }[] };
    let bytes = statSync(f).size;
    for (const p of m.pages) for (const v of [p.color.hi, p.normal.hi]) {
      const path = [join('dist/atlas', v), join('dist', v)].find(existsSync);
      if (path !== undefined) bytes += statSync(path).size;
    }
    add(`bed-payload-mb:${m.id}`, bytes / 2 ** 20, '<=2', bytes <= 2 * 2 ** 20);
  }
}

async function firstLoad(url: string): Promise<void> {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-gl=angle', '--use-angle=gl'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const pending: Promise<number>[] = [];
    page.on('response', (r) => {
      if (/\.(woff2?|ttf|otf)(\?|$)/.test(r.url()) || (r.headers()['content-type'] ?? '').startsWith('font/')) return;
      pending.push(r.request().sizes().then((s) => s.responseBodySize + s.responseHeadersSize, () => 0));
    });
    await page.goto(`${url}?mode=garden&bench=1`);
    await page.waitForFunction(() => (window as unknown as { __jardin?: { ready: Promise<void> } }).__jardin !== undefined, undefined, { timeout: 4000 })
      .then(() => page.evaluate(() => (window as unknown as { __jardin: { ready: Promise<void> } }).__jardin.ready))
      .catch(() => undefined);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    const bytes = (await Promise.all(pending)).reduce((a, b) => a + b, 0);
    add('first-load-download-mb', bytes / 2 ** 20, '<=3', bytes <= 3 * 2 ** 20, 'fonts excluded, gzip served');
  } finally {
    await browser.close();
  }
}

async function runLighthouse(url: string): Promise<void> {
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), 'jardin-lh-'));
  const exe = chromium.executablePath();
  const child = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) {
      if (await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok, () => false)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const res = await lighthouse(`${url}?mode=herbario`, { port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility'] }, {
      extends: 'lighthouse:default',
      settings: {
        throttlingMethod: 'simulate',
        throttling: { rttMs: 60, throughputKbps: 9 * 1024, cpuSlowdownMultiplier: 4, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 },
      },
    });
    const lhr = res?.lhr;
    if (lhr === undefined) throw new Error('lighthouse returned no result');
    const perf = (lhr.categories['performance']?.score ?? 0) * 100;
    const a11y = (lhr.categories['accessibility']?.score ?? 0) * 100;
    const cls = lhr.audits['cumulative-layout-shift']?.numericValue ?? NaN;
    const lcp = lhr.audits['largest-contentful-paint']?.numericValue ?? NaN;
    add('lighthouse-performance', perf, '>=90', perf >= 90);
    add('lighthouse-accessibility', a11y, '>=95', a11y >= 95);
    add('lighthouse-cls', cls, '=0', cls < 0.001);
    add('lighthouse-lcp-ms', lcp, '<=1800', lcp <= 1800, 'simulated fast 4G rtt 60 ms 9 Mbps cpu x4');
  } finally {
    child.kill('SIGKILL');
  }
}

const err = ensureBuild();
if (err !== null) {
  console.log(`budget build FAIL: ${err.split('\n')[0]}`);
  process.exit(1);
}
const server = await serveDist();
try {
  appJs();
  bedPayload();
  await firstLoad(server.url).catch((e: Error) => add('first-load-download-mb', null, '<=3', false, `measure failed: ${e.message.split('\n')[0]}`));
  await runLighthouse(server.url).catch((e: Error) => add('lighthouse', null, 'see names', false, `run failed: ${e.message.split('\n')[0]}`));
} finally {
  await server.close();
}
for (const r of rows) console.log(`budget ${r.name} value=${r.value} limit=${r.limit} ${r.pass ? 'pass' : 'FAIL'}${r.note ? ` (${r.note})` : ''}`);
process.exit(rows.every((r) => r.pass) ? 0 : 1);
