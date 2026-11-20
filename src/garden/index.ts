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
import { carryVisitor, setRoamLight, setStandeeTurn, writeInvites, writeLamps } from '../gl/lights.ts';
import { createGfx } from '../gl/renderer.ts';
import { ACTIVATE_EVENT, createProxies } from '../ui/proxies.ts';
import { uiText } from '../ui/copy.ts';
import { createLabel } from '../ui/label.ts';
import { createModeLayers } from '../ui/mode.ts';
import { heldMode } from '../world/exit.ts';
import { WORK_EVENT } from '../ui/plan.ts';
import { createWorkWalk } from '../ui/plan.walk.ts';
import { createWelcome } from '../ui/welcome.ts';
import { createMover } from '../ui/xform.ts';
import type { BedId, ChannelName, Clock, CutoutBatch, Content, DebugParams, GardenLayout, Machine, Mode, Pose, ProjectId, SlotId, SlotView, State, Tier } from '../types.ts';
import { createRig } from '../world/camera.ts';
import { createGarden, SCENES } from '../world/garden.ts';
import { createLight } from '../world/light.ts';
import { LAMPS, lampBedsOf } from '../world/lamps.ts';
import { createMoth } from '../world/moth.ts';
import { setWorldMode, worldMode, worldModeOf } from '../world/mode.ts';
import { createVisitorLantern } from '../world/visitor.ts';
import { createArrival, driveArrival } from './arrival.ts';
import { createFilmDrive } from './film.ts';
import { createIntroDrive } from './intro.ts';
import { createMothDrive } from './moth.ts';
import { createLabelDrive } from './label.ts';
import { createPlaceLighting, prepareGl, signAnchorsOf, signPostsOf } from './place.ts';
import { createSignDrive } from './signs.drive.ts';
import { createFigureLoader } from './figure.ts';
import { createRoamDrive } from './roam.drive.ts';
import { petSlotsOf, soundMapOf, startSound } from './sound.ts';
import { paceStreaming } from './pace.ts';
import type { WorldLayout } from '../world/layout.ts';

/**
 * Garden chunk entry and composition root (cook/ARCH.md 2.12): the only place that wires core, gl, world and ui.
 * boot.ts owns the machine, the router and the one loop (stage 'sim' ticks the machine); this adds the garden's
 * stages in their fixed order: input, camera, world, render, post, dom. Free roam is the default: the visitor walks the
 * garden and the follow camera replaces the rail walk; `?roam=0` (kept by the router) keeps the rail for one release,
 * and so does a shot that is not a roam shot (world/mode.ts).
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
const NO_LAMPS: readonly null[] = [];
const SHOT_FOCUS: Readonly<Record<string, SlotId>> = { S08: 'rosaleda/rose-a' };
/**
 * The figure is in from the first frame on its small low page; the full page replaces it on the visitor's first walk,
 * or this long after ready, so it never joins the first load.
 */
const FIGURE_AFTER_MS = 6000;

