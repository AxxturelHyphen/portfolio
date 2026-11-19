import { expect, test } from '@playwright/test';
import { createSoundControl, FADE_IN_S, type ContextLike } from '../../../src/audio/control.ts';
import type { SoundEngine } from '../../../src/audio/engine.ts';

// The sound control (src/audio/control.ts): no context before a gesture, one context made inside the first gesture in
// the garden with sound on, a fade in on start; mute, the Herbario and a hidden tab fade out and suspend; coming back
// resumes. The sound tag's own clicks are not gestures.

class FakeContext implements ContextLike {
  state: AudioContextState = 'suspended';
  resumes = 0;
  suspends = 0;
  resume(): Promise<void> {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspends++;
    this.state = 'suspended';
    return Promise.resolve();
  }
}

class FakeDoc extends EventTarget {
  hidden = false;
  show(hidden: boolean): void {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

function rig(on = true) {
  const target = new EventTarget();
  const doc = new FakeDoc();
  const made: FakeContext[] = [];
  const fades: Array<[number, number]> = [];
  const heard: Array<[number, number]> = [];
  let boxes = 0;
  let onTag = false;
  const engine: SoundEngine = {
    fade: (to, s) => void fades.push([to, s]),
    hear: (x, z) => void heard.push([x, z]),
    musicBox: () => void boxes++,
  };
  const control = createSoundControl<FakeContext>({
    target,
    doc,
    on,
    makeContext: () => {
      const c = new FakeContext();
      made.push(c);
      return c;
    },
    loadEngine: () => Promise.resolve(engine),
    ignore: () => onTag,
  });
  const gesture = (type: 'pointerup' | 'keydown' = 'pointerup', tag = false): void => {
    onTag = tag;
    target.dispatchEvent(new Event(type));
  };
  return { control, doc, made, fades, heard, gesture, boxes: () => boxes };
}

const settle = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('start: no context before a gesture; the first gesture in the garden makes one and fades in', async () => {
  const r = rig();
  r.control.setGarden(true);
  r.control.hear(18, 1);
  expect(r.made).toHaveLength(0);
  r.gesture('keydown');
  expect(r.made).toHaveLength(1);
  expect(r.made[0]?.state).toBe('running');
  await settle();
  expect(r.fades.at(-1)).toEqual([1, FADE_IN_S]);
  expect(r.heard.at(-1), 'the engine hears where the visitor already stands').toEqual([18, 1]);
  r.gesture();
  expect(r.made, 'one context for the visit').toHaveLength(1);
});

test('start: no context in the Herbario, with sound off, or from the sound tag itself', async () => {
  const herbario = rig();
  herbario.gesture();
  expect(herbario.made).toHaveLength(0);

  const off = rig(false);
  off.control.setGarden(true);
  off.gesture();
  expect(off.made).toHaveLength(0);
  off.control.setOn(true);
  expect(off.made, 'turning sound on is itself the gesture').toHaveLength(1);

  const tag = rig();
  tag.control.setGarden(true);
  tag.gesture('pointerup', true);
  tag.gesture('keydown', true);
  expect(tag.made, 'the tag decides on its own').toHaveLength(0);
  tag.control.setOn(false);
  expect(tag.made).toHaveLength(0);
});

test('mute: fades out and suspends; unmute resumes and fades back in', async () => {
  const r = rig();
  r.control.setGarden(true);
  r.gesture();
  await settle();
  const ctx = r.made[0] as FakeContext;
  r.control.setOn(false);
  expect(r.fades.at(-1)?.[0]).toBe(0);
  await settle(600);
  expect(ctx.state).toBe('suspended');
  r.control.setOn(true);
  expect(ctx.state).toBe('running');
  expect(r.fades.at(-1)).toEqual([1, FADE_IN_S]);
  expect(r.made).toHaveLength(1);
});

test('hidden tab: suspends at once and resumes on return; the Herbario goes quiet too', async () => {
  const r = rig();
  r.control.setGarden(true);
  r.gesture();
  await settle();
  const ctx = r.made[0] as FakeContext;
  r.doc.show(true);
  expect(ctx.state).toBe('suspended');
  expect(r.fades.at(-1)).toEqual([0, 0]);
  r.control.hear(3, 4);
  expect(r.heard.at(-1), 'nothing is heard while hidden').not.toEqual([3, 4]);
  r.doc.show(false);
  expect(ctx.state).toBe('running');
  expect(r.fades.at(-1)).toEqual([1, FADE_IN_S]);

  r.control.setGarden(false);
  await settle(600);
  expect(ctx.state).toBe('suspended');
  r.control.setGarden(true);
  expect(ctx.state).toBe('running');
});

test('music box: asked before the engine is in, it plays once the engine is; never while muted', async () => {
  const r = rig();
  r.control.setGarden(true);
  r.control.musicBox();
  r.gesture();
  expect(r.boxes()).toBe(0);
  await settle();
  expect(r.boxes()).toBe(1);
  r.control.setOn(false);
  r.control.musicBox();
  expect(r.boxes()).toBe(1);
});

test('duck: an open project brings the mix down, closing brings it back', async () => {
  const r = rig();
  r.control.setGarden(true);
  r.gesture();
  await settle();
  r.control.setDuck(true);
  expect(r.fades.at(-1)?.[0]).toBe(0.5);
  r.control.setDuck(false);
  expect(r.fades.at(-1)?.[0]).toBe(1);
});
