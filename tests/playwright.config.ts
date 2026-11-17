/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';
import { gpuLaunch } from './helpers/gpu.ts';
import type { Options } from './helpers/jardin.ts';

// Playwright config (spec section 11). Four profiles: desktop 1920x1080 and mobile 390x844, each also as a low-tier
// variant (?tier=low plus 4x CPU throttle through CDP). One worker: frame-time budgets need an undisturbed GPU.
// webServer is vite preview on its own free port so nobody else's preview is reused by accident.

/** A free port per run, shared with the workers through the environment, so two runs never fight over one. */
function freePort(): number {
  const script = "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})";
  return Number(spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' }).stdout.trim());
}
const PORT = Number((process.env['JARDIN_E2E_PORT'] ??= String(freePort())));
const gpu = gpuLaunch();
const base = { launchOptions: { headless: gpu.headless, args: gpu.args }, deviceScaleFactor: 1, trace: 'off' as const };
const desktop = { ...base, viewport: { width: 1920, height: 1080 } };
const mobile = { ...base, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

export default defineConfig<Options>({
  testDir: '.',
  testMatch: ['e2e/*.spec.ts', 'unit/**/*.spec.ts'],
  /** gl-cutout runs on its own Vite page and config (tests/unit/gl-cutout/playwright.config.ts). */
  testIgnore: ['unit/gl-cutout/**'],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 6000 },
  outputDir: '../test-results',
  reporter: [['./reporter.ts']],
  use: { baseURL: `http://127.0.0.1:${PORT}/`, tierOpt: null, cpuThrottle: 1 },
  webServer: {
    cwd: process.cwd(),
    command: `node_modules/.bin/vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 30_000,
  },
  projects: [
    { name: 'desktop', testMatch: 'e2e/*.spec.ts', use: { ...desktop } },
    { name: 'mobile', testMatch: 'e2e/*.spec.ts', use: { ...mobile } },
    { name: 'desktop-low', testMatch: 'e2e/*.spec.ts', use: { ...desktop, tierOpt: 'low', cpuThrottle: 4 } },
    { name: 'mobile-low', testMatch: 'e2e/*.spec.ts', use: { ...mobile, tierOpt: 'low', cpuThrottle: 4 } },
    { name: 'unit', testMatch: 'unit/**/*.spec.ts', use: {} },
  ],
});
