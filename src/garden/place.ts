import type { GlGfx } from '../gl/renderer.ts';
import type { GroundLayout } from '../gl/ground.ts';
import { Vector3 } from 'three';
import { linearHex } from '../gl/colour.ts';
import { setMoon, sharedUniforms, type PlaceLight } from '../gl/lights.ts';
import { MAX_REFLECTORS, type PondRect, type PondReflector } from '../gl/pond.ts';
import type { BedId } from '../types.ts';
import type { SignAnchor } from '../ui/signposts.ts';
import type { BedScene3, WorldLayout } from '../world/layout.ts';
import { builtIn, type WorldMode } from '../world/mode.ts';

/**
 * What the world data hands to gl and ui at load: the ground layout from garden.json (path, puddles), the light of each
 * place (cook/ART.md section 1 table), the firefly pockets and the signpost anchors from the beds' boards.
 */

/** Ground plane margins around the garden: wide enough that the edge never shows from the rail or the overview. */
const GROUND_MARGIN = { x: 14, far: 40, near: 16 } as const;
/** The board sprite and the share of its height where the sign label sits. */
const BOARD = { sprite: 'sh/board', labelAt: 0.82 } as const;

/**
 * Ambients are cool neutrals per place (violet lives in the sky only); shadows keep the ART.md section 1 colours.
 * Moon [azimuth, elevation] per place puts it where the key frame wants it: Estanque high over the pond to the right of
 * the peacock (S04 at x 70, y 22), Salida over the far fields left of the trunk (x 33, y 4). All sit clear of the wall
 * top. The overview has its own.
 */
const PLACE_LIGHT: Readonly<Record<BedId, PlaceLight>> = {
  puerta: { skyTop: '#16193d', skyHorizon: '#3e4c74', ambient: '#5f646c', shadow: '#2b2130', shadowLength: 0.6, moon: [-10, 15] },
  rosaleda: { skyTop: '#151838', skyHorizon: '#38466e', ambient: '#363b44', shadow: '#261e3d', shadowLength: 0.5, moon: [-6, 12] },
  estanque: { skyTop: '#101338', skyHorizon: '#2c3058', ambient: '#151a26', shadow: '#16163d', shadowLength: 0.9, moon: [-5, 19] },
  semillero: { skyTop: '#101338', skyHorizon: '#2c3058', ambient: '#1f2329', shadow: '#1b1528', shadowLength: 0.3, moon: [-8, 10] },
  gruta: { skyTop: '#101338', skyHorizon: '#2c3058', ambient: '#312c1c', shadow: '#1d1710', shadowLength: 0.3, moon: [-8, 6] },
  salida: { skyTop: '#16193d', skyHorizon: '#3c4870', ambient: '#2e333d', shadow: '#2a1c38', shadowLength: 1.1, moon: [-8, 5.6] },
};
/** The overview (S02): the moon right of centre over the pond, x 68, y 26 of the frame. */
const OVERVIEW_MOON = [14.5, 10] as const;

export function groundLayoutOf(g: WorldLayout): GroundLayout {
  const gr = g.ground;
  return {
    x0: -GROUND_MARGIN.x,
    x1: gr.length + GROUND_MARGIN.x,
    z0: gr.wall.z - GROUND_MARGIN.far,
    z1: GROUND_MARGIN.near,
    wallZ: gr.wall.z,
    path: gr.path.points.flat(),
    puddles: gr.puddles.flat(),
  };
}

/** Seconds for the light to settle on a new place: about one walk, so the sky turns while the camera moves. */
const LIGHT_TAU_S = 0.5;

interface LinearLight { skyTop: Vector3; skyHorizon: Vector3; ambient: Vector3; shadow: Vector3; shadowLength: number; moon: readonly [number, number] }

export interface PlaceLighting {
  /** The place the camera is heading to; the overview keeps the Rosaleda night. */
  set(bed: BedId | null): void;
  /** Free roam: hangs the moon at this elevation (degrees) over every bed, in the follow frame's sky; null lets go. */
  holdMoon(elevationDeg: number | null): void;
  /** Stage 'world': eases the shared light uniforms toward the place; `snap` (frozen time) lands on it. No allocation. */
  frame(dt: number, snap: boolean): void;
}

