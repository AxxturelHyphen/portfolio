import { expect, test } from '@playwright/test';
import { Texture, Vector2, Vector3, Vector4 } from 'three';
import { createFilmDrive, halationGain } from '../../../src/gl/film.drive.ts';
import type { FilmUniforms } from '../../../src/types.ts';

// The film's own motion: the rail's gate weaves, free roam's holds still so no frame is resampled off the pixel grid.

function uniforms(): FilmUniforms {
  const tex = new Texture();
  return {
    uScene: { value: tex }, uHalation: { value: tex }, uRes: { value: new Vector2(1920, 1080) }, uScale: { value: 1 },
    uTime: { value: 0 }, uSeed: { value: 0 }, uGrain: { value: 0 }, uWeave: { value: new Vector2() }, uDust: { value: 0 },
    uFlicker: { value: 0 }, uVignette: { value: new Vector2() }, uSoft: { value: 0 }, uLift: { value: new Vector3() },
    uGamma: { value: new Vector3() }, uGain: { value: new Vector3() }, uTint: { value: [new Vector4(), new Vector4(), new Vector4()] },
    uIris: { value: new Vector4() }, uIrisColor: { value: new Vector3() }, uStrip: { value: new Vector4() },
    uProtect: { value: new Vector3() }, uStatic: { value: 0 }, uFilmOn: { value: 1 },
  };
}

function maxWeave(roam: boolean): number {
  const u = uniforms();
  const drive = createFilmDrive(u, { uScratch: { value: new Vector3() }, uHalGain: { value: 0 } }, roam);
  let most = 0;
  for (let i = 0; i < 240; i++) {
    drive.tick({ now: i * 16.7, dt: 0.0167, t: i * 0.0167, frame: i, frozen: false }, false, 1);
    most = Math.max(most, Math.abs(u.uWeave.value.x), Math.abs(u.uWeave.value.y));
  }
  return most;
}

test('the rail weaves the gate, free roam holds it on the pixel grid', () => {
  expect(maxWeave(false)).toBeGreaterThan(0);
  expect(maxWeave(true)).toBe(0);
});

test('free roam keeps the halation to a small glow', () => {
  expect(halationGain(true)).toBeLessThan(halationGain(false) / 2);
});
