// Shared types: cook/ARCH.md section 2, verbatim. Types that need three.js (CutoutUniforms, FilmUniforms, FilmPass, Gfx)
// are added once the three typings are settled. Changes go through the orchestrator.

// 2.1 State machine
export type BedId = 'puerta' | 'rosaleda' | 'estanque' | 'semillero' | 'gruta' | 'salida';
export type ProjectBed = 'rosaleda' | 'estanque' | 'semillero';
export type ProjectId = string;
export type SlotId = string; /* '<bed>/<slot>' */
export type SpriteId = string;
export type ShotId = string; /* 'S01'.. */
export type Mode = 'garden' | 'herbario';
export type Lang = 'en' | 'es';
export type Tier = 'high' | 'mid' | 'low';
export type Place = { k: 'overview' } | { k: 'bed'; bed: BedId } | { k: 'project'; id: ProjectId };
export type Phase = 'intro' | 'overview' | 'travel' | 'bed' | 'focus' | 'opening' | 'inspect' | 'closing';
export interface State {
  readonly phase: Phase; readonly mode: Mode; readonly intent: Place;
  readonly bed: BedId | null; readonly slot: SlotId | null; readonly project: ProjectId | null; readonly fromX: number;
  readonly lang: Lang; readonly gen: number; readonly gardenReady: boolean; readonly panelReady: boolean; readonly reduced: boolean;
}
export type Ev = { type: 'SKIP_INTRO' } | { type: 'GOTO'; place: Place; via?: 'scroll' } | { type: 'STEP_BED'; dir: -1 | 1 } | { type: 'FOCUS'; slot: SlotId } | { type: 'BLUR' }
  | { type: 'OPEN'; id: ProjectId } | { type: 'CLOSE' } | { type: 'BACK' } | { type: 'SET_MODE'; mode: Mode } | { type: 'SET_LANG'; lang: Lang } | { type: 'ROUTE'; route: Route }
  | { type: 'GARDEN_READY' } | { type: 'PANEL_READY'; id: ProjectId; gen: number } | { type: 'REDUCED'; on: boolean };
export type ChannelName = 'intro' | 'dolly' | 'leg' | 'focus' | 'open' | 'mode';
export interface Machine {
  readonly state: State; readonly ch: Readonly<Record<ChannelName, Channel>>;
  send(ev: Ev): void; scrub(name: 'open', v: number | null): void;
  subscribe(fn: (s: State, prev: State) => void): () => void; tick(c: Clock): void;
}

// 2.2 Router
export interface Route { place: Place; mode: Mode | null; debug: DebugParams }

// 2.3 Clock, channels, loop
export interface Clock { readonly now: number; readonly dt: number; readonly t: number; readonly frame: number; readonly frozen: boolean }
export interface Channel {
  readonly value: number; readonly target: number; readonly velocity: number; readonly settled: boolean;
  to(target: number): void; snap(v: number): void; hold(): void; tick(dt: number): boolean;
}
export type FrameStage = 'input' | 'sim' | 'camera' | 'world' | 'render' | 'post' | 'dom';
export type PauseReason = 'hidden' | 'herbario' | 'panel-mobile' | 'idle-mobile' | 'context-lost';
export interface Loop {
  on(stage: FrameStage, fn: (c: Clock) => void): () => void; start(): void; pause(r: PauseReason): void; resume(r: PauseReason): void; wake(): void;
  readonly running: boolean; readonly rec: FrameRecorder;
}
export interface FrameRecorder { start(label: string): void; stop(): FrameReport }
export interface FrameReport { label: string; frames: number; avg: number; p95: number; max: number; over25: number; over50: number; over100: number; longTasks: number; callsP95: number }

// 2.4 Tier and quality probe
export interface ModeEnv { webgl2: boolean; reducedMotion: boolean; saveData: boolean; q: DebugParams }
export interface ModeDecision { mode: Mode; loadGarden: boolean }
export interface TierConfig { tier: Tier; dprMin: number; dprMax: number; pixelCap: number; halation: boolean; filmScale: 1 | 0.5; maxLayers: number; fireflies: number; atlas: 'hi' | 'lo'; texBudgetMB: number; drawBudget: number }
export interface Quality {
  readonly tier: Tier; readonly cfg: TierConfig; readonly dpr: number; readonly scale: number;
  probe(): Promise<Tier | 'fail'>; adapt(c: Clock): void; setPanelScale(k: number): void; onChange(fn: (q: Quality) => void): () => void;
}

