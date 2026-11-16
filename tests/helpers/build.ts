/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Rebuild dist/ only when a source file is newer than it, so stills, perf and e2e never test a stale build.

const WATCHED = ['src', 'content', 'public', 'index.html', 'vite.config.ts', 'scripts/prerender.ts', 'package.json'];

function newest(path: string): number {
  if (!existsSync(path)) return 0;
  const s = statSync(path);
  if (!s.isDirectory()) return s.mtimeMs;
  let m = s.mtimeMs;
  for (const name of readdirSync(path)) m = Math.max(m, newest(join(path, name)));
  return m;
}

export function distIsStale(root = resolve('.')): boolean {
  const index = join(root, 'dist', 'index.html');
  if (!existsSync(index)) return true;
  const built = statSync(index).mtimeMs;
  return WATCHED.some((p) => newest(join(root, p)) > built);
}

/** Returns an error string when the build fails, else null. */
export function ensureBuild(root = resolve('.'), force = false): string | null {
  if (!force && !distIsStale(root)) return null;
  const r = spawnSync('npm', ['run', '--silent', 'build'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? null : `build failed:\n${(r.stdout + r.stderr).split('\n').slice(-15).join('\n')}`;
}
