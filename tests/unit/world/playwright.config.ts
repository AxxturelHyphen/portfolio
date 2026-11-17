import { defineConfig } from '@playwright/test';

// World unit tests only (pure TS, no browser page, no server): `npx playwright test -c tests/unit/world/playwright.config.ts`.
// The main config also runs them in npm run check.
export default defineConfig({ testDir: '.', testMatch: '*.spec.ts', workers: 1, outputDir: '../../../test-results/world' });
