/// <reference types="node" />
import { defineConfig } from '@playwright/test';
import { gpuLaunch } from '../../helpers/gpu.ts';

// Runs only the gl-cutout visual check: `npx playwright test -c tests/unit/gl-cutout/playwright.config.ts`.
const PORT = Number(process.env['GL_CUTOUT_PORT'] ?? 5391);
const gpu = gpuLaunch();

export default defineConfig({
  testDir: '.',
  testMatch: ['cutout.spec.ts', 'depth.spec.ts'],
  workers: 1,
  outputDir: '../../../test-results/gl-cutout',
  use: { baseURL: `http://127.0.0.1:${PORT}/`, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, launchOptions: { headless: gpu.headless, args: gpu.args } },
  webServer: {
    command: `node_modules/.bin/vite --config tests/unit/gl-cutout/vite.config.ts --port ${PORT} --strictPort --host 127.0.0.1`,
    cwd: '../../..',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
