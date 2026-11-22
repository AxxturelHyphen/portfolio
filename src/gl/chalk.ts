import {
  BufferAttribute, BufferGeometry, CanvasTexture, GLSL3, LessEqualDepth, LinearMipmapLinearFilter, Mesh, NormalBlending,
  RawShaderMaterial, Vector4,
} from 'three';
import { terrainY } from '../core/terrain.ts';
import { MAX_MARKS, rockZ, type ChalkMark } from '../world/chalk.ts';
import { GRID } from '../world/chalk.glyphs.ts';
import { INK_STRIDE, inkText, type Inked } from '../world/chalk.hand.ts';
import { sharedUniforms } from './lights.ts';
import common from './shaders/common.glsl?raw';
import lights from './shaders/lights.glsl?raw';
import vertexBody from './shaders/chalk.vert.glsl?raw';
import fragmentBody from './shaders/chalk.frag.glsl?raw';

/**
 * Chalk on the gl side: every mark's strokes (world/chalk.hand.ts) drawn into one canvas atlas when the marks are built
 * or the language changes, never per frame (r: the chalk laid down, g: when, times r, for the chalking on; the hand's
 * pressure is in the stroke's width), and every mark a decal on the ground (a grid that follows the terrain, a little
 * above it), bent over the grotto's rock or standing upright in the air (one quad placed by its arrow's tip), all
 * merged into one mesh: one draw for all the chalk. Depth tested against what the walls, the solids and the cards
 * wrote, writing none, nudged toward the lens so it never fights the surface it lies on. Every quad faces up, out of
 * the rock or south, so one side is drawn in one pass.
 */

/** The atlas page, the hand's size on it (px per grid unit) and the gap between marks. */
const ATLAS = { w: 1024, h: 512, unit: 6, gap: 8 } as const;
/** Ground grid cell (m) and lift over the soil (m): above the path slabs, which stand up to 4 cm proud of it. */
const CELL_M = 0.3;
const LIFT_M = 0.045;
/** Grid units per capital: the cap height minus the baseline. */
const CAP_UNITS = GRID.cap - GRID.baseline;

interface ChalkRect { x: number; y: number; w: number; h: number }

/** Shelf packing of inked marks on the page, tallest first; a mark past the page's end gets null and is left out. */
function packMarks(sizes: readonly { w: number; h: number }[], pageW: number, pageH: number, gap: number): (ChalkRect | null)[] {
  const out = new Array<ChalkRect | null>(sizes.length).fill(null);
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b]!.h - sizes[a]!.h);
  let x = gap;
  let y = gap;
  let row = 0;
  for (const i of order) {
    const s = sizes[i]!;
    if (x + s.w + gap > pageW) {
      x = gap;
      y += row + gap;
      row = 0;
    }
    if (s.w + 2 * gap > pageW || y + s.h + gap > pageH) continue;
    out[i] = { x, y, w: s.w, h: s.h };
    x += s.w + gap;
    row = Math.max(row, s.h);
  }
  return out;
}

function drawInked(ctx: CanvasRenderingContext2D, ink: Inked, at: ChalkRect): void {
  for (const s of ink.strokes) {
    for (let o = INK_STRIDE; o < s.length; o += INK_STRIDE) {
      ctx.strokeStyle = `rgb(255,${Math.round(255 * s[o + 4]!)},0)`;
      ctx.lineWidth = s[o + 2]!;
      ctx.beginPath();
      ctx.moveTo(at.x + s[o - INK_STRIDE]!, at.y + s[o - INK_STRIDE + 1]!);
      ctx.lineTo(at.x + s[o]!, at.y + s[o + 1]!);
      ctx.stroke();
    }
  }
}

export interface ChalkMesh {
  readonly mesh: Mesh;
  readonly texture: CanvasTexture;
  /**
   * Per mark: x how far it has chalked itself on, y its opacity, z how far it is rubbed out (the smear), w its float
   * clock (s; 0 holds a floating mark still). Written in place, read by the shader.
   */
  readonly state: readonly Vector4[];
  /** Draws these marks into the atlas and rebuilds the mesh (load and a language switch only). */
  build(marks: readonly ChalkMark[]): void;
}

