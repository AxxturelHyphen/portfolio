/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Text and architecture rules that hold in code and data (cook/ARCH.md header, spec section 8).

const EM_DASH = String.fromCharCode(0x2014);

function walk(dir: string, exts: readonly string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

const TEXT = ['.ts', '.mjs', '.js', '.json', '.css', '.html', '.md', '.txt'];

test('no em dash in source, content, scripts, tests', () => {
  // src/content/schema.ts holds the literal it scans for: the one allowed occurrence.
  const files = [...walk('src', TEXT), ...walk('content', TEXT), ...walk('scripts', TEXT), ...walk('tests', TEXT), 'index.html'].filter((f) => f !== 'src/content/schema.ts');
  const bad = files.filter((f) => readFileSync(f, 'utf8').includes(EM_DASH));
  expect(bad, 'files with an em dash').toEqual([]);
});

test('source files stay under 400 lines', () => {
  const bad = walk('src', ['.ts', '.css', '.glsl']).filter((f) => readFileSync(f, 'utf8').split('\n').length > 400);
  expect(bad, 'files over 400 lines').toEqual([]);
});

test('core, ui, content and boot never import three at runtime', () => {
  const files = [...walk('src/core', ['.ts']), ...walk('src/ui', ['.ts']), ...walk('src/content', ['.ts']), 'src/boot.ts'];
  const bad = files.filter((f) => /^\s*import\s+(?!type\b)[^;]*from\s+['"]three(\/[^'"]*)?['"]/m.test(readFileSync(f, 'utf8')));
  expect(bad, 'runtime three imports outside gl, world, garden').toEqual([]);
});