// 2.5 Camera and light
export interface Pose { x: number; y: number; z: number; pitch: number; fov: number }
export interface ScreenPt { x: number; y: number; scale: number; visible: boolean }
export interface CameraRig {
  readonly pose: Readonly<Pose>; readonly changed: boolean;
  panBy(dxPx: number): void; fling(vxPxPerS: number): void; zoomBy(k: number, atXPx: number): void;
  nearestBed(): BedId; project(wx: number, wy: number, wz: number, out: ScreenPt): ScreenPt; unproject(xPx: number, yPx: number, planeZ: number, out: Float32Array): void;
  update(c: Clock, s: State, ch: Machine['ch']): void; setShot(id: ShotId): void; resize(w: number, h: number): void;
}
export interface LightRig {
  readonly cursor: Float32Array; readonly gather: Float32Array; readonly moonDir: Float32Array;
  setPointer(xPx: number, yPx: number, kind: 'mouse' | 'touch' | 'key'): void; update(c: Clock, s: State, ch: Machine['ch'], rig: CameraRig): void;
}

// 2.6 Beds, streaming, atlas, scene
export type BedState = 'cold' | 'prefetched' | 'loading' | 'ready' | 'active' | 'disposed';
export interface Bed {
  readonly id: BedId; readonly state: BedState; readonly gpuBytes: number; readonly drawCalls: number; readonly reveal: Channel; readonly slots: readonly SlotView[];
  prefetch(signal: AbortSignal): Promise<void>; load(gen: number): Promise<void>;
  enter(): void; leave(): void; update(c: Clock, s: State, ch: Machine['ch']): void; dispose(): void;
}
export interface BedBehaviour { update?(c: Clock): void; onState?(s: State, prev: State): void; onSlot?(slot: SlotId, e: 'focus' | 'blur' | 'open' | 'close'): void; dispose?(): void }
export interface BedCtx { scene: BedScene; actors: InstanceWriter; machine: Machine; light: LightRig; rig: CameraRig; quality: Quality; content: Content; moth: Moth }
export type BedModule = { default(ctx: BedCtx): BedBehaviour };
export interface Residency {
  want(active: BedId | null, heading: BedId | null, hover: BedId | null): void; stateOf(b: BedId): BedState; whenReady(b: BedId): Promise<void>;
  tick(c: Clock): void; readonly bytes: { beds: number; shared: number; targets: number; total: number; budget: number };
}
export interface AtlasManifest { id: BedId | 'overview' | 'shared'; hash: string; pages: AtlasPage[]; sprites: Record<SpriteId, SpriteRect>; blooms: Record<string, BloomDef> }
export interface AtlasPage { w: number; h: number; color: { hi: string; lo: string }; normal: { hi: string; lo: string }; fileBytes: { hi: number; lo: number } }
export interface SpriteRect { page: number; uv: [number, number, number, number]; size: [number, number]; pivot: [number, number]; pad: number; sources: string[] }
export interface BedScene { id: BedId; title: I18n; alt: I18n; pose: Pose; bounds: [number, number]; layers: Layer[]; slots: Slot[]; procedural: Proc[]; behaviour?: string }
export interface Layer { id: string; z: number; minTier: Tier; page: number; items: Placement[] }
export interface Placement { sprite: SpriteId; x: number; y: number; scale: number; rot?: number; flip?: boolean; tint?: [number, number, number]; sway?: number; lift?: number; dz?: number }
export interface Slot { id: string; kind: 'project' | 'link' | 'prop'; accepts?: Project['flower']; ref?: string; x: number; y: number; z: number; scale: number; bloom?: string; hit: [number, number]; label: 'left' | 'right' | 'auto'; alt?: I18n }
export type Proc = { type: 'pond' | 'sigils' | 'sundial' | 'fireflies' | 'stereoscope'; x: number; y: number; z: number; w: number; h: number; params?: Record<string, number> };
export interface SlotView { id: SlotId; kind: Slot['kind']; project?: Project; href?: string; world: [number, number, number]; hit: [number, number]; alt: string }

// 2.7 (three-free part)
export interface QuadParams { x: number; y: number; z: number; rot: number; w: number; h: number; px: number; py: number; uv: ArrayLike<number>; sway: number; phase: number; lift: number; facing: number; tint: ArrayLike<number> }
export interface InstanceWriter { readonly capacity: number; count: number; set(i: number, p: QuadParams): void; commit(from: number, to: number): void }

