import { AdditiveBlending, BufferAttribute, DynamicDrawUsage, GLSL3, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, RawShaderMaterial, Sphere, Vector3 } from 'three';
import type { Clock } from '../types.ts';
import { FLY_LIGHTS, sharedUniforms } from './lights.ts';
import common from './shaders/common.glsl?raw';
import vertexBody from './shaders/fireflies.vert.glsl?raw';
import fragmentBody from './shaders/fireflies.frag.glsl?raw';

/**
 * Fireflies (sparse, warm, drifting at the full rate, blinking on the 12 fps grid: MOTION C19, C20) and dust motes that
 * exist only inside the hand light, in one instanced additive draw after every cutout. The first FLY_LIGHTS fireflies
 * also light the paper and the ground near them (lights.ts uFly). The tier's `fireflies` count is the instance cap:
 * a quarter are fireflies, the rest motes.
 */
export interface Fireflies {
  readonly mesh: Mesh;
  /** Pocket centres and radii as x, y, z, r quads (cook/ART.md: at most 3 pockets per frame). Load time. */
  setPockets(p: readonly number[]): void;
  /** Instance cap from the tier; never above the capacity given at creation. */
  setCount(n: number): void;
  update(c: Clock): void;
  dispose(): void;
}

/** Gate foot, rose bed, skep (cook/ART.md section 2.0). */
const ART_POCKETS = [0.8, 0.5, -3.9, 1.2, 10.4, 0.9, -2.6, 1.6, 35.4, 1.1, 0.0, 1.3];
const FLY_SIZE = 0.09;
const MOTE_SIZE = 0.006;
/** Blink envelope in seconds: in 400 ms, hold, out 1100 ms (MOTION C19), then dark for the rest of the period. */
const BLINK = { in: 0.4, hold: 0.5, out: 1.1, minPeriod: 2.6, spread: 3.2 } as const;
const FLY_SHARE = 0.25;
/** Fireflies paint after every bed layer. */
export const FIREFLY_ORDER = 1e5;

const fract = (x: number): number => x - Math.floor(x);
/** Integer hash (no sine banding): neighbouring flies land apart, never in a row. */
function hash(i: number, k: number): number {
  let n = Math.imul(i * 374761393 + k * 668265263, 0x27d4eb2d);
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

/** A coordinate that drifts by `moved` box lengths and wraps inside -reach..reach. */
const drift = (base: number, moved: number, reach: number): number => (fract(base + moved) * 2 - 1) * reach;

function blink(t: number, period: number, phase: number): number {
  const local = fract(t / period + phase) * period;
  if (local < BLINK.in) return local / BLINK.in;
  if (local < BLINK.in + BLINK.hold) return 1;
  const out = local - BLINK.in - BLINK.hold;
  return out < BLINK.out ? Math.exp(-out / (BLINK.out / 3)) * (1 - out / BLINK.out) : 0;
}

export function createFireflies(capacity: number): Fireflies {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.boundingSphere = new Sphere(new Vector3(), Number.MAX_VALUE);
  const fly = new Float32Array(capacity * 4);
  const flyAttr = new InstancedBufferAttribute(fly, 4).setUsage(DynamicDrawUsage);
  const look = new Float32Array(capacity * 2);
  geometry.setAttribute('aFly', flyAttr);
  geometry.setAttribute('aLook', new InstancedBufferAttribute(look, 2));
  geometry.instanceCount = 0;

  const uniforms = {
    uViewProj: sharedUniforms.uViewProj,
    uCamRight: sharedUniforms.uCamRight,
    uCamUp: sharedUniforms.uCamUp,
    uFlyColor: sharedUniforms.uFlyColor,
    uCursorColor: sharedUniforms.uCursorColor,
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: common + vertexBody,
    fragmentShader: common + fragmentBody,
    uniforms,
    transparent: true,
    premultipliedAlpha: true,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = FIREFLY_ORDER;

  const pockets = new Float32Array(12);
  let pocketCount = 0;
  let count = 0;
  let flies = 0;

  const setPockets = (p: readonly number[]): void => {
    pocketCount = Math.min(3, Math.floor(p.length / 4));
    for (let i = 0; i < pocketCount * 4; i++) pockets[i] = p[i] ?? 0;
  };
  const setCount = (n: number): void => {
    count = Math.max(0, Math.min(capacity, Math.floor(n)));
    flies = Math.max(1, Math.round(count * FLY_SHARE));
    for (let i = 0; i < count; i++) {
      const isFly = i < flies;
      look[i * 2] = isFly ? FLY_SIZE * (0.8 + 0.4 * hash(i, 1)) : MOTE_SIZE * (0.7 + 0.6 * hash(i, 2));
      look[i * 2 + 1] = isFly ? 0 : 1;
    }
    (geometry.getAttribute('aLook') as InstancedBufferAttribute).needsUpdate = true;
    geometry.instanceCount = count;
  };
  setPockets(ART_POCKETS);
  setCount(capacity);

  return {
    mesh,
    setPockets,
    setCount,
    update(c: Clock): void {
      const t = c.t;
      const stepped = Math.floor(t * 12) / 12;
      const cur = sharedUniforms.uCursor.value;
      const reach = cur.w * 0.6;
      for (let i = 0; i < count; i++) {
        const o = i * 4;
        if (i < flies) {
          const p = (i % Math.max(1, pocketCount)) * 4;
          const r = pocketCount > 0 ? (pockets[p + 3] ?? 1) : 0;
          const a = hash(i, 3) * 6.283;
          const d = Math.sqrt(hash(i, 4)) * r;
          fly[o] = (pockets[p] ?? 0) + Math.cos(a) * d + 0.35 * Math.sin(t * (0.21 + 0.2 * hash(i, 5)) + a);
          fly[o + 1] = (pockets[p + 1] ?? 0) + (hash(i, 6) - 0.4) * 0.8 + 0.18 * Math.sin(t * (0.37 + 0.2 * hash(i, 7)) + 2 * a);
          fly[o + 2] = (pockets[p + 2] ?? 0) + Math.sin(a) * d * 0.6 + 0.25 * Math.cos(t * (0.17 + 0.15 * hash(i, 8)) + a);
          fly[o + 3] = pocketCount > 0 ? blink(stepped, BLINK.minPeriod + BLINK.spread * hash(i, 9), hash(i, 10)) : 0;
        } else {
          // Motes live in a box around the hand light and drift through it on the 12 fps grid.
          const x = drift(hash(i, 11), stepped * (0.013 + 0.01 * hash(i, 14)), reach);
          const y = drift(hash(i, 12), stepped * (-0.02 - 0.012 * hash(i, 15)), reach);
          const z = drift(hash(i, 13), stepped * 0.008, reach);
          fly[o] = cur.x + x;
          fly[o + 1] = cur.y + y;
          fly[o + 2] = cur.z + z;
          const f = 1 - (x * x + y * y + z * z) / (reach * reach);
          fly[o + 3] = f > 0 ? f * f * (0.5 + 0.5 * hash(i, 16)) : 0;
        }
      }
      flyAttr.needsUpdate = true;
      const lights = sharedUniforms.uFly.value;
      for (let k = 0; k < FLY_LIGHTS; k++) {
        const v = lights[k];
        if (v === undefined) continue;
        if (k < flies && k < count) v.set(fly[k * 4] ?? 0, fly[k * 4 + 1] ?? 0, fly[k * 4 + 2] ?? 0, fly[k * 4 + 3] ?? 0);
        else v.w = 0;
      }
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
