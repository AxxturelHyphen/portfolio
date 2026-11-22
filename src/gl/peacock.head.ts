import { CatmullRomCurve3, ConeGeometry, CylinderGeometry, Matrix4, Quaternion, SphereGeometry, TubeGeometry, Vector3 } from 'three';
import type { BufferAttribute, Mesh, TypedArray } from 'three';
import { peacockHead } from '../world/peacock.head.ts';
import { SolidBuilder } from './masonry.ts';
import type { SolidPaint } from './solid.paint.ts';

/**
 * The peacock's upright neck and head (world/peacock.head.ts) as real geometry in the draw of the solids after the cards
 * (garden/place.ts: ground stones and props), so it costs no draw call on any tier and paints over the wall's cards. It is built once in the bird's own frame, in body heights from its foot (x along the plate, the
 * head looking to -x as the preening head does, y up, z out of the plate's face): a tapered S-curved neck from the top
 * centre of the body, an egg of a head with a short beak, a dark eye on each side and the fan crest of bare shafts with
 * round tips. Each placement rewrites only the head's vertex range of that draw's buffers: turned by the bird's yaw, scaled
 * by its height and tinted with its tint.
 */

const NECK: readonly (readonly [number, number, number])[] = [
  [0, 0.86, 0.05], [0.04, 0.98, 0.07], [0.02, 1.1, 0.08], [-0.03, 1.19, 0.08], [-0.045, 1.25, 0.08],
];
const NECK_R = { base: 0.058, top: 0.027 } as const;
const TUBE = { along: 24, round: 8 } as const;
const HEAD = { at: [-0.075, 1.29, 0.08], r: [0.07, 0.05, 0.046] } as const;
const BEAK = { at: [-0.16, 1.28, 0.08], len: 0.055, r: 0.016 } as const;
/** An eye each side of the head's mid-plane, `side` out from it. */
const EYE = { x: -0.1, y: 1.3, side: 0.038, r: 0.012 } as const;
/** Five shafts from the crown, fanned about a slight lean back (radians about z, + toward the beak). */
const CREST = { at: [-0.07, 1.33, 0.08], len: 0.085, r: 0.005, tip: 0.016, lean: -0.25, fan: 0.22 } as const;
const PLUMAGE: SolidPaint = { tile: 'tile/paper', tint: [1, 1, 1] };
const BEAK_PAINT: SolidPaint = { tile: 'tile/paper', tint: [0.78, 0.72, 0.6] };
const EYE_PAINT: SolidPaint = { tile: 'tile/paper', tint: [0.08, 0.07, 0.08] };
/** The solid shader lights paper otherwise than the cutouts: this factor on the bird's tint matches the plate's white. */
const TONE = [5.3, 6.1, 10.2] as const;
const HIDDEN = [1, 1, 1] as const;

/** Narrows the radius-1 tube from the base radius to the top one along its rings. */
function taper(neck: TubeGeometry, curve: CatmullRomCurve3): void {
  const p = neck.getAttribute('position');
  const centre = new Vector3();
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    const u = Math.floor(i / (TUBE.round + 1)) / TUBE.along;
    curve.getPointAt(u, centre);
    v.fromBufferAttribute(p, i).sub(centre).multiplyScalar(NECK_R.base + (NECK_R.top - NECK_R.base) * u).add(centre);
    p.setXYZ(i, v.x, v.y, v.z);
  }
}

function bird(): SolidBuilder {
  const b = new SolidBuilder().paint(PLUMAGE);
  const m = new Matrix4();
  const q = new Quaternion();
  const at = new Vector3();
  const size = new Vector3();
  const curve = new CatmullRomCurve3(NECK.map(([x, y, z]) => new Vector3(x, y, z)));
  const neck = new TubeGeometry(curve, TUBE.along, 1, TUBE.round);
  taper(neck, curve);
  b.merge(neck, m);
  b.merge(new SphereGeometry(NECK_R.base, 10, 6), m.makeTranslation(curve.getPointAt(0)));
  b.merge(new SphereGeometry(1, 14, 10), m.compose(at.fromArray(HEAD.at), q, size.fromArray(HEAD.r)));
  for (let i = -2; i <= 2; i++) {
    const tilt = CREST.lean + i * CREST.fan;
    q.setFromAxisAngle(new Vector3(0, 0, 1), tilt);
    const dir = new Vector3(0, 1, 0).applyQuaternion(q);
    at.fromArray(CREST.at).addScaledVector(dir, CREST.len / 2);
    b.merge(new CylinderGeometry(CREST.r, CREST.r, CREST.len, 4, 1, true), m.compose(at, q, size.setScalar(1)));
    at.addScaledVector(dir, CREST.len / 2);
    b.merge(new SphereGeometry(CREST.tip, 8, 6), m.compose(at, q, size.set(1, 1, 0.6)));
  }
  b.paint(BEAK_PAINT);
  q.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
  b.merge(new ConeGeometry(BEAK.r, BEAK.len, 8), m.compose(at.fromArray(BEAK.at), q, size.setScalar(1)));
  b.paint(EYE_PAINT);
  for (const side of [-1, 1]) {
    at.set(EYE.x, EYE.y, HEAD.at[2] + side * EYE.side);
    b.merge(new SphereGeometry(EYE.r, 8, 6), m.makeTranslation(at));
  }
  return b;
}

/** Marks the head's float range of one of the draw's attributes for upload. */
function touch(a: BufferAttribute, from: number, floats: number): void {
  a.clearUpdateRanges();
  a.addUpdateRange(from, floats);
  a.needsUpdate = true;
}

/**
 * Adds the head to a solids builder (hidden until placed) and returns the hook that binds it to that builder's mesh,
 * which then serves peacockHead.draw.
 */
export function peacockHeadInto(solids: SolidBuilder): (mesh: Mesh) => void {
  const local = bird();
  const first = solids.count * 3;
  solids.append(local);
  const shape = local.geometry();
  const lp = shape.getAttribute('position').array;
  const ln = shape.getAttribute('normal').array;
  const lt = shape.getAttribute('aTint').array;
  const floats = lp.length;
  return (mesh) => {
    const g = mesh.geometry;
    const pos = g.getAttribute('position') as BufferAttribute;
    const nrm = g.getAttribute('normal') as BufferAttribute;
    const tint = g.getAttribute('aTint') as BufferAttribute;
    const p: TypedArray = pos.array;
    const n: TypedArray = nrm.array;
    const t: TypedArray = tint.array;
    peacockHead.draw = (x, y, z, size, yaw, colour) => {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      for (let i = 0; i < floats; i += 3) {
        const o = first + i;
        const lx = lp[i]!;
        const lz = lp[i + 2]!;
        p[o] = x + size * (lx * c + lz * s);
        p[o + 1] = y + size * lp[i + 1]!;
        p[o + 2] = z + size * (lz * c - lx * s);
        n[o] = ln[i]! * c + ln[i + 2]! * s;
        n[o + 1] = ln[i + 1]!;
        n[o + 2] = ln[i + 2]! * c - ln[i]! * s;
        for (let k = 0; k < 3; k++) t[o + k] = lt[i + k]! * (colour[k] ?? 1) * TONE[k]!;
      }
      touch(pos, first, floats);
      touch(nrm, first, floats);
      touch(tint, first, floats);
    };
    peacockHead.draw(0, 0, 0, 0, 0, HIDDEN);
  };
}
