import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import type { Material } from 'three';

/**
 * Solid built things as plain geometry (world/enclosure.ts blocks): every piece is
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
