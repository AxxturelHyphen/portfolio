import { expect, test } from '@playwright/test';
import { createProximity, PROXIMITY } from '../../../src/world/proximity.ts';
import { bedAhead, HEADING } from '../../../src/world/roam.ts';
import type { BedId, SlotView } from '../../../src/types.ts';

// Proximity focus (cook/ROAM_PLAN.md section 3, P4): nearest slot in reach, hysteresis, yielding to hover, keyboard,
// taps and Esc until the visitor walks a metre; and the streaming heading (the bed ahead of the walking visitor).

const slot = (id: string, kind: SlotView['kind'], x: number, z: number): SlotView => ({ id, kind, world: [x, 1, z], hit: [0.5, 0.5], alt: id });
const ROSE = slot('rosaleda/rose-a', 'project', 0, 0);
const LINK = slot('salida/postcard-a', 'link', 4, 0);
const PROP = slot('estanque/sundial', 'prop', 0, 4);
const ALL = [ROSE, LINK, PROP];
const { reachM, hysteresisM, yieldM } = PROXIMITY;

test('the nearest slot in reach is wanted, none beyond reach, projects, links and props alike', () => {
  const p = createProximity();
  p.setSlots(ALL);
  expect(p.update(0, reachM + 0.01 + 4)).toBe(true);
  expect(p.want).toBeNull();
  p.update(0, -reachM + 0.01);
  expect(p.want).toBe(ROSE.id);
  p.update(4, 1);
  expect(p.want).toBe(LINK.id);
  const q = createProximity();
  q.setSlots(ALL);
  q.update(0.5, 3);
  expect(q.want).toBe(PROP.id);
});

test('a flower with its own stand point is reached from there, not from where it floats', () => {
  const lily: SlotView = { ...slot('estanque/lily-a', 'project', 0, 0), stand: [0, 2.5] };
  const p = createProximity();
  p.setSlots([lily]);
  p.update(0, 2.5 + reachM + 0.01);
  expect(p.want, 'beyond reach of the stand point').toBeNull();
  p.update(0, 2.5 + reachM - 0.01);
  expect(p.want, 'within reach of the stand point, 4.7 m from the flower').toBe(lily.id);
  p.update(0, -0.5);
  expect(p.want, 'next to the flower but 3 m from its stand point, past reach and margin').toBeNull();
});

test('hysteresis: a held slot stays until past reach plus the margin; another must be nearer by the margin', () => {
  const p = createProximity();
  p.setSlots([ROSE]);
  p.update(0, 2);
  expect(p.want).toBe(ROSE.id);
  p.update(0, reachM + hysteresisM - 0.01);
  expect(p.want).toBe(ROSE.id);
  p.update(0, reachM + hysteresisM + 0.01);
  expect(p.want).toBeNull();
  p.update(0, reachM + 0.1);
  expect(p.want).toBeNull();
  p.update(0, reachM - 0.05);
  expect(p.want).toBe(ROSE.id);
  // The rose at z 0 and the sundial at z 4: the sundial must be nearer by the margin before it takes over.
  const q = createProximity();
  q.setSlots([ROSE, PROP]);
  q.update(0, 1.9);
  expect(q.want).toBe(ROSE.id);
  q.update(0, 2 + hysteresisM / 2 - 0.01);
  expect(q.want).toBe(ROSE.id);
  q.update(0, 2 + hysteresisM / 2 + 0.01);
  expect(q.want).toBe(PROP.id);
});

test('hover, keyboard, a tap or Esc win until the visitor has walked a metre', () => {
  const p = createProximity();
  p.setSlots(ALL);
  p.update(0, 1);
  expect(p.want).toBe(ROSE.id);
  p.yieldAt(0, 1);
  expect(p.want).toBeNull();
  expect(p.update(0, 1)).toBe(false);
  expect(p.update(0.6, 1.6)).toBe(false);
  expect(p.update(yieldM - 0.01, 1)).toBe(false);
  expect(p.update(yieldM + 0.01, 1)).toBe(true);
  expect(p.want).toBe(ROSE.id);
});

test('slots of a bed that is left are dropped', () => {
  const p = createProximity();
  p.setSlots(ALL);
  p.update(0, 1);
  expect(p.want).toBe(ROSE.id);
  p.setSlots([]);
  expect(p.want).toBeNull();
  p.update(0, 1);
  expect(p.want).toBeNull();
});

test('heading: the bed ahead in the walking direction once within the lookahead', () => {
  const beds: BedId[] = ['puerta', 'rosaleda', 'estanque'];
  const bounds: Record<string, readonly [number, number]> = { puerta: [-3, 4], rosaleda: [6.3, 13.8], estanque: [17, 24.4] };
  const of = (b: BedId): readonly [number, number] => bounds[b] as readonly [number, number];
  const w = HEADING.withinM;
  expect(bedAhead(1, 1, beds, of, w)).toBe('rosaleda');
  expect(bedAhead(6.3 - w - 0.01, 1, beds, of, w)).toBeNull();
  expect(bedAhead(12, 1, beds, of, w)).toBe('estanque');
  expect(bedAhead(10, -1, beds, of, w)).toBe('puerta');
  expect(bedAhead(20, 1, beds, of, w)).toBeNull();
  expect(bedAhead(15, -1, beds, of, w)).toBe('rosaleda');
});