export function startGarden(host: GardenHost): GardenRuntime {
  const { machine, loop, content, q } = host;
  const quality = createQuality(q);
  const shots = content.garden.shots;
  const roaming = worldModeOf(new URLSearchParams(location.search).get('roam'), q.shot, (id) => shots[id]?.visitor !== undefined) === 'roam';
  const gfx = createGfx(host.canvas, quality, loop, roaming);
  const rig = createRig(rigLayout(content.garden));
  const light = createLight();
  const moth = createMoth(rig);
  const proxies = createProxies(host.proxies, machine);
  const label = createLabel(host.label, { t, tr });
  const layers = createModeLayers(host.world, host.herbario);
  const kit = { loadAtlas, createCutoutBatch, uploadTexture, projectsOf, moth: () => moth, onDom: (fn: (c: Clock) => void) => loop.on('dom', fn), createMover };
  setWorldMode(roaming ? 'roam' : 'rail');
  const world = content.garden as WorldLayout;
  const bedOfProject = (id: ProjectId): BedId | null => content.projects.find((p) => p.id === id)?.bed ?? null;
  const spawn = q.shot === undefined ? undefined : shots[q.shot]?.visitor;
  const arrival = createArrival(roaming && q.shot === undefined && q.t === undefined && (location.hash === '' || location.hash === '#/') && !machine.state.reduced);
  const roam = roaming ? createRoamDrive({ machine, rig, light, loop, world, bedOfProject, proxies, refresh: () => host.refresh(), arrival, ...(spawn === undefined ? {} : { spawn }) }) : null;
  const garden = createGarden({ gfx, machine, rig, light, quality, content, proxies, kit, ...(roam === null ? {} : { roam }) });
  const pace = paceStreaming(garden.residency, roam === null ? null : content.garden.order[0] ?? null, q.shot !== undefined);
  const input = createInput({ machine, rig, light, loop, surface: host.canvas, ...(roam === null ? {} : { roam }) });
  if (roam !== null) setStandeeTurn(1);
  const lantern = roam === null ? null : createVisitorLantern(roam.pos, world.ground.pond);
  const mothDrive = lantern === null || roam === null ? null : createMothDrive(gfx, moth, lantern.flame, roam.pos);
  if (lantern !== null) {
    setRoamLight();
    light.carryFlame(lantern.flame);
    const budget = (tier: Tier): number => (tier === 'low' ? LAMPS.standingLow : LAMPS.standing);
    light.setLampBudget(budget(quality.tier));
    quality.onChange((qq) => light.setLampBudget(budget(qq.tier)));
  }
  if (roam !== null) carryVisitor(roam.pos);
  const film = createFilmDrive(machine, rig, content.garden, roam?.travel ?? null);
  const intro = createIntroDrive(gfx, quality.cfg.atlas);
  const labels = createLabelDrive(label, rig, roam?.pos ?? null);
  if (q.film === 0) gfx.film.uniforms.uFilmOn.value = 0;
  prepareGl(gfx, world, SCENES, worldMode());
  const placeLight = createPlaceLighting(worldMode());
  const posts = signPostsOf(world, SCENES, worldMode());
  proxies.setSigns(signAnchorsOf(posts, worldMode()));
  if (roam !== null) proxies.setVisitor(roam.pos, content.garden.anchors, (slot, off) => roam.seek(slot, off));
  const signs = roam === null ? null : createSignDrive({
    gfx, machine, loop, posts, visitor: roam.pos, proxies: host.proxies,
    nameOf: (to, lang) => (to === 'cv' ? uiText(null, lang, 'sign.cv') : SCENES[to].title[lang]),
  });

  const slotOwner = new Map<ProjectId, SlotId>();
  for (const bed of garden.beds.values()) for (const v of bed.slots) if (v.project !== undefined) slotOwner.set(v.project.id, v.id);
  host.attachGeo({
    slotOf: (id) => slotOwner.get(id) ?? null,
    /** A bed that failed to stream for good no longer holds a project back: it opens without its bed. */
    bedReady: (b) => garden.residency.stateOf(b) === 'active' || garden.residency.failed(b),
    viewX: () => rig.panX,
    ...(roam === null ? {} : { roam: () => true, arrived: (b: BedId) => roam.arrived(b) }),
  });
  let entered: BedId | null = null;
  /** The first visit's plate: never in a still (?shot, ?t), so the stills stay as they were. */
  const welcome = q.shot === undefined && q.t === undefined
    ? createWelcome(host.world, host.proxies, { machine, content, visitor: roam?.pos ?? null, settled: () => channelsSettled(machine) && roam?.busy !== true })
    : null;
  const work = createWorkWalk({
    machine,
    bedOf: bedOfProject,
    slotOf: (id) => slotOwner.get(id) ?? null,
    proxies: host.proxies,
    seek: roam === null ? null : (slot) => roam.seek(slot, true),
    focus: (slot) => proxies.focus(slot),
  });
  host.proxies.addEventListener(WORK_EVENT, (e) => {
    work.start((e as CustomEvent<ProjectId>).detail);
    loop.wake();
  });

  let slots: readonly SlotView[] = NO_SLOTS;
  const bindBed = (bed: BedId | null): void => {
    slots = bed === null ? NO_SLOTS : (garden.beds.get(bed)?.slots ?? NO_SLOTS);
    rig.setSlots(slots);
    light.setSlots(slots);
    if (lantern !== null) {
      const near = bed === null ? [] : lampBedsOf(world.order, bed);
      light.setLamps(bed === null ? NO_LAMPS : near.map((b) => SCENES[b]));
      light.setInvites(near.map((b) => garden.beds.get(b)?.slots ?? NO_SLOTS));
    }
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

  loop.on('input', (c) => {
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
      lantern?.resize(w, h);
      if (roam !== null) {
        roam.resize(w, h);
        placeLight.holdMoon(roam.moonElevation());
      }
      for (const b of content.garden.order) rig.setBedPose(b, bedPose(SCENES[b].pose, w / Math.max(1, h)));
    }
    input.frame();
    roam?.frame(c);
    if (figureBatch !== null && roam?.walking === true) void startFigure();
    pace.frame(machine.state, roam?.walking === true);
    if (introShot !== null) machine.ch.intro.snap(introShot);
    if (!snapping) return;
    for (let i = 0; i < CHANNELS.length; i++) {
      const ch = machine.ch[CHANNELS[i] as ChannelName];
      if (!ch.settled && (introShot === null || ch !== machine.ch.intro)) ch.snap(ch.target);
    }
  });
  loop.on('camera', (c) => {
    const s = machine.state;
    driveArrival(arrival, c, machine);
    roam?.follow(c);
    rig.update(c, s, machine.ch);
    gfx.setPose(rig.pose);
    lantern?.frame(c, s.reduced);
    mothDrive?.frame(c, s.reduced);
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
      roam?.setSlots(now === null ? NO_SLOTS : slots);
      host.refresh();
    }
    if (roam !== null) placeLight.holdMoon(roam.moonElevation());
    placeLight.frame(c.dt, c.frozen);
    sharedUniforms.uCursor.value.fromArray(light.cursor);
    sharedUniforms.uGather.value.fromArray(light.gather);
    sharedUniforms.uFocusBack.value.fromArray(light.back);
    sharedUniforms.uHandThrow.value = light.handThrow;
    sharedUniforms.uMoonDir.value.fromArray(light.moonDir);
    if (lantern !== null) {
      writeLamps(arrival.carried(light.lamps));
      writeInvites(light.invites);
    }
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
    layers.setProgress(heldMode(mode.value));
    const want = machine.state.mode;
    if (mode.settled && mode.value === (want === 'garden' ? 0 : 1) && settledMode !== want) {
      settledMode = want;
      layers.settle(want);
    }
    labels.frame(c);
    proxies.sync(rig);
    welcome?.frame();
    if (work.step()) loop.wake();
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
    if (work.step()) loop.wake();
    if (snapping && arrived(s, machine, s.intent, garden.residency.stateOf)) snapping = false;
    if (quality.mobile && !panelHoldsMobile(s)) loop.resume('panel-mobile');
  });

  /** Bed signs prefetch on hover; props with a bed reference (the ivy to the grotto) travel there; a pet wakes. */
  host.proxies.addEventListener('pointerover', (e) => {
    const sign = e.target instanceof Element ? e.target.closest<HTMLElement>('.px-bed') : null;
    garden.hover((sign?.dataset.bed as BedId | undefined) ?? null);
  });
  host.proxies.addEventListener(ACTIVATE_EVENT, (e) => {
    const id = (e as CustomEvent<string>).detail;
    const [bed, slot] = id.split('/') as [BedId, string];
    const found = SCENES[bed]?.slots.find((x) => x.id === slot);
    if (found?.kind === 'pet') garden.beds.get(bed)?.wake(id);
    else if (found?.ref !== undefined && found.ref in content.garden.anchors) machine.send({ type: 'GOTO', place: { k: 'bed', bed: found.ref as BedId } });
  });

  loop.setCallsProbe(() => gfx.renderer.info.render.calls);
  const { attachLantern, loadFigure } = createFigureLoader(gfx, garden, lantern);
  /** The batch waiting for the figure's full page (when the first one was the low page), else null. */
  let figureBatch: CutoutBatch | null = null;
  let figureTimer = 0;
  const startFigure = (): Promise<void> => {
    clearTimeout(figureTimer);
    const batch = figureBatch;
    figureBatch = null;
    return batch === null ? Promise.resolve() : loadFigure(batch, 'hi').catch(() => undefined);
  };
  const ready = Promise.all([signs === null ? gfx.warm() : signs.ready.then(() => gfx.warm()), garden.ready]).then(async () => {
    const batch = attachLantern();
    mothDrive?.attach(garden.sharedAtlas());
    /** The figure is drawn from the first frame: a roam shot (a still) and the low tier load their page at once. */
    const first = spawn !== undefined ? quality.cfg.atlas : 'lo';
    if (batch !== null) await loadFigure(batch, first).catch(() => undefined);
    if (batch !== null && first === 'lo' && quality.cfg.atlas === 'hi') {
      figureBatch = batch;
      figureTimer = window.setTimeout(() => void startFigure(), FIGURE_AFTER_MS);
    }
    gardenReady = true;
    machine.send({ type: 'GARDEN_READY' });
    pace.ready();
    startSound({ machine, loop, q, tier: quality.tier, map: soundMapOf(world, SCENES), pets: petSlotsOf(SCENES), visitor: roam?.pos ?? null,
      steps: () => lantern?.steps ?? 0, path: world.ground.path, cameraX: () => rig.pose.x, proxies: host.proxies });
    void quality.probe().then((tier) => {
      if (tier === 'fail') host.fail();
    });
  });

  if (testApiEnabled(q)) {
    installTestApi({ machine, loop, quality, rig, content, residency: garden.residency, ready, info: (out) => gfx.info(out), roam, figure: () => lantern?.figure === true,
      strip: () => gfx.film.uniforms.uStrip.value.w,
      unfurl: () => (machine.state.bed === null ? 0 : garden.beds.get(machine.state.bed)?.unfurl() ?? 0) });
  }
  return { quality, ready };
}
