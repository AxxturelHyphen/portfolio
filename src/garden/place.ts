import type { GlGfx } from '../gl/renderer.ts';
import type { GroundLayout } from '../gl/ground.ts';
import { Vector3 } from 'three';
import { terrainField, terrainRect } from '../core/terrain.ts';
import { linearHex } from '../gl/colour.ts';
import { grottoSolids } from '../gl/grotto.ts';
import { createIronGate } from '../gl/irongate.ts';
import { SolidBuilder, solidMesh } from '../gl/masonry.ts';
import { buildProps, propBuilders } from '../gl/props.ts';
import { slabStones } from '../gl/slabs.ts';
import { signWood } from '../gl/signwood.ts';
import { bindSolidTiles, solidMaterial } from '../gl/solid.material.ts';
import { createChalkDrive, type ChalkDeps } from './chalk.drive.ts';
import { setMoon, SHADOW_LAYER, sharedUniforms, type PlaceLight } from '../gl/lights.ts';
import { MAX_PADS, MAX_REFLECTORS, type PondPad, type PondRect, type PondReflector } from '../gl/pond.ts';
import type { BedId, Tier } from '../types.ts';
import type { SignAnchor } from '../ui/signposts.ts';
import { enclosureRuns, masonryOf, STONES } from '../world/enclosure.ts';
import { pathSlabs } from '../world/slabs.ts';
import { kerbStones, pondRim } from '../world/solids.ts';
import { solidProps } from '../world/props.solid.ts';
import { exitGate } from '../world/exit.ts';
import type { StreamGarden } from '../world/garden.ts';
import { ironGateOf } from '../world/irongate.ts';
import type { BedScene3, WorldLayout } from '../world/layout.ts';
import { builtIn, type WorldMode } from '../world/mode.ts';
import { RENDER_ORDER } from '../world/order.ts';
import { BOARD as SIGN_BOARD, MAX_SIGNS, plankCentre, type SignSpot } from '../world/signboard.ts';

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
/**
 * Free roam's dusk (cook/ROAM_LOOK.md B): the walker sees each bed from 7 to 14 m, so the rail's night ambients left two
 * thirds of the frame under luma 45. Under roam the ambients sit at a blue hour, low enough that the lanterns' pools
 * lead (the far lawn and wall about a third under the first dusk pass), and every sky gets a blue-violet band over the
 * wall, kept clear of rose so the film grade cannot turn it magenta; the shadows and moons stay the rail's. A later pass
 * lifted the ambients a step (still a blue hour, not a golden one) so the lawn and the flowers read between the
 * lanterns. The grotto's rock takes a dim night blue, so the carried lantern lights it.
 */
