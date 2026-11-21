import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import type { Material } from 'three';

/**
 * Solid built things as plain geometry (world/enclosure.ts blocks, world/solids.ts rim stones and kerbs): every piece is
 * merged into one indexed BufferGeometry of world positions and face normals per material, so each stone is one draw.
 * Load time only.
 */

/** Floats per block (world/enclosure.ts BLOCK): centre x, bottom y, centre z, width, height, depth, yaw. */
const BLOCK = 7;
/** A box's six faces: normal axis and sign, then the two in-face axes in counter-clockwise order seen from outside. */
const FACES = [
  [0, 1, 1, 2], [0, -1, 2, 1], [1, 1, 2, 0], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 1, 0],
] as const;
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

/** Grows a geometry piece by piece: positions and normals per vertex, triangles by index. */
export class SolidBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly idx: number[] = [];

  /** Adds one vertex and returns its index. */
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
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

  /**
   * A kerb along a centre line (x, z pairs): `width` wide from y0 to y1, its sides following the line's turns and its
   * ends closed. The top is one strip, so the kerb shows no joints.
   */
  ribbon(line: readonly number[], width: number, y0: number, y1: number): void {
    const n = line.length / 2;
    const left: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const dx = line[b * 2]! - line[a * 2]!;
      const dz = line[b * 2 + 1]! - line[a * 2 + 1]!;
      const l = Math.hypot(dx, dz) || 1;
      left.push(dz / l, -dx / l);
    }
    const edge = (side: number, y: number, ny: number, flip: boolean): number => {
      const first = this.pos.length / 3;
      for (let i = 0; i < n; i++) {
        const ox = left[i * 2]! * side;
        const oz = left[i * 2 + 1]! * side;
        this.vertex(line[i * 2]! + ox * width / 2, y, line[i * 2 + 1]! + oz * width / 2, ny === 0 ? (flip ? -ox : ox) : 0, ny, ny === 0 ? (flip ? -oz : oz) : 0);
      }
      return first;
    };
    const strip = (p: number, q: number): void => {
      for (let i = 0; i + 1 < n; i++) this.quad(p + i, p + i + 1, q + i + 1, q + i);
    };
    // Top (left edge then right edge), then each side from its foot to its top, winding outward.
    const topL = edge(1, y1, 1, false);
    const topR = edge(-1, y1, 1, false);
    strip(topR, topL);
    const footL = edge(1, y0, 0, false);
    const headL = edge(1, y1, 0, false);
    strip(headL, footL);
    const footR = edge(-1, y0, 0, false);
    const headR = edge(-1, y1, 0, false);
    strip(footR, headR);
    for (const [i, s] of [[0, -1], [n - 1, 1]] as const) {
      const dx = (line[Math.min(n - 1, i + 1) * 2]! - line[Math.max(0, i - 1) * 2]!) * s;
      const dz = (line[Math.min(n - 1, i + 1) * 2 + 1]! - line[Math.max(0, i - 1) * 2 + 1]!) * s;
      const l = Math.hypot(dx, dz) || 1;
      const v = [footL, headL, headR, footR].map((k) => {
        const at = (k + i) * 3;
        return this.vertex(this.pos[at]!, this.pos[at + 1]!, this.pos[at + 2]!, dx / l, 0, dz / l);
      }) as [number, number, number, number];
      if (s > 0) this.quad(v[0], v[1], v[2], v[3]);
      else this.quad(v[0], v[3], v[2], v[1]);
    }
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
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
