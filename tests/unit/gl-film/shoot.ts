/// <reference types="node" />
// Looks at the film pass: serves the bench page with a private Vite dev server (no project plugins, own free port),
// takes the review screenshots and measures the pass cost at 1080p. Run: node tests/unit/gl-film/shoot.ts
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { gpuLaunch } from '../../helpers/gpu.ts';

const root = resolve(import.meta.dirname, '../../..');
const out = resolve(root, 'test-results/gl-film');
mkdirSync(out, { recursive: true });

const server = await createServer({ root, configFile: false, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const address = server.httpServer?.address();
const port = typeof address === 'object' && address ? address.port : 0;
const gpu = gpuLaunch();
const browser = await chromium.launch({ headless: gpu.headless, args: gpu.args });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

try {
  await page.goto(`http://127.0.0.1:${port}/tests/unit/gl-film/index.html`);
  await page.waitForFunction(() => 'filmBench' in window);
  await page.evaluate(() => window.filmBench.ready);
  const programsAfterWarm = await page.evaluate(() => window.filmBench.programs());

  const shots: [string, Record<string, unknown>][] = [
    ['iris-0', { open: 0 }],
    ['iris-0.25', { open: 0.25 }],
    ['iris-0.5', { open: 0.5 }],
    ['iris-1', { open: 1 }],
    ['strip-0.5', { stripX: 0.5 }],
    ['strip-leg-0.5', { leg: 0.5 }],
    ['bypass', { filmOn: false }],
    ['low-tier', { tier: 'low' }],
  ];
  for (const [name, shot] of shots) {
    await page.evaluate((s) => window.filmBench.show(s), shot);
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  const clip = { x: 1500, y: 600, width: 240, height: 135 };
  for (const [name, shot] of [['grain-t1', { t: 1 }], ['grain-t2', { t: 2 }], ['grain-reduced-t1', { t: 1, reduced: true }], ['grain-reduced-t2', { t: 2, reduced: true }], ['grain-bypass', { filmOn: false }]] as const) {
    await page.evaluate((s) => window.filmBench.show(s), shot);
    await page.screenshot({ path: `${out}/${name}.png`, clip });
  }

  const high = await page.evaluate(() => window.filmBench.time({ open: 0 }, 240));
  const low = await page.evaluate(() => window.filmBench.time({ open: 0, tier: 'low' }, 240));
  const off = await page.evaluate(() => window.filmBench.time({ filmOn: false }, 240));
  const programsAfterAll = await page.evaluate(() => window.filmBench.programs());
  console.log(JSON.stringify({ gpu: gpu.mode, high, low, bypass: off, programsAfterWarm, programsAfterAll, errors, out }, null, 1));
} finally {
  await browser.close();
  await server.close();
}
