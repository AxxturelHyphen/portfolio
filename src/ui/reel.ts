import './styles/reel.css';
import { esc } from '../content/herbario/html.ts';
import type { Lang, Project } from '../types.ts';
import { framesOf, PULL_MS, REST_S, runs, stepOf, type Frame, type Motion } from './reel.model.ts';

/**
 * The project film (loaded with the panel, never at first load): a short strip of two to four frames pulled through
 * a gate one frame at a time, in the look of the garden's travel strip (dark base, lit sprocket holes, a warm edge on
 * the frame bars), with the edges of the neighbouring frames showing at both sides of the gate. Beside it stands the
 * project's own flower, cut out of paper, its tint warming and cooling slowly like a lamp turned up behind it.
 * Frames change by the buttons, a click or tap on the picture, the arrow keys and a swipe; the strip also moves on by
 * itself slowly while the panel shows and nobody is pointing at it, focused in it or has stopped it. Looping parks an
 * end frame beside the current one with CSS order (no cloned frames), slides, and puts it back.
 * Clips play only while the film runs by itself; under reduced motion or a still they wait for the Run tag.
 */

export interface ReelOptions {
  project: Pick<Project, 'media' | 'title'>;
  lang: Lang;
  s: (key: string) => string;
  /** The project's flower cutout, or null when it has none. */
  flower: string | null;
  motion: Motion;
}

export interface Reel {
  readonly el: HTMLElement;
  /** Resolves when the flower and the first frame are decoded (or failed): the panel may show. */
  readonly ready: Promise<void>;
  /** The panel is fully shown (inspect in the garden): only then does the film run and a clip play. */
  setShown(on: boolean): void;
  dispose(): void;
}

const SWIPE_PX = 40;
/** Gate weave during a pull, in px: the strip settles into the gate with a small vertical jump. */
const WEAVE: readonly [number, number] = [1.5, -1];

/** One frame is CELL percent of the gate; the neighbours show PEEK percent at each side (matches reel.css). */
const CELL = 80;
const PEEK = (100 - CELL) / 2;
const xOf = (i: number): string => `${(PEEK - CELL * i).toFixed(2)}%`;
const at = (i: number): string => `translate3d(${xOf(i)}, 0, 0)`;
const atWeave = (i: number, y: number): string => `translate3d(${xOf(i)}, ${y}px, 0)`;

function blankFrame(caption: string): string {
  return `<div class="rl-blank" role="img" aria-label="${esc(caption)}"><span class="rl-light"></span><span class="rl-grain"></span><span class="rl-scratch rl-s1"></span><span class="rl-scratch rl-s2"></span><span class="rl-cap" aria-hidden="true">${esc(caption)}</span></div>`;
}

function frameHtml(f: Frame, i: number, n: number, s: (key: string) => string): string {
  const label = esc(s('film.slide').replace('{n}', String(i + 1)).replace('{total}', String(n)));
  const body = f.kind === 'blank'
    ? blankFrame(f.alt)
    : f.kind === 'image'
      ? `<img class="rl-media" src="${esc(f.src)}" alt="${esc(f.alt)}" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async">`
      : `<video class="rl-media" src="${esc(f.src)}" aria-label="${esc(f.alt)}" muted loop playsinline preload="${i === 0 ? 'metadata' : 'none'}"></video>`;
  return `<div class="rl-frame" role="group" aria-roledescription="${esc(s('film.frame'))}" aria-label="${label}">${body}</div>`;
}

function flowerHtml(src: string | null): string {
  if (src === null) return '';
  const u = esc(src);
  return `<div class="rl-flower" aria-hidden="true"><img class="rl-bloom" src="${u}" alt="" decoding="async"><img class="rl-tint" src="${u}" alt="" decoding="async"></div>`;
}

function decoded(img: HTMLImageElement | null): Promise<void> {
  return img === null ? Promise.resolve() : img.decode().catch(() => undefined);
}