/** Place lights parsed once at load, then eased per frame so a walk never pops the sky. */
export function createPlaceLighting(): PlaceLighting {
  const parsed = new Map<BedId, LinearLight>();
  for (const [bed, p] of Object.entries(PLACE_LIGHT) as [BedId, PlaceLight][]) {
    parsed.set(bed, {
      skyTop: linearHex(p.skyTop, new Vector3()),
      skyHorizon: linearHex(p.skyHorizon, new Vector3()),
      ambient: linearHex(p.ambient, new Vector3()),
      shadow: linearHex(p.shadow, new Vector3()),
      shadowLength: p.shadowLength,
      moon: p.moon,
    });
  }
  const u = sharedUniforms;
  let goal = parsed.get('rosaleda') as LinearLight;
  let atBed = false;
  let held: number | null = null;
  let az = OVERVIEW_MOON[0];
  let el = OVERVIEW_MOON[1];
  let first = true;
  return {
    set(bed) {
      goal = parsed.get(bed ?? 'rosaleda') ?? goal;
      atBed = bed !== null;
    },
    holdMoon(elevationDeg) {
      held = elevationDeg;
    },
    frame(dt, snap) {
      const k = first || snap ? 1 : 1 - Math.exp(-dt / LIGHT_TAU_S);
      first = false;
      u.uSkyTop.value.lerp(goal.skyTop, k);
      u.uSkyHorizon.value.lerp(goal.skyHorizon, k);
      u.uAmbient.value.lerp(goal.ambient, k);
      u.uShadowColor.value.lerp(goal.shadow, k);
      u.uShadowDir.value.z += (goal.shadowLength - u.uShadowDir.value.z) * k;
      const moon = atBed ? goal.moon : OVERVIEW_MOON;
      az += (moon[0] - az) * k;
      el += ((atBed ? (held ?? moon[1]) : moon[1]) - el) * k;
      setMoon(az, el);
    },
  };
}

/**
 * One sign per board: a board left of its bed's rail stop points back to the previous place on the path, one right of
 * it points on (past the last place, to the CV). The grotto is off the path and has no signs.
 */
export function signAnchorsOf(g: WorldLayout, scenes: Readonly<Record<BedId, BedScene3>>): SignAnchor[] {
  const path = g.order.filter((b) => b !== 'gruta');
  const out: SignAnchor[] = [];
  path.forEach((bed, i) => {
    const stop = g.rail.keys.find((k) => k.bed === bed)?.x ?? g.anchors[bed];
    for (const l of scenes[bed].layers) {
      for (const it of l.items) {
        if (it.sprite !== BOARD.sprite) continue;
        const dir = it.x < stop ? -1 : 1;
        const to = dir < 0 ? path[i - 1] : (path[i + 1] ?? 'cv');
        if (to === undefined) continue;
        out.push({ bed, to, dir, at: [it.x, it.y + (it.h ?? 1) * it.scale * BOARD.labelAt, it.z] });
      }
    }
  });
  return out;
}

/** The Estanque water from its bed file: the pond procedural's rectangle and the items marked to reflect (gl/pond.ts). */
export function pondOf(scene: BedScene3, mode: WorldMode): { rect: PondRect; reflectors: PondReflector[] } | null {
  const p = scene.procedural.find((x) => x.type === 'pond');
  if (p === undefined) return null;
  const reflectors: PondReflector[] = [];
  for (const l of scene.layers) {
    for (const it of l.items) {
      if (it.reflect === undefined || !builtIn(it, mode)) continue;
      reflectors.push({ x: it.x, z: it.z, h: (it.h ?? it.reflect.w) * it.scale, w: it.reflect.w * it.scale, colour: it.reflect.colour });
    }
  }
  return { rect: { x0: p.x - p.w / 2, z0: p.z - p.h / 2, x1: p.x + p.w / 2, z1: p.z + p.h / 2 }, reflectors: reflectors.slice(0, MAX_REFLECTORS) };
}

/**
 * Free roam: the ground plane ends just past the closed garden's walls (CLOSED_MARGIN, m), so whatever shows over a
 * wall is sky, and the strip it keeps past them is shaded.
 */
const CLOSED_MARGIN = { side: 0.6, far: 1.2, shade: 0.3 } as const;

export function closedGroundLayoutOf(g: WorldLayout): GroundLayout {
  const e = g.ground.enclosure;
  return { ...groundLayoutOf(g), x0: e.x[0] - CLOSED_MARGIN.side, x1: e.x[1] + CLOSED_MARGIN.side, z0: g.ground.wall.z - CLOSED_MARGIN.far };
}

/**
 * Everything gl must have before warm() so no texture uploads on first draw: the ground layout and the pond, once.
 * Free roam clips the ground to the closed garden and reflects the roam variants in the pond.
 */
export function prepareGl(gfx: GlGfx, g: WorldLayout, scenes: Readonly<Record<BedId, BedScene3>>, mode: WorldMode): void {
  const closed = mode === 'roam';
  gfx.ground.setLayout(closed ? closedGroundLayoutOf(g) : groundLayoutOf(g));
  const e = g.ground.enclosure;
  if (closed) gfx.ground.enclose(e.x[0], g.ground.wall.z - CLOSED_MARGIN.shade, e.x[1], e.front);
  const pond = pondOf(scenes.estanque, mode);
  if (pond === null) return;
  gfx.pond.setRect(pond.rect);
  gfx.pond.setReflectors(pond.reflectors);
}
