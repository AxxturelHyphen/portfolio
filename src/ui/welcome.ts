import { UI } from '../core/motion.ts';
import type { Content, Machine, State } from '../types.ts';
import { uiText } from './copy.ts';
import './styles/welcome.css';
import { gapFree, hintKeys, WELCOME } from './welcome.rules.ts';

/**
 * The first-visit plate, top left: a card tag hung on a nail with the owner's name, place and the gap-free sentences of
 * the headline, and under it a paper slip with how to move (keys or click on desktop, tap or drag on touch) and where
 * the work is listed. It comes up once the cold start has settled; the slip goes once the visitor has walked a little
 * or after WELCOME.hintMs, the card after WELCOME.cardMs or as soon as the visitor travels or opens a project. Folded,
 * the card stays as text in the DOM before the garden's controls (screen readers meet it there) and the name stays in
 * the plan sheet (ui/plan.ts). Once per session (sessionStorage): later loads keep only the folded card.
 */

export interface WelcomeDeps {
  machine: Machine;
  content: Content;
  /** The visitor's [x, z] in free roam, null on the rail. */
  visitor: Float32Array | null;
  /** Every channel has landed and the cold start came down (free roam: the visitor stands at the gate). */
  settled(): boolean;
}

export interface Welcome {
  /** Stage 'dom': comes up once settled; drops the hint once the visitor has walked a little. No allocation. */
  frame(): void;
}

type Stage = 'wait' | 'shown' | 'hinted' | 'folded';

function seen(): boolean {
  try {
    return sessionStorage.getItem(WELCOME.seenKey) === '1';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    sessionStorage.setItem(WELCOME.seenKey, '1');
  } catch {
    /* Storage blocked: the plate may come up again on the next load, nothing else depends on it. */
  }
}

const isTouch = (): boolean => matchMedia('(hover: none) and (pointer: coarse)').matches;
const leaves = (s: State): boolean => s.mode !== 'garden' || s.phase === 'travel' || s.phase === 'opening' || s.phase === 'inspect';

export function createWelcome(world: HTMLElement, before: HTMLElement, d: WelcomeDeps): Welcome {
  const { machine, content } = d;
  const root = document.createElement('div');
  root.className = 'wl';
  const card = document.createElement('section');
  card.className = 'wl-card';
  card.setAttribute('aria-labelledby', 'wl-name');
  const name = document.createElement('p');
  name.className = 'wl-name';
  name.id = 'wl-name';
  const place = document.createElement('p');
  place.className = 'wl-place';
  const line = document.createElement('p');
  line.className = 'wl-line';
  card.append(name, place, line);
  const hint = document.createElement('p');
  hint.className = 'wl-hint';
  root.append(card, hint);

  const roam = d.visitor !== null;
  let stage: Stage = seen() ? 'folded' : 'wait';
  let x0 = 0;
  let z0 = 0;
  let hintTimer = 0;
  let cardTimer = 0;

  function paint(): void {
    const lang = machine.state.lang;
    const p = content.profile;
    name.textContent = p.name;
    place.textContent = p.location[lang];
    line.textContent = gapFree(p.headline[lang]);
    line.hidden = line.textContent === '';
    const [move, work] = hintKeys(isTouch(), roam);
    hint.textContent = `${uiText(content.strings, lang, move)} ${uiText(content.strings, lang, work)}`;
  }

  /** Fades out, then leaves the a11y tree (the hint) or stays as text only (the card, clipped where it stood). */
  function dropHint(): void {
    if (stage !== 'shown') return;
    stage = 'hinted';
    clearTimeout(hintTimer);
    hint.toggleAttribute('data-gone', true);
    window.setTimeout(() => (hint.hidden = true), UI.panelCloseS * 1000);
  }

  function fold(): void {
    if (stage === 'folded' || stage === 'wait') return;
    dropHint();
    stage = 'folded';
    clearTimeout(cardTimer);
    root.dataset.state = 'folded';
  }

  function show(): void {
    stage = 'shown';
    markSeen();
    const v = d.visitor;
    x0 = v === null ? 0 : v[0]!;
    z0 = v === null ? 0 : v[1]!;
    root.dataset.state = 'shown';
    hintTimer = window.setTimeout(dropHint, WELCOME.hintMs);
    cardTimer = window.setTimeout(fold, WELCOME.cardMs);
  }

  paint();
  if (stage === 'folded') {
    root.dataset.state = 'folded';
    hint.hidden = true;
  }
  world.insertBefore(root, before);

  machine.subscribe((s, prev) => {
    if (s.lang !== prev.lang) paint();
    if (stage === 'wait') return;
    if (leaves(s)) fold();
    else if (!roam && s.bed !== prev.bed) dropHint();
  });
  /** The plan opens where the plate would be on phones, and it holds the name: the plate folds into it. */
  before.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('.pl') !== null) fold();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') fold();
  });

  return {
    frame() {
      if (stage === 'wait') {
        const s = machine.state;
        const at = s.phase === 'bed' || s.phase === 'focus' || (!roam && s.phase === 'overview');
        if (s.mode === 'garden' && at && d.settled()) show();
        return;
      }
      const v = d.visitor;
      if (stage === 'shown' && v !== null && Math.hypot(v[0]! - x0, v[1]! - z0) > WELCOME.movedM) dropHint();
    },
  };
}
