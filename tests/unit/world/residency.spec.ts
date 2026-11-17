import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createResidency } from '../../../src/world/residency.ts';
import type { StreamBed } from '../../../src/world/bed.ts';
import type { AtlasManifest, BedId, BedState, GardenLayout, Gfx, Machine, Quality } from '../../../src/types.ts';

// Residency policy with fake beds (no GPU): which beds are wanted, disposal on leave, budget gate, grotto rule.

const garden = JSON.parse(readFileSync(new URL('../../../content/garden.json', import.meta.url), 'utf8')) as GardenLayout;
const PAGE = 1024;
const manifest = { pages: [{ w: PAGE, h: PAGE }] } as AtlasManifest;

class FakeBed {
  state: BedState = 'cold';
  gpuBytes = 0;
  manifest: AtlasManifest | null = null;
  loads = 0;
  constructor(readonly id: BedId) {}
  prefetch(): Promise<void> {
    this.manifest = manifest;
    if (this.state === 'cold' || this.state === 'disposed') this.state = 'prefetched';
    return Promise.resolve();
  }
  load(): Promise<void> {
    this.loads++;
    this.state = 'ready';
    this.gpuBytes = PAGE * PAGE;
    return Promise.resolve();
  }
  dispose(): void {
    this.state = 'disposed';
    this.gpuBytes = 0;
  }
}

function setup(budgetMB = 128) {
  const beds = new Map(garden.order.map((b) => [b, new FakeBed(b)]));
  const machine = { ch: { open: { settled: true } } } as unknown as Machine;
  const quality = { cfg: { texBudgetMB: budgetMB } } as Quality;
  const gfx = { film: { targetBytes: 0 } } as Gfx;
  const res = createResidency(beds as unknown as Map<BedId, StreamBed>, garden, machine, quality, gfx);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const states = () => Object.fromEntries([...beds].map(([b, bed]) => [b, bed.state]));
  return { res, beds, flush, states };
}

test('active bed and both neighbours become resident, the rest stay cold', async () => {
  const { res, flush, states } = setup();
  res.want('rosaleda', null, null);
  await flush();
  expect(states()).toEqual({ puerta: 'ready', rosaleda: 'ready', estanque: 'ready', semillero: 'cold', gruta: 'cold', salida: 'cold' });
});

test('leaving residency disposes at once and bytes drop', async () => {
  const { res, flush, states } = setup();
  res.want('rosaleda', null, null);
  await flush();
  res.want('salida', null, null);
  await flush();
  expect(states().puerta).toBe('disposed');
  expect(states().rosaleda).toBe('disposed');
  expect(states().salida).toBe('ready');
  res.want(null, null, null);
  await flush();
  res.tick({ now: 0, dt: 0, t: 0, frame: 0, frozen: false });
  expect(res.bytes.beds).toBe(0);
});

test('the grotto is resident only while its host is involved', async () => {
  const { res, flush, states } = setup();
  res.want('estanque', null, null);
  await flush();
  expect(states().gruta).toBe('cold');
  res.want('semillero', null, null);
  await flush();
  expect(states().gruta).toBe('ready');
  res.want('gruta', null, null);
  await flush();
  expect(states()).toMatchObject({ gruta: 'ready', semillero: 'ready', salida: 'ready', estanque: 'disposed' });
});

test('travel keeps the bed being left and loads the target first', async () => {
  const { res, beds, flush } = setup();
  res.want('puerta', 'salida', null);
  await flush();
  expect(beds.get('salida')?.loads).toBe(1);
  expect(beds.get('puerta')?.state).toBe('ready');
});

test('hover prefetches bytes only', async () => {
  const { res, flush, states } = setup();
  res.want(null, null, 'estanque');
  await flush();
  expect(states().estanque).toBe('prefetched');
});

test('a load never starts over budget', async () => {
  const mb = (PAGE * PAGE * (4 / 3) * 1.25) / 2 ** 20;
  const { res, flush, states } = setup(mb * 2);
  res.want('rosaleda', null, null);
  await flush();
  const loaded = Object.values(states()).filter((s) => s === 'ready').length;
  expect(loaded).toBeLessThanOrEqual(2);
  expect(states().rosaleda).toBe('ready');
  await expect(res.whenReady('rosaleda')).resolves.toBeUndefined();
});

test('load work waits for a granted frame: one upload per tick, nothing while ch.open moves', async () => {
  const open = { settled: false };
  const machine = { ch: { open } } as unknown as Machine;
  const gated = createResidency(new Map() as Map<BedId, StreamBed>, garden, machine, { cfg: { texBudgetMB: 1 } } as Quality, { film: { targetBytes: 0 } } as Gfx);
  const clock = { now: 0, dt: 0.016, t: 0, frame: 0, frozen: false };
  let uploads = 0;
  const job = (async () => {
    for (let i = 0; i < 3; i++) {
      await gated.upload();
      uploads++;
    }
  })();
  const flush = () => new Promise((r) => setTimeout(r, 0));
  gated.tick(clock);
  await flush();
  expect(uploads, 'no grant while the panel animates').toBe(0);
  open.settled = true;
  for (let f = 1; f <= 3; f++) {
    gated.tick(clock);
    await flush();
    expect(uploads).toBe(f);
  }
  await job;
});

test('whenReady settles: it rejects when the bed leaves residency before it is ready', async () => {
  const { res, flush } = setup(0);
  res.want('rosaleda', null, null);
  const waiting = res.whenReady('rosaleda');
  res.want('salida', null, null);
  await expect(waiting).rejects.toThrow('left residency');
  await flush();
});
