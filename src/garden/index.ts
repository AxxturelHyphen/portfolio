import { t, tr } from '../content/i18n.ts';
import { projectsOf } from '../content/load.ts';
import { createStatsOverlay, testApiEnabled } from '../core/debug.ts';
import { createInput } from '../core/input.ts';
import { channelsSettled, CHANNELS, type RuntimeLoop } from '../core/loop.ts';
import { INTRO, OPEN_HALF } from '../core/motion.ts';
import type { GardenGeo } from '../core/machine.ts';
import { createQuality, PANEL_RENDER_SCALE, type RuntimeQuality } from '../core/quality.ts';
import { arrived, installTestApi } from '../core/testapi.ts';
import { createCutoutBatch, sharedUniforms } from '../gl/cutout.material.ts';
import { loadAtlas, uploadTexture } from '../gl/ktx2.ts';
import { createGfx } from '../gl/renderer.ts';
import { ACTIVATE_EVENT, createProxies } from '../ui/proxies.ts';
import { createLabel } from '../ui/label.ts';
import { createModeLayers } from '../ui/mode.ts';
import { createMover } from '../ui/xform.ts';
import type { BedId, ChannelName, Clock, Content, DebugParams, GardenLayout, Machine, Mode, Pose, ProjectId, SlotId, SlotView, State } from '../types.ts';
import { createRig } from '../world/camera.ts';
import { createGarden, SCENES } from '../world/garden.ts';
import { createLight } from '../world/light.ts';
import { createMoth } from '../world/moth.ts';
import { createFilmDrive } from './film.ts';
import { createIntroDrive } from './intro.ts';
import { createLabelDrive } from './label.ts';
import { createPlaceLighting, prepareGl, signAnchorsOf } from './place.ts';
import type { WorldLayout } from '../world/layout.ts';

/**
 * Garden chunk entry and composition root (cook/ARCH.md 2.12): the only place that wires core, gl, world and ui.
 * boot.ts owns the machine, the router and the one loop (stage 'sim' ticks the machine); this adds the garden's
 * stages in their fixed order: input, camera, world, render, post, dom.
 */

export interface GardenHost {
  machine: Machine;
  loop: RuntimeLoop;
  content: Content;
  q: DebugParams;
  canvas: HTMLCanvasElement;
  world: HTMLElement;
  herbario: HTMLElement;
  proxies: HTMLElement;
  label: HTMLElement;
  /** Gives the machine what only the garden knows: slot binding, entered beds, the overview pan. */
  attachGeo(geo: GardenGeo): void;
  /** Walks the machine's table again (a bed was entered or left). */
  refresh(): void;
  /** Panel.prepare: started on FOCUS of a project slot, so the iris normally never holds at 0.5. */
  prepare(id: ProjectId, gen: number): void;
  /** The garden cannot run here (the quality probe judged it too slow): back to the Herbario for the visit. */
  fail(): void;
}

export interface GardenRuntime { quality: RuntimeQuality; ready: Promise<void> }

const DEG = Math.PI / 180;

/** Scene files and garden.json give pitch in degrees; the rig and gl take radians. */
const radians = (p: Pose): Pose => ({ x: p.x, y: p.y, z: p.z, pitch: p.pitch * DEG, fov: p.fov });

function rigLayout(g: GardenLayout): GardenLayout {
  const shots: GardenLayout['shots'] = {};
  for (const [id, s] of Object.entries(g.shots)) shots[id] = s.pose === undefined ? s : { ...s, pose: radians(s.pose) };
  return { ...g, overview: radians(g.overview), shots };
}

/**
 * Bed framing on narrow screens: the scene poses are composed for 16:9, so a portrait viewport widens the vertical
 * fov (by tan) until about the S11 mobile framing, capped so beds never turn into a fish-eye.
 */
const PORTRAIT = { refAspect: 16 / 9, k: 0.75, maxTan: 1.5 } as const;

function bedPose(p: Pose, aspect: number): Pose {
  const k = Math.min(PORTRAIT.maxTan, Math.max(1, Math.sqrt(PORTRAIT.refAspect / aspect) * PORTRAIT.k));
  const fov = (2 * Math.atan(Math.tan((p.fov * DEG) / 2) * k)) / DEG;
  return { x: p.x, y: p.y, z: p.z, pitch: p.pitch * DEG, fov };
}

/** Mobile: the garden pauses while the panel is fully shown and the visitor still wants it. */
const panelHoldsMobile = (s: State): boolean => s.mode === 'garden' && s.phase === 'inspect' && s.intent.k === 'project';
const NO_SLOTS: readonly SlotView[] = [];
const SHOT_FOCUS: Readonly<Record<string, SlotId>> = { S08: 'rosaleda/rose-a' };