// 2.8 Flowers, moth
export interface BloomDef { kind: Project['flower']; mode: 'frames' | 'petals'; steps: number; frames?: SpriteId[]; petals?: Petal[]; rest: { idea: number; wip: number; shipped: number } }
export interface Petal { sprite: SpriteId; ring: number; angle: number; closed: [number, number]; open: [number, number]; delay: number }
export interface Flower { readonly slot: SlotView; readonly quads: number; setFocused(on: boolean): void; write(w: InstanceWriter, at: number): number; update(c: Clock): void }
export interface Moth {
  readonly mode: 'intro' | 'follow' | 'land' | 'flee' | 'circle' | 'rest'; celebrate(): void;
  update(c: Clock, s: State, ch: Machine['ch'], light: LightRig, slots: readonly SlotView[]): void;
}

// 2.9 Content (Project and I18n as spec section 5)
export type I18n = { en: string; es: string };
/** Literal placeholder for content the owner has not given yet. */
export type Fill = '[FILL]';
export type Project = {
  id: string;
  title: string;
  bed: ProjectBed;
  flower: 'rose' | 'lily' | 'pod' | 'bud';
  status: 'idea' | 'wip' | 'shipped';
  importance: 1 | 2 | 3;
  private?: boolean;
  year: number | Fill;
  oneLiner: I18n;
  problem: I18n;
  naiveFails: I18n;
  built: I18n;
  result: I18n;
  stack: string[];
  role: I18n;
  links: { repo?: string; live?: string; video?: string; spotify?: string };
  media: { type: 'image' | 'video'; src: string; alt: I18n }[];
  featured: boolean;
};
export interface Profile {
  name: string; alias: string; location: string; headline: I18n; about: I18n;
  education: { title: I18n; place: string; status: I18n }[]; languages: { name: I18n; level: string }[]; stack: string[];
  links: { key: string; label: I18n; href: string }[]; portrait: { src: string; alt: I18n }; cv: string;
}
export interface GardenLayout { order: BedId[]; anchors: Record<BedId, number>; grutaHost: BedId; overview: Pose; pan: [number, number]; shots: Record<ShotId, { hash: string; t: number; pose?: Pose; viewport?: [number, number] }> }
export type Strings = Record<Lang, Record<string, string>>;
export interface Content { projects: Project[]; profile: Profile; garden: GardenLayout; strings: Strings }

// 2.10 Label card, panel, proxies, toggles
export interface Panel {
  readonly el: HTMLDialogElement; readonly current: ProjectId | null;
  prepare(id: ProjectId, gen: number): Promise<void>; setProgress(p: number): void; commitOpen(): void; commitClosed(): void;
}
export interface LabelCard { show(v: SlotView): void; place(pt: ScreenPt, side: 'left' | 'right'): void; setProgress(p: number): void; hide(): void }
export interface ProxyLayer {
  mountBeds(beds: readonly { id: BedId; title: string }[]): void; mountSlots(bed: BedId, slots: readonly SlotView[]): void; unmountSlots(): void;
  sync(rig: CameraRig): void; focus(id: string): void;
}
export interface Toggles { setMode(m: Mode, pending: boolean): void; setLang(l: Lang): void; setAudio(on: boolean): void }
export interface ModeLayers { setProgress(p: number): void; settle(m: Mode): void }

// 2.11 Audio, debug params, test API
export interface AudioBus {
  readonly enabled: boolean; enable(): Promise<void>; disable(): void; onState(s: State, prev: State): void;
  setLevel(name: 'ambience' | 'musicbox' | 'beats', v: number): void; cue(name: 'bloom' | 'iris' | 'goal'): void;
}
export interface DebugParams { mode?: Mode; shot?: ShotId; t?: number; tier?: Tier; film?: 0 | 1; stats?: 0 | 1; bench?: 0 | 1; lang?: Lang }
export interface InfoSnapshot { calls: number; triangles: number; textures: number; geometries: number; programs: number; texBytes: number; targetBytes: number }
export interface PerfLine { tier: Tier; drawCallsP95: number; textureMB: number; heapMB: number; frameAvg: number; frameP95: number; longTasks: number }
export interface JardinTestAPI {
  ready: Promise<void>; state(): State; channels(): Record<ChannelName, { value: number; target: number; settled: boolean }>;
  goto(hash: string, o?: { instant?: boolean }): Promise<void>;
  send(ev: Ev): void; settled(): Promise<void>; camera(): Pose; info(): InfoSnapshot; residency(): Record<BedId, BedState>; heapMB(): number | null; errors(): string[]; setT(t: number): void;
  rec: { start(label: string): void; stop(): FrameReport }; tour(): Promise<PerfLine>;
}
