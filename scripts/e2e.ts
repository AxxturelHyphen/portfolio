/// <reference types="node" />
// npm run e2e [-- <playwright args>]: builds dist if stale, runs the Playwright projects (tests/playwright.config.ts)
// and prints ONE summary line plus only the failing test names (tests/reporter.ts). Exit 1 on any failure.
// Examples: npm run e2e -- --project=desktop    npm run e2e -- -g "flow 1"
import { spawnSync } from 'node:child_process';
import { ensureBuild } from '../tests/helpers/build.ts';

const err = ensureBuild();
if (err !== null) {
  console.log(`e2e FAIL: ${err.split('\n')[0]}`);
  console.log(err);
  process.exit(1);
}

const r = spawnSync('node_modules/.bin/playwright', ['test', '-c', 'tests/playwright.config.ts', ...process.argv.slice(2)], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
process.stdout.write(r.stdout);
// Anything on stderr with no summary means Playwright itself failed to start (bad config, missing browser).
if (!/^e2e (ok|FAIL):/m.test(r.stdout)) {
  console.log(`e2e FAIL: playwright did not report. ${(r.stderr.split('\n').find((l) => l.trim()) ?? '').slice(0, 200)}`);
  process.exit(1);
}
process.exit(r.status === 0 ? 0 : 1);