export function createReel(o: ReelOptions): Reel {
  const { s, motion } = o;
  const frames = framesOf(o.project, o.lang, s('film.blank'));
  const n = frames.length;
  const el = document.createElement('section');
  el.className = 'c-part rl';
  el.setAttribute('aria-roledescription', s('film.role'));
  el.setAttribute('aria-label', s('film.label'));
  el.dataset.at = '0';
  if (!motion.pull) el.dataset.still = '';
  const hasClip = frames.some((f) => f.kind === 'video');
  /** Without auto-advance the film starts stopped: the toggle then only plays or pauses a clip. */
  let stopped = !motion.auto;
  const toggle = motion.auto || hasClip
    ? `<button type="button" class="rl-btn rl-stop${stopped ? ' is-stopped' : ''}"><span class="rl-sr">${esc(s(stopped ? 'film.run' : 'film.stop'))}</span></button>`
    : '';
  el.innerHTML = `<div class="rl-stage"><div class="rl-gate" role="group" tabindex="0" aria-label="${esc(s('film.gate'))}"><div class="rl-strip">${frames.map((f, i) => frameHtml(f, i, n, s)).join('')}</div></div>${flowerHtml(o.flower)}</div>
<div class="rl-controls">
<button type="button" class="rl-btn rl-prev"><span class="rl-sr">${esc(s('film.prev'))}</span></button>
${toggle}
<button type="button" class="rl-btn rl-next"><span class="rl-sr">${esc(s('film.next'))}</span></button>
</div>
<p class="rl-sr" role="status" aria-live="polite"></p>`;

  const strip = el.querySelector<HTMLElement>('.rl-strip')!;
  const gate = el.querySelector<HTMLElement>('.rl-gate')!;
  const status = el.querySelector<HTMLElement>('[role="status"]')!;
  const stopBtn = el.querySelector<HTMLButtonElement>('.rl-stop');
  const cells = Array.from(strip.children) as HTMLElement[];
  const videos = cells.map((c) => c.querySelector('video'));

  let index = 0;
  let shown = false;
  let pointing = false;
  let focused = false;
  let timer = 0;
  let pull: Animation | null = null;
  let settlePull: (() => void) | null = null;
  let downX = Number.NaN;
  let swiped = false;

  strip.style.transform = at(0);

  function playAt(): void {
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      if (v === null || v === undefined) continue;
      if (shown && i === index && !stopped) void v.play().catch(() => undefined);
      else v.pause();
    }
  }

  /** The next frame's picture loads before it is pulled into the gate (a clipped lazy image would wait for it). */
  function warmNext(): void {
    const img = cells[stepOf(index, n, 1)]?.querySelector<HTMLImageElement>('img.rl-media');
    if (img !== null && img !== undefined && img.loading === 'lazy') img.loading = 'eager';
  }

  function schedule(): void {
    clearTimeout(timer);
    timer = 0;
    if (!runs(motion, shown, pointing || focused, stopped, document.hidden)) return;
    timer = window.setTimeout(() => go(1, false), REST_S * 1000);
  }

  function park(cell: HTMLElement | undefined, order: string): void {
    if (cell !== undefined) cell.style.order = order;
  }

  /** Visual positions of the pull: from and to, after parking an end frame for a wrap. */
  function slide(from: number, to: number, dir: 1 | -1): void {
    settlePull?.();
    const wrapFwd = dir === 1 && to < from;
    const wrapBack = dir === -1 && to > from;
    if (wrapFwd) park(cells[to], String(n));
    if (wrapBack) park(cells[to], '-1');
    const a = wrapFwd ? n - 2 : wrapBack ? 1 : from;
    const b = wrapFwd ? n - 1 : wrapBack ? 0 : to;
    const settle = (): void => {
      if (settlePull !== settle) return;
      settlePull = null;
      pull?.cancel();
      pull = null;
      park(cells[to], '');
      strip.style.transform = at(to);
    };
    settlePull = settle;
    strip.style.transform = at(b);
    const mid = (k: number): number => a + (b - a) * k;
    pull = strip.animate([
      { transform: at(a), offset: 0 },
      { transform: atWeave(mid(0.4), WEAVE[0]), offset: 0.4 },
      { transform: atWeave(mid(0.8), WEAVE[1]), offset: 0.8 },
      { transform: at(b), offset: 1 },
    ], { duration: PULL_MS, easing: 'cubic-bezier(0.55, 0, 0.3, 1)' });
    pull.onfinish = settle;
  }

  function go(dir: 1 | -1, byHand: boolean): void {
    const from = index;
    index = stepOf(index, n, dir);
    el.dataset.at = String(index);
    if (motion.pull) slide(from, index, dir);
    else strip.style.transform = at(index);
    if (byHand) status.textContent = `${cells[index]?.getAttribute('aria-label') ?? ''}. ${frames[index]?.alt ?? ''}`;
    warmNext();
    playAt();
    schedule();
  }

  const onVisibility = (): void => {
    playAt();
    schedule();
  };

  el.querySelector('.rl-prev')?.addEventListener('click', () => go(-1, true));
  el.querySelector('.rl-next')?.addEventListener('click', () => go(1, true));
  stopBtn?.addEventListener('click', () => {
    stopped = !stopped;
    stopBtn.classList.toggle('is-stopped', stopped);
    stopBtn.firstElementChild!.textContent = s(stopped ? 'film.run' : 'film.stop');
    playAt();
    schedule();
  });
  gate.addEventListener('click', () => {
    if (swiped) {
      swiped = false;
      return;
    }
    go(1, true);
  });
  gate.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
    swiped = false;
  });
  gate.addEventListener('pointerup', (e) => {
    const dx = e.clientX - downX;
    downX = Number.NaN;
    if (!(Math.abs(dx) >= SWIPE_PX)) return;
    swiped = true;
    go(dx < 0 ? 1 : -1, true);
  });
  gate.addEventListener('pointercancel', () => {
    downX = Number.NaN;
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    go(e.key === 'ArrowLeft' ? -1 : 1, true);
  });
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') {
      pointing = true;
      schedule();
    }
  });
  el.addEventListener('pointerleave', () => {
    pointing = false;
    schedule();
  });
  el.addEventListener('focusin', () => {
    focused = true;
    schedule();
  });
  el.addEventListener('focusout', (e) => {
    if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
    focused = false;
    schedule();
  });
  document.addEventListener('visibilitychange', onVisibility);

  const firstImg = cells[0]?.querySelector<HTMLImageElement>('img.rl-media') ?? null;
  const ready = Promise.all([decoded(el.querySelector<HTMLImageElement>('.rl-bloom')), decoded(firstImg)]).then(() => undefined);

  return {
    el,
    ready,
    setShown(on) {
      if (on === shown) return;
      shown = on;
      if (on) warmNext();
      playAt();
      schedule();
    },
    dispose() {
      shown = false;
      clearTimeout(timer);
      if (pull !== null) pull.onfinish = null;
      settlePull?.();
      document.removeEventListener('visibilitychange', onVisibility);
      for (const v of videos) {
        if (v === null) continue;
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
    },
  };
}
