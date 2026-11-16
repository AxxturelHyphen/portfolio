// npm run check: typecheck, build, budgets, e2e, licence, in order. Stops and exits 1 on the first failure.
import { spawnSync } from 'node:child_process';

const STEPS = ['typecheck', 'build', 'budgets', 'e2e', 'licence'];

for (const step of STEPS) {
  const r = spawnSync('npm', ['run', '--silent', step], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`check failed at: ${step}`);
    process.exit(1);
  }
}
console.log(`check passed: ${STEPS.join(', ')}`);