/** One quad grid per mark: ground marks follow the terrain, rock marks bend over the grotto's dome, air marks stand upright. */
function geometryOf(marks: readonly ChalkMark[], rects: readonly (ChalkRect | null)[], inks: readonly Inked[], unit: number): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const mark: number[] = [];
  const tint: number[] = [];
  const index: number[] = [];
  marks.forEach((m, i) => {
    const r = rects[i];
    if (r === null || r === undefined) return;
    const metres = m.cap / CAP_UNITS / unit;
    const w = r.w * metres;
    const h = r.h * metres;
    const ground = m.surface === 'ground';
    const air = m.surface === 'air';
    const nx = air ? 1 : Math.max(1, Math.ceil(w / CELL_M));
    const ny = air ? 1 : Math.max(1, Math.ceil(h / CELL_M));
    /** An air mark hangs by its arrow's tip at (m.x, m.y): the quad's left and top edges (m). */
    const tip = inks[i]?.tip ?? [r.w / 2, r.h / 2];
    const left = m.x - tip[0] * metres;
    const top = m.y + tip[1] * metres;
    const first = pos.length / 3;
    for (let j = 0; j <= ny; j++) {
      for (let k = 0; k <= nx; k++) {
        const u = k / nx;
        const v = j / ny;
        const along = (u - 0.5) * w;
        const up = (v - 0.5) * h;
        if (air) {
          pos.push(left + u * w, top - (1 - v) * h, m.z);
          nrm.push(0, 0, 1);
        } else if (ground) {
          const x = m.x + along;
          const z = m.z - up;
          pos.push(x, terrainY(x, z) + LIFT_M, z);
          nrm.push(0, 1, 0);
        } else {
          pos.push(m.x + along, m.y + up, rockZ(m.x + along, m.y + up));
          nrm.push(0, 0, 1);
        }
        uv.push((r.x + u * r.w) / ATLAS.w, 1 - (r.y + (1 - v) * r.h) / ATLAS.h);
        mark.push(i);
        tint.push(m.tint[0], m.tint[1], m.tint[2]);
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nx; k++) {
        const a = first + j * (nx + 1) + k;
        const b = a + nx + 1;
        index.push(a, a + 1, b + 1, a, b + 1, b);
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aMark', new BufferAttribute(new Float32Array(mark), 1));
  g.setAttribute('aTint', new BufferAttribute(new Float32Array(tint), 3));
  g.setIndex(index);
  return g;
}

/** The chalk mesh, empty until build(); added to the scene by the caller before Gfx.warm(), so its program compiles there. */
export function createChalkMesh(order: number, anisotropy: number): ChalkMesh {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS.w;
  canvas.height = ATLAS.h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('chalk: no 2d canvas');
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = anisotropy;
  const state = Array.from({ length: MAX_MARKS }, () => new Vector4());
  const material = new RawShaderMaterial({
    defines: { MARKS: MAX_MARKS },
    glslVersion: GLSL3,
    vertexShader: common + vertexBody,
    fragmentShader: common + lights + fragmentBody,
    uniforms: { ...sharedUniforms, uChalk: { value: texture }, uMarks: { value: state } },
    transparent: true,
    premultipliedAlpha: true,
    blending: NormalBlending,
    depthTest: true,
    depthFunc: LessEqualDepth,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -8,
  });
  const mesh = new Mesh(new BufferGeometry(), material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = order;

  return {
    mesh,
    texture,
    state,
    build(marks) {
      const list = marks.slice(0, MAX_MARKS);
      const inks = list.map((m) => inkText(m.text, ATLAS.unit, m.arrow ?? 0));
      const rects = packMarks(inks, ATLAS.w, ATLAS.h, ATLAS.gap);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, ATLAS.w, ATLAS.h);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      inks.forEach((ink, i) => {
        const r = rects[i];
        if (r !== null && r !== undefined) drawInked(ctx, ink, r);
      });
      texture.needsUpdate = true;
      mesh.geometry.dispose();
      mesh.geometry = geometryOf(list, rects, inks, ATLAS.unit);
    },
  };
}
