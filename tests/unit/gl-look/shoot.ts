/// <reference types="node" />
// Looks at the whole gl look: serves the gl-look page with a private Vite dev server (no project plugins, free port),
// takes the review stills at 1920x1080 on the GPU (headless, explicit viewport) and measures frame and film cost.
// Run: node tests/unit/gl-look/shoot.ts   Stills land in test-results/gl-look/.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { gpuLaunch } from '../../helpers/gpu.ts';

const root = resolve(import.meta.dirname, '../../..');
const out = resolve(root, 'test-results/gl-look');
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
  await page.goto(`http://127.0.0.1:${port}/tests/unit/gl-look/index.html`);
  await page.waitForFunction(() => 'look' in window, null, { timeout: 30_000 });
  await page.evaluate(() => window.look.ready);
  const size = await page.evaluate(() => [innerWidth, innerHeight]);
  const programsAfterWarm = await page.evaluate(() => window.look.info().programs);
  const shots: [string, Record<string, unknown>][] = [
    ['look', { t: 2 }],
    ['look-t3', { t: 3.25 }],
    ['key', { t: 2, key: true }],
    ['key-cursor', { t: 2, key: true, cursor: [9.4, 0.6, -0.4] }],
    ['cursor-left', { t: 2, cursor: [8.6, 1.1, -1.6] }],
    ['bypass', { t: 2, filmOn: false }],
    ['low', { t: 2, tier: 'low' }],
    ['reduced', { t: 2, reduced: true }],
  ];
  for (const [name, shot] of shots) {
    await page.evaluate((s) => window.look.show(s), shot);
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  const info = await page.evaluate(() => window.look.info());
  const high = await page.evaluate(() => window.look.time({ t: 2 }, 180));
  const low = await page.evaluate(() => window.look.time({ t: 2, tier: 'low' }, 180));
  const bypass = await page.evaluate(() => window.look.time({ t: 2, filmOn: false }, 180));
  const programsAfterAll = await page.evaluate(() => window.look.info().programs);
  console.log(JSON.stringify({ gpu: gpu.mode, size, high, low, bypass, info, programsAfterWarm, programsAfterAll, errors, out }, null, 1));
} finally {
  await browser.close();
  await server.close();
}
