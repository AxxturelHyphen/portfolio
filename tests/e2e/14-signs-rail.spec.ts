import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '../helpers/jardin.ts';

// On the rail fallback (?roam=0) the signposts stay exactly as they were before free roam: for a recorded walk along the
// path, the signs' DOM, attributes and inline transforms equal the values recorded from the code before roam signs existed.
// JARDIN_RECORD=1 rewrites the record (only ever from that code).

const RECORD = 'tests/e2e/signs-rail.json';
const WALK = ['#/b/puerta', '#/b/rosaleda', '#/b/estanque', '#/b/semillero', '#/b/salida', '#/b/rosaleda'];

test('signposts on the rail: DOM and inline styles equal the record', async ({ page, jardin }, info) => {
  await jardin.visit({ mode: 'garden', hash: '#/b/puerta', query: { t: '12.5' }, rail: true });
  await jardin.withApi((api) => api.ready);
  const seen: string[] = [];
  for (const hash of WALK) {
    await jardin.goto(hash, true);
    await jardin.settled();
    seen.push(await page.evaluate(() => document.querySelector('.px-signs')?.outerHTML ?? ''));
  }
  const all = existsSync(RECORD) ? (JSON.parse(readFileSync(RECORD, 'utf8')) as Record<string, string[]>) : {};
  if (process.env['JARDIN_RECORD'] === '1') {
    all[info.project.name] = seen;
    writeFileSync(RECORD, `${JSON.stringify(all, null, 1)}\n`);
  }
  expect(seen).toEqual(all[info.project.name]);
});
