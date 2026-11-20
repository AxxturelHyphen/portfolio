import { BufferAttribute, BufferGeometry, DataTexture, DoubleSide, GLSL3, LinearFilter, Mesh, RawShaderMaterial, RedFormat, RepeatWrapping, Sphere, Vector2, Vector3, Vector4 } from 'three';
import type { Texture } from 'three';
import { ART_LAYOUT, MAX_PUDDLES, PATH_RANGE_M, bakePathField } from './ground.layout.ts';
import type { GroundLayout } from './ground.layout.ts';
import { sharedUniforms } from './lights.ts';
import { TERRAIN, setTerrain, terrainField, terrainPond, terrainRect, type TerrainPond } from '../core/terrain.ts';
import common from './shaders/common.glsl?raw';
import height from './shaders/ground.height.glsl?raw';
import lights from './shaders/lights.glsl?raw';
import vertexBody from './shaders/ground.vert.glsl?raw';
import fragmentBody from './shaders/ground.frag.glsl?raw';

export type { GroundLayout } from './ground.layout.ts';
export { ART_LAYOUT } from './ground.layout.ts';

/**
 * The ground for the world builder: one draw (earth, moss, flagstone path, puddles, line screen), drawn right after the
 * sky and before every cutout. Under free roam it takes core/terrain.ts's relief: a grid raised into the planted bank,
 * painted far to near (the ground has no depth), with the slabs and the edging added by parallax in the fragment. Puddle radii are fixed here (cook/ART.md: elliptical masks in the joints).
 */
export interface Ground {
  readonly mesh: Mesh;
  /** Bakes the path field (a few ms) and places the puddles. Load time only. */
  setLayout(l: GroundLayout): void;
  /** Free roam: the closed garden's rectangle (x0, z0 far, x1, z1 near); the ground past it turns to deep shade. */
  enclose(x0: number, z0: number, x1: number, z1: number): void;
  /** Photo stone and its normal map (CC0, repeat-wrapped by the caller's loader); null keeps the code-drawn stone. */
  setStone(color: Texture | null, normal: Texture | null): void;
  /** The parallax march through the slabs and the edging, on or off (off on the low tier); the relief itself stays. */
  setMarch(on: boolean): void;
  /** Textures the warm-up must upload before first use. */
  readonly textures: readonly Texture[];
  dispose(): void;
}

const PUDDLE_RADIUS = { x: 0.55, z: 0.32 } as const;
/** Paint order: after the sky (-1e6), before every bed layer. */
export const GROUND_ORDER = -1e5;
/** Grid cells across x and z: about 20 cm under free roam, fewer than 65536 vertices. */
const GRID = { x: 256, z: 96 } as const;

/** Free roam, before the garden builds: bakes the path field `l` and sets the terrain every cutout stands on. */
export function raiseTerrain(l: GroundLayout, pond: TerrainPond | null): void {
  setTerrain(bakePathField(l), l, pond);
}

/** The unit grid, rows from the far edge (z0) to the near one: index order is paint order. */
function gridGeometry(nx: number, nz: number): BufferGeometry {
  const position = new Float32Array((nx + 1) * (nz + 1) * 2);
  for (let j = 0, o = 0; j <= nz; j++) for (let i = 0; i <= nx; i++, o += 2) { position[o] = i / nx; position[o + 1] = j / nz; }
  const index = new Uint16Array(nx * nz * 6);
  for (let j = 0, o = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++, o += 6) {
      const a = j * (nx + 1) + i;
      const b = a + nx + 1;
      index[o] = a; index[o + 1] = b + 1; index[o + 2] = a + 1;
      index[o + 3] = a; index[o + 4] = b; index[o + 5] = b + 1;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

export function createGround(moonBody: Vector3): Ground {
  const geometry = gridGeometry(GRID.x, GRID.z);
  geometry.boundingSphere = new Sphere(new Vector3(), Number.MAX_VALUE);
  const neutral = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  neutral.needsUpdate = true;
  let path = new DataTexture(new Uint8Array([255]), 1, 1, RedFormat);
  const uniforms = {
    ...sharedUniforms,
    uBounds: { value: new Vector4() },
    uWallZ: { value: ART_LAYOUT.wallZ },
    uEnclose: { value: new Vector4(0, 0, -1, 0) },
    uPath: { value: path as Texture },
    uPathRange: { value: PATH_RANGE_M },
    uStone: { value: neutral as Texture },
    uStoneN: { value: neutral as Texture },
    uStoneOn: { value: 0 },
    uPuddle: { value: Array.from({ length: MAX_PUDDLES }, () => new Vector4()) },
    uPuddles: { value: 0 },
    uMoonBody: { value: moonBody },
    uRelief: { value: 0 },
    uMarch: { value: 1 },
    uBank: { value: new Vector4(TERRAIN.bankFront[0], TERRAIN.bankFront[1], TERRAIN.bank, TERRAIN.ramp) },
    uEdging: { value: new Vector4(TERRAIN.edging[0], TERRAIN.edging[1], TERRAIN.edging[2], TERRAIN.slab) },
    uPond: { value: new Vector4() },
    uPondClear: { value: new Vector2(TERRAIN.pondClear[0], TERRAIN.pondClear[1]) },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: common + height + vertexBody,
    fragmentShader: common + lights + height + fragmentBody,
    uniforms,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = GROUND_ORDER;
  const textures: Texture[] = [path, neutral];

  const setLayout = (l: GroundLayout): void => {
    uniforms.uBounds.value.set(l.x0, l.z0, l.x1, l.z1);
    uniforms.uWallZ.value = l.wallZ;
    // The terrain baked this same rectangle for the cutouts: the shader reads that field, so both stand on one surface.
    const raised = terrainField();
    const r = terrainRect();
    const same = raised !== null && r.x0 === l.x0 && r.x1 === l.x1 && r.z0 === l.z0 && r.z1 === l.z1;
    const field = same ? raised : bakePathField(l);
    const pond = terrainPond();
    uniforms.uRelief.value = same ? 1 : 0;
    uniforms.uPond.value.set(pond?.x ?? 0, pond?.z ?? 0, pond?.rx ?? 0, pond?.rz ?? 0);
    path.dispose();
    path = new DataTexture(field.data, field.w, field.h, RedFormat);
    path.minFilter = LinearFilter;
    path.magFilter = LinearFilter;
    path.needsUpdate = true;
    uniforms.uPath.value = path;
    textures[0] = path;
    const n = Math.min(MAX_PUDDLES, Math.floor(l.puddles.length / 2));
    for (let i = 0; i < n; i++) uniforms.uPuddle.value[i]?.set(l.puddles[i * 2] ?? 0, l.puddles[i * 2 + 1] ?? 0, PUDDLE_RADIUS.x, PUDDLE_RADIUS.z);
    uniforms.uPuddles.value = n;
  };
  setLayout(ART_LAYOUT);

  return {
    mesh,
    textures,
    setLayout,
    enclose(x0, z0, x1, z1) {
      uniforms.uEnclose.value.set(x0, z0, x1, z1);
    },
    setMarch(on) {
      uniforms.uMarch.value = on ? 1 : 0;
    },
    setStone(color, normal) {
      for (const t of [color, normal]) if (t !== null) t.wrapS = t.wrapT = RepeatWrapping;
      uniforms.uStone.value = color ?? neutral;
      uniforms.uStoneN.value = normal ?? neutral;
      uniforms.uStoneOn.value = color === null ? 0 : 1;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      path.dispose();
      neutral.dispose();
    },
  };
}