export function startGarden(host: GardenHost): GardenRuntime {
  const { machine, loop, content, q } = host;
  const quality = createQuality(q);
  const gfx = createGfx(host.canvas, quality, loop);
  const rig = createRig(rigLayout(content.garden));
  const light = createLight();
  const moth = createMoth(rig);
  const proxies = createProxies(host.proxies, machine);
  const label = createLabel(host.label, { t, tr });
  const layers = createModeLayers(host.world, host.herbario);
  const kit = { loadAtlas, createCutoutBatch, uploadTexture, projectsOf, moth: () => moth, onDom: (fn: (c: Clock) => void) => loop.on('dom', fn), createMover };
  const garden = createGarden({ gfx, machine, rig, light, quality, content, proxies, kit });
  const input = createInput({ machine, rig, light, loop, surface: host.canvas });
  const film = createFilmDrive(machine, rig, content.garden);
  const intro = createIntroDrive(gfx, quality.cfg.atlas);
  const labels = createLabelDrive(label, rig);
  if (q.film === 0) gfx.film.uniforms.uFilmOn.value = 0;
  const world = content.garden as WorldLayout;
  prepareGl(gfx, world, SCENES);
  const placeLight = createPlaceLighting();
  proxies.setSigns(signAnchorsOf(world, SCENES));

  const slotOwner = new Map<ProjectId, SlotId>();
  for (const bed of garden.beds.values()) for (const v of bed.slots) if (v.project !== undefined) slotOwner.set(v.project.id, v.id);
  host.attachGeo({
    slotOf: (id) => slotOwner.get(id) ?? null,
    /** A bed that failed to stream for good no longer holds a project back: it opens without its bed. */
    bedReady: (b) => garden.residency.stateOf(b) === 'active' || garden.residency.failed(b),
    viewX: () => rig.panX,
  });
  let entered: BedId | null = null;

  let slots: readonly SlotView[] = NO_SLOTS;
  const bindBed = (bed: BedId | null): void => {
    slots = bed === null ? NO_SLOTS : (garden.beds.get(bed)?.slots ?? NO_SLOTS);
    rig.setSlots(slots);
    light.setSlots(slots);
  };
  bindBed(machine.state.bed);
  placeLight.set(machine.state.bed);

  /** Resize only bumps the Gfx counter; the 'input' stage applies it (cook/ARCH.md section 6, risk 6). */
  let seenResizes = -1;

  /** ?shot: every channel lands on its target until the shot's place is reached. */
  const shot = q.shot === undefined ? undefined : content.garden.shots[q.shot];
  let snapping = shot !== undefined;
  /** S08 is the focused hero with its plant tag (cook/ART.md 2.2): the flower is focused once the shot has arrived. */
  let shotFocus: SlotId | null = q.shot === undefined ? null : (SHOT_FOCUS[q.shot] ?? null);
  if (q.shot !== undefined && shot !== undefined) {
    rig.setShot(q.shot);
    loop.setT(shot.t);
  }
  /** S01 is the kaleidoscope mid-turn: the intro channel holds at the shot's time instead of landing. */
  const introShot = q.shot === 'S01' && shot !== undefined ? Math.min(0.95, shot.t / INTRO.totalS) : null;

  loop.on('input', () => {
    /** Arrival can complete on a frame with no state change (channels settle after the bed went active). */
    if (snapping && arrived(machine.state, machine, machine.state.intent, garden.residency.stateOf)) snapping = false;
    if (shotFocus !== null && !snapping && machine.state.phase === 'bed' && slots.some((v) => v.id === shotFocus)) {
      machine.send({ type: 'FOCUS', slot: shotFocus });
      shotFocus = null;
    }
    if (seenResizes !== gfx.resizes) {
      seenResizes = gfx.resizes;
      const w = gfx.cssW;
      const h = gfx.cssH;
      rig.resize(w, h);
      light.resize(w, h);
      for (const b of content.garden.order) rig.setBedPose(b, bedPose(SCENES[b].pose, w / Math.max(1, h)));
    }
    input.frame();
    if (introShot !== null) machine.ch.intro.snap(introShot);
    if (!snapping) return;
    for (let i = 0; i < CHANNELS.length; i++) {
      const ch = machine.ch[CHANNELS[i] as ChannelName];
      if (!ch.settled && (introShot === null || ch !== machine.ch.intro)) ch.snap(ch.target);
    }
  });
  loop.on('camera', (c) => {
    const s = machine.state;
    rig.update(c, s, machine.ch);
    gfx.setPose(rig.pose);
    light.update(c, s, machine.ch, rig);
    moth.update(c, s, machine.ch, light, slots);
  });
  loop.on('world', (c) => {
    garden.update(c);
    /** Streaming advances only in frames: never idle while it runs; a bed entered may let a waiting project open. */
    if (garden.residency.busy) loop.wake();
    const bed = machine.state.bed;
    const now = bed !== null && (garden.residency.stateOf(bed) === 'active' || garden.residency.failed(bed)) ? bed : null;
    if (now !== entered) {
      entered = now;
      host.refresh();
    }
    placeLight.frame(c.dt);
    sharedUniforms.uCursor.value.fromArray(light.cursor);
    sharedUniforms.uGather.value.fromArray(light.gather);
    sharedUniforms.uFocusBack.value.fromArray(light.back);
    sharedUniforms.uHandThrow.value = light.handThrow;
    sharedUniforms.uMoonDir.value.fromArray(light.moonDir);
    intro.frame(machine.ch.intro.value, machine.state.phase === 'intro' || machine.ch.intro.value < 1);
    const u = gfx.film.uniforms;
    gfx.setFilm(machine.state.reduced, film.frame(c, u.uIris.value, u.uStrip.value, slots));
  });
  loop.on('render', (c) => gfx.render(c));
  loop.on('post', (c) => {
    quality.sample(c);
    if (channelsSettled(machine)) quality.adapt(c);
    quality.setPanelScale(!quality.mobile && machine.ch.open.value >= OPEN_HALF ? PANEL_RENDER_SCALE : 1);
  });
  /** True once warm-up and the first beds are done (GARDEN_READY sent). */
  let gardenReady = false;
  /** Null until the first settle, so entering from the Herbario settles the layers (html[data-mode], inert). */
  let settledMode: Mode | null = null;
  loop.on('dom', (c) => {
    const mode = machine.ch.mode;
    layers.setProgress(mode.value);
    const want = machine.state.mode;
    if (mode.settled && mode.value === (want === 'garden' ? 0 : 1) && settledMode !== want) {
      settledMode = want;
      layers.settle(want);
    }
    proxies.sync(rig);
    labels.frame(c);
    /**
     * Mobile: once the panel covers the garden and nothing moves (the mode fade included), the garden sleeps. Never
     * before the garden is ready: warm-up and streaming advance only in frames, so a pause then would hold the entry
     * from the Herbario (panel open) forever.
     */
    if (gardenReady && quality.mobile && panelHoldsMobile(machine.state) && channelsSettled(machine)) loop.pause('panel-mobile');
  });
  if (q.stats === 1) {
    const stats = createStatsOverlay(document.body, { calls: () => gfx.renderer.info.render.calls, tier: () => quality.tier, dpr: () => quality.dpr });
    loop.on('dom', (c) => stats.frame(c));
  }

  machine.subscribe((s, prev) => {
    if (s.bed !== prev.bed) {
      bindBed(s.bed);
      placeLight.set(s.bed);
    }
    if (s.phase === 'focus' && prev.phase !== 'closing' && (s.slot !== prev.slot || prev.phase !== 'focus')) {
      const project = slots.find((v) => v.id === s.slot)?.project;
      if (project !== undefined) host.prepare(project.id, s.gen);
    }
    film.onState(s, prev);
    labels.onState(s, prev, slots);
    if (snapping && arrived(s, machine, s.intent, garden.residency.stateOf)) snapping = false;
    if (quality.mobile && !panelHoldsMobile(s)) loop.resume('panel-mobile');
  });

  /** Bed signs prefetch on hover; props with a bed reference (the ivy to the grotto) travel there. */
  host.proxies.addEventListener('pointerover', (e) => {
    const sign = e.target instanceof Element ? e.target.closest<HTMLElement>('.px-bed') : null;
    garden.hover((sign?.dataset.bed as BedId | undefined) ?? null);
  });
  host.proxies.addEventListener(ACTIVATE_EVENT, (e) => {
    const id = (e as CustomEvent<string>).detail;
    const [bed, slot] = id.split('/') as [BedId, string];
    const ref = SCENES[bed]?.slots.find((x) => x.id === slot)?.ref;
    if (ref !== undefined && ref in content.garden.anchors) machine.send({ type: 'GOTO', place: { k: 'bed', bed: ref as BedId } });
  });

  loop.setCallsProbe(() => gfx.renderer.info.render.calls);
  const ready = Promise.all([gfx.warm(), garden.ready]).then(() => {
    gardenReady = true;
    machine.send({ type: 'GARDEN_READY' });
    void quality.probe().then((tier) => {
      if (tier === 'fail') host.fail();
    });
  });

  if (testApiEnabled(q)) {
    installTestApi({ machine, loop, quality, rig, content, residency: garden.residency, ready, info: (out) => gfx.info(out) });
  }
  return { quality, ready };
}