const ROAM_SKY = { skyTop: '#141a46', skyHorizon: '#3f528a' } as const;
const ROAM_DUSK: Readonly<Partial<Record<BedId, Pick<PlaceLight, 'skyTop' | 'skyHorizon' | 'ambient'>>>> = {
  puerta: { ...ROAM_SKY, ambient: '#4d505a' },
  rosaleda: { ...ROAM_SKY, ambient: '#424554' },
  estanque: { ...ROAM_SKY, ambient: '#3b4051' },
  semillero: { ...ROAM_SKY, ambient: '#3d404e' },
  salida: { ...ROAM_SKY, ambient: '#4a4d5c' },
  gruta: { ...ROAM_SKY, ambient: '#282a3c' },
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

/** Place lights parsed once at load (free roam's dusk over the rail's table), then eased per frame so a walk never pops the sky. */
export function createPlaceLighting(mode: WorldMode): PlaceLighting {
  const parsed = new Map<BedId, LinearLight>();
  for (const [bed, rail] of Object.entries(PLACE_LIGHT) as [BedId, PlaceLight][]) {
    const p = mode === 'roam' ? { ...rail, ...ROAM_DUSK[bed] } : rail;
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

/** A sign of the path: the bed it stands in, where it leads, its board's foot and the height of its rail label. */
export interface SignPost extends SignSpot { bed: BedId; to: BedId | 'cv'; labelY: number }

/**
 * One sign per board: a board left of its bed's rail stop points back to the previous place on the path, one right of
 * it points on (past the last place, to the CV). The grotto is off the path and has no signs. Free roam also stands the
 * way to the CV, which has no board, at the last place: across its stop from the way back.
 */
export function signPostsOf(g: WorldLayout, scenes: Readonly<Record<BedId, BedScene3>>, mode: WorldMode): SignPost[] {
  const path = g.order.filter((b) => b !== 'gruta');
  const out: SignPost[] = [];
  path.forEach((bed, i) => {
    const stop = g.rail.keys.find((k) => k.bed === bed)?.x ?? g.anchors[bed];
    for (const l of scenes[bed].layers) {
      for (const it of l.items) {
        if (it.sprite !== BOARD.sprite) continue;
        const dir = it.x < stop ? -1 : 1;
        const to = dir < 0 ? path[i - 1] : (path[i + 1] ?? 'cv');
        if (to === undefined) continue;
        out.push({ bed, to, dir, x: it.x, z: it.z, labelY: it.y + (it.h ?? 1) * it.scale * BOARD.labelAt });
      }
    }
    const back = out.find((p) => p.bed === bed && p.dir < 0);
    if (mode === 'roam' && i === path.length - 1 && back !== undefined && !out.some((p) => p.bed === bed && p.dir > 0)) {
      out.push({ ...back, to: 'cv', dir: 1, x: 2 * stop - back.x });
    }
  });
  return out;
}

/** The DOM signs' anchors: the rail label's point, or under free roam the centre and size of the sign's board. */
export function signAnchorsOf(posts: readonly SignPost[], mode: WorldMode): SignAnchor[] {
  const board = [SIGN_BOARD.plank.w, SIGN_BOARD.plank.h] as const;
  return posts.map((p) => (mode === 'roam'
    ? { bed: p.bed, to: p.to, dir: p.dir, at: plankCentre(p, [0, 0, 0]), board }
    : { bed: p.bed, to: p.to, dir: p.dir, at: [p.x, p.labelY, p.z] }));
}
/** Floating pads by sprite name, and their radius on the water as a share of the drawn width. */
const PAD_PREFIX = 'es/pad-';
const PAD_RADIUS = 0.42;

/** The Estanque water from its bed file: the pond procedural's rectangle and the items marked to reflect (gl/pond.ts). */
export function pondOf(scene: BedScene3, mode: WorldMode): { rect: PondRect; reflectors: PondReflector[]; pads: PondPad[] } | null {
  const p = scene.procedural.find((x) => x.type === 'pond');
  if (p === undefined) return null;
  const reflectors: PondReflector[] = [];
  const pads: PondPad[] = [];
  for (const l of scene.layers) {
    for (const it of l.items) {
      if (it.flat === true && it.sprite.startsWith(PAD_PREFIX) && builtIn(it, mode)) pads.push({ x: it.x, z: it.z, r: (it.w ?? 0) * it.scale * PAD_RADIUS });
      if (it.reflect === undefined || !builtIn(it, mode)) continue;
      reflectors.push({ x: it.x, z: it.z, h: (it.h ?? it.reflect.w) * it.scale, w: it.reflect.w * it.scale, colour: it.reflect.colour });
    }
  }
  return { rect: { x0: p.x - p.w / 2, z0: p.z - p.h / 2, x1: p.x + p.w / 2, z1: p.z + p.h / 2 }, reflectors: reflectors.slice(0, MAX_REFLECTORS), pads: pads.slice(0, MAX_PADS) };
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

/** The closed garden's solid walls and the grotto's rock shell and floor paint after its crowns and hedge (world/garden.ts CLOSED_ORDER), then the Salida's iron gate, then the beds. */
const WALL_ORDER = RENDER_ORDER.overview - 2;
const GATE_ORDER = RENDER_ORDER.overview - 0.5;
/** The pond rim, the bank kerbs and the solid props paint after every bed card, depth tested, so they stand among the plants by depth. */
const GROUND_STONE_ORDER = RENDER_ORDER.front + 40;
/**
 * The chalk paints after every card and solid, depth tested against the depth they wrote, so a plant or a stone standing
 * nearer the lens covers it while the flat path stones and the soil take it; before the visitor and the actors.
 */
const CHALK_ORDER = RENDER_ORDER.front + 45;
const RIM_TINT = [0.78, 0.76, 0.7] as const;
/** The kerb's own stone tile under the wall base course's tint, so it lights as the wall's foot does. */
const KERB_TILE = 'tile/kerb';

/**
 * Everything gl must have before warm() so no texture uploads or compiles on first draw: the ground layout and the pond,
 * once. Free roam clips the ground to the closed garden, raises its walls, the grotto's rock chamber (fewer facets on the
 * low tier), the path's slabs, the pond rim, the bank kerbs and the solid props with the signposts' timber (their tiles
 * bind once the shared atlas is up), hangs the iron gate in the Salida's doorway, chalks its marks (`chalk`, free roam
 * outside stills) and reflects the roam variants in the pond.
 */
export function prepareGl(gfx: GlGfx, g: WorldLayout, scenes: Readonly<Record<BedId, BedScene3>>, mode: WorldMode,
  garden: Pick<StreamGarden, 'ready' | 'sharedAtlas'>, tier: Tier, chalk: ChalkDeps | null): void {
  const closed = mode === 'roam';
  gfx.ground.setLayout(closed ? closedGroundLayoutOf(g) : groundLayoutOf(g));
  const e = g.ground.enclosure;
  if (closed) {
    gfx.ground.enclose(e.x[0], g.ground.wall.z - CLOSED_MARGIN.shade, e.x[1], e.front);
    gfx.scene.add(createIronGate(ironGateOf(e.door, g.ground.wall.z), exitGate, GATE_ORDER));
    // Two draws for every static solid: the walls, the grotto's shell and floor and the path's slabs before the cards (the
    // plants paint over the slabs as over the ground), the ground stones, the grotto's rocks and the props after them,
    // casting the lantern's shadow (one more draw in its pass).
    const back = new SolidBuilder();
    const front = new SolidBuilder();
    const walls = masonryOf(enclosureRuns(e, g.ground.wall.z, g.ground.wall.h), e.baseH);
    for (const k of ['stone', 'base', 'coping'] as const) back.paint(STONES[k]).blocks(walls[k]);
    grottoSolids(tier === 'low', back, front);
    front.paint({ tile: STONES.coping.tile, tint: RIM_TINT });
    for (const s of pondRim(g.ground.pond)) front.prism(s.outline, s.y0, s.y1);
    front.paint({ tile: KERB_TILE, tint: STONES.base.tint });
    for (const s of kerbStones(g.ground.path.points, g.ground.pond)) front.prism(s.outline, s.y0, s.y1);
    const props = propBuilders();
    buildProps(solidProps(scenes), props);
    signWood(props.wood, signPostsOf(g, scenes, mode).slice(0, MAX_SIGNS));
    for (const b of Object.values(props)) front.append(b);
    const field = terrainField();
    if (field !== null) {
      slabStones(back, pathSlabs(field, terrainRect()));
      gfx.ground.setSlabs(true);
    }
    const stones = solidMesh(front, solidMaterial(), GROUND_STONE_ORDER);
    stones.layers.enable(SHADOW_LAYER);
    gfx.scene.add(solidMesh(back, solidMaterial(), WALL_ORDER), stones);
    void garden.ready.then(() => bindSolidTiles(garden.sharedAtlas()));
    if (chalk !== null) createChalkDrive(gfx, g, scenes, CHALK_ORDER, chalk);
  }
  const pond = pondOf(scenes.estanque, mode);
  if (pond === null) return;
  gfx.pond.setRect(pond.rect);
  gfx.pond.setReflectors(pond.reflectors);
  gfx.pond.setPads(pond.pads);
}
