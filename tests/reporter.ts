import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { gpuLaunch } from './helpers/gpu.ts';

// One summary line, then only failing test names (one per line, with a one-line cause). Nothing else prints.

class OneLine implements Reporter {
  private passed = 0;
  private failed: string[] = [];
  private fixme = 0;
  private skipped = 0;
  private start = Date.now();

  onTestEnd(test: TestCase, result: TestResult): void {
    const name = `${test.parent.project()?.name ?? '?'} > ${test.titlePath().slice(2).join(' > ')}`;
    if (test.annotations.some((a) => a.type === 'fixme')) {
      this.fixme++;
      return;
    }
    if (result.status === 'skipped') {
      this.skipped++;
      return;
    }
    if (result.status === 'passed') {
      this.passed++;
      return;
    }
    const cause = (result.error?.message ?? result.status).split('\n').find((l) => l.trim().length > 0) ?? result.status;
    this.failed.push(`FAIL ${name}: ${cause.replace(/\u001b\[[0-9;]*m/g, '').trim().slice(0, 160)}`);
  }

  onError(error: { message?: string }): void {
    this.failed.push(`ERROR ${(error.message ?? 'unknown').split('\n')[0]?.slice(0, 200) ?? ''}`);
  }

  onEnd(result: FullResult): void {
    const secs = Math.round((Date.now() - this.start) / 1000);
    const gpu = gpuLaunch().mode;
    const f = this.failed.length;
    const status = f > 0 || result.status === 'failed' ? 'FAIL' : 'ok';
    console.log(`e2e ${status}: ${this.passed} passed, ${f} failed, ${this.fixme} fixme, ${this.skipped} skipped (${gpu}, ${secs}s)`);
    for (const line of this.failed) console.log(line);
  }
}

export default OneLine;
