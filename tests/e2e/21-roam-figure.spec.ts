import { expect, test } from '../helpers/jardin.ts';

// The visitor is the burlap doll from the first frame after ready: at a cold start and placed by URL at a bed
// (?roam=1 with a stand, also under frozen time), never the lantern on its crook for more than a step.

const FIRST_SECOND_MS = 1000;

for (const [name, hash, query] of [
  ['cold start', '#/', {}],
  ['placed by URL at the Rosaleda', '#/b/rosaleda', { roam: '1' }],
  ['placed by URL under frozen time', '#/b/semillero', { roam: '1', t: '12.5' }],
] as const) {
  test(`roam figure: drawn within a second of ready, ${name}`, async ({ jardin }) => {
    await jardin.visit({ mode: 'garden', hash, query });
    await jardin.withApi((api) => api.ready);
    await expect.poll(() => jardin.withApi((api) => api.figure()), { timeout: FIRST_SECOND_MS, intervals: [50] }).toBe(true);
  });
}
