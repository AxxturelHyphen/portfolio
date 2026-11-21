import { BufferAttribute, BufferGeometry, Matrix3, Mesh, Vector3 } from 'three';
import type { Material, Matrix4 } from 'three';
import { solidPaint, type PaintAttributes, type SolidPaint } from './solid.paint.ts';

/**
 * Solid built things as plain geometry (world/enclosure.ts blocks, world/solids.ts rim stones and kerbs, gl/grotto.ts,
 * gl/props.ts and gl/signwood.ts props): pieces are merged into one indexed BufferGeometry of world positions, normals
 * and each vertex's paint (gl/solid.paint.ts: the builder's paint when the vertex was added), so every kind
 * of piece that paints at the same order shares one draw. Load time only.
 */

/** Floats per block (world/enclosure.ts BLOCK): centre x, bottom y, centre z, width, height, depth, yaw. */
const BLOCK = 7;
/** A box's six faces: normal axis and sign, then the two in-face axes in counter-clockwise order seen from outside. */
const FACES = [
  [0, 1, 1, 2], [0, -1, 2, 1], [1, 1, 2, 0], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 1, 0],
] as const;
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
const point = new Vector3();
const toWorld = new Matrix3();

/** Grows a geometry piece by piece: positions and normals per vertex, triangles by index. */
export class SolidBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly idx: number[] = [];
  private readonly tint: number[] = [];
  private readonly look: number[] = [];
  private readonly glow: number[] = [];
  private now: PaintAttributes = solidPaint({ tile: 'tile/wall', tint: [1, 1, 1] });

  /** The paint of every vertex added from now on. */
  paint(p: SolidPaint): this {
    this.now = solidPaint(p);
    return this;
  }

  private painted(): void {
    this.tint.push(...this.now.tint);
    this.look.push(...this.now.look);
    this.glow.push(...this.now.glow);
  }

  /** Adds one vertex and returns its index. */
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.painted();
    return this.pos.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** A quad a b c d, counter-clockwise seen from the side its normal faces. */
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  /** Every block of a flat block list (world/enclosure.ts BLOCK layout), each a box turned by its yaw about y. */
  blocks(list: Float32Array): this {
    for (let i = 0; i + BLOCK <= list.length; i += BLOCK) {
      this.box(list[i]!, list[i + 1]!, list[i + 2]!, list[i + 3]!, list[i + 4]!, list[i + 5]!, list[i + 6]!);
    }
    return this;
  }

  /** A box w by h by d whose bottom face is centred on (x, y, z), turned by yaw about y (local x to (cos, 0, -sin)). */
  box(x: number, y: number, z: number, w: number, h: number, d: number, yaw: number): void {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const half = [w / 2, h / 2, d / 2];
    const local = [0, 0, 0];
    const n = [0, 0, 0];
    for (const [axis, sign, ua, va] of FACES) {
      n.fill(0);
      n[axis] = sign;
      const nx = n[0]! * cos + n[2]! * sin;
      const nz = -n[0]! * sin + n[2]! * cos;
      const first = this.pos.length / 3;
      for (const [su, sv] of CORNERS) {
        local[axis] = sign * half[axis]!;
        local[ua] = su * half[ua]!;
        local[va] = sv * half[va]!;
        this.vertex(x + local[0]! * cos + local[2]! * sin, y + half[1]! + local[1]!, z - local[0]! * sin + local[2]! * cos, nx, n[1]!, nz);
      }
      this.quad(first, first + 1, first + 2, first + 3);
    }
  }

  /** A prism: the closed outline (x, z pairs, counter-clockwise seen from above) raised from y0 to y1, capped on top. */
  prism(outline: readonly number[], y0: number, y1: number): void {
    const n = outline.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = outline[i * 2]!;
      const az = outline[i * 2 + 1]!;
      const bx = outline[((i + 1) % n) * 2]!;
      const bz = outline[((i + 1) % n) * 2 + 1]!;
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = (az - bz) / len;
      const nz = (bx - ax) / len;
      const a = this.vertex(ax, y0, az, nx, 0, nz);
      const b = this.vertex(bx, y0, bz, nx, 0, nz);
      const c = this.vertex(bx, y1, bz, nx, 0, nz);
      const d = this.vertex(ax, y1, az, nx, 0, nz);
      this.quad(a, b, c, d);
    }
    // The cap fans out from the outline's centre, so a slightly irregular stone still caps cleanly.
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += outline[i * 2]! / n;
      cz += outline[i * 2 + 1]! / n;
    }
    const centre = this.vertex(cx, y1, cz, 0, 1, 0);
    for (let i = 0; i < n; i++) this.vertex(outline[i * 2]!, y1, outline[i * 2 + 1]!, 0, 1, 0);
    for (let i = 0; i < n; i++) this.triangle(centre, centre + 1 + i, centre + 1 + ((i + 1) % n));
  }

  /** A three geometry (Box, Cylinder, Lathe...) placed by `m`: its positions and normals carried into world space. */
  merge(g: BufferGeometry, m: Matrix4): this {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const first = this.pos.length / 3;
    toWorld.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      point.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(point.x, point.y, point.z);
      point.fromBufferAttribute(n, i).applyMatrix3(toWorld).normalize();
      this.nrm.push(point.x, point.y, point.z);
      this.painted();
    }
    const index = g.getIndex();
    const count = index === null ? p.count : index.count;
    for (let i = 0; i < count; i++) this.idx.push(first + (index === null ? i : index.getX(i)));
    return this;
  }

  /** Every piece of another builder, with its own paint. */
  append(other: SolidBuilder): this {
    const first = this.pos.length / 3;
    const pairs = [[this.pos, other.pos], [this.nrm, other.nrm], [this.tint, other.tint], [this.look, other.look], [this.glow, other.glow]] as const;
    for (const [to, from] of pairs) for (const v of from) to.push(v);
    for (const i of other.idx) this.idx.push(first + i);
    return this;
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('aTint', new BufferAttribute(new Float32Array(this.tint), 3));
    g.setAttribute('aLook', new BufferAttribute(new Float32Array(this.look), 4));
    g.setAttribute('aGlow', new BufferAttribute(new Float32Array(this.glow), 3));
    g.setIndex(new BufferAttribute(new Uint32Array(this.idx), 1));
    return g;
  }
}

/** One static draw of solid geometry at the given paint order. */
export function solidMesh(builder: SolidBuilder, material: Material, order: number): Mesh {
  const mesh = new Mesh(builder.geometry(), material);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return mesh;
}
