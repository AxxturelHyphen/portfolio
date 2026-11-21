import { UI } from '../core/motion.ts';
import type { Content, Machine, State } from '../types.ts';
import { uiText } from './copy.ts';
import { HELP } from './help.ts';
import './styles/welcome.css';
import { gapFree, slipKeys, WELCOME } from './welcome.rules.ts';

/**
 * The first-visit plate, top left: a card tag hung on a nail with the owner's name, place and the gap-free sentences of
 * the headline, and under it a paper slip with how to move (keys or click on desktop, tap or drag on touch) and where
 * the work is listed. It comes up once the cold start has settled; the slip goes once the visitor has walked a little
 * or after WELCOME.hintMs, the card after WELCOME.cardMs or as soon as the visitor travels or opens a project. Folded,
 * the card stays as text in the DOM before the garden's controls (screen readers meet it there) and the name stays in
 * the plan sheet (ui/plan.ts). Once per session (sessionStorage): later loads keep only the folded card.
 * While the kaleidoscope intro plays, on every load, the card stands from its first frame with a slip under it saying
 * how to skip (any key or a tap), so the intro is never a nameless wait; the slip leaves with the intro. On a first
 * visit the card then stays through the cold start until the plate comes up, unless a project opens first.
 * With the play layer on (ui/play.ts, its help card owns the controls) the slip only says where the work is, the plate
 * folds after WELCOME.playCardMs so the help card can come up, and it folds at once when the help card opens: the two
 * never stand together.
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
  /**
   * Stage 'dom': stands with the intro, comes up once settled, drops the hint once the visitor has walked a little.
   * No allocation.
   */
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
  const skip = document.createElement('p');
  skip.className = 'wl-skip';
  root.append(card, skip, hint);

  const roam = d.visitor !== null;
  const help = world.querySelector<HTMLElement>(`#${HELP.id}`);
  const helpOpen = (): boolean => help !== null && help.matches(':popover-open');
  let stage: Stage = seen() ? 'folded' : 'wait';
  let x0 = 0;
  let z0 = 0;
  let hintTimer = 0;
  let cardTimer = 0;
  let intro = false;
  let held = false;

  function paint(): void {
    const lang = machine.state.lang;
    const p = content.profile;
    name.textContent = p.name;
    place.textContent = p.location[lang];
    line.textContent = gapFree(p.headline[lang]);
    line.hidden = line.textContent === '';
    hint.textContent = slipKeys(isTouch(), roam, help !== null).map((k) => uiText(content.strings, lang, k)).join(' ');
    skip.textContent = uiText(content.strings, lang, isTouch() ? 'intro.skipTouch' : 'intro.skipKeys');
  }

  /** The card and the skip slip while the intro plays (welcome.css [data-intro]), then the card alone ([data-held]). */
  function setIntro(): void {
    const s = machine.state;
    const on = s.mode === 'garden' && s.phase === 'intro';
    const hold = stage === 'wait' && s.mode === 'garden' && s.phase !== 'opening' && s.phase !== 'inspect' && (on || held);
    if (on !== intro) {
      intro = on;
      root.toggleAttribute('data-intro', on);
    }
    if (hold !== held) {
      held = hold;
      root.toggleAttribute('data-held', hold);
    }
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
    cardTimer = window.setTimeout(fold, help === null ? WELCOME.cardMs : WELCOME.playCardMs);
  }

  paint();
  setIntro();
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
  help?.addEventListener('toggle', (e) => {
    if ((e as ToggleEvent).newState === 'open') fold();
  });

  return {
    frame() {
      setIntro();
      if (stage === 'wait') {
        const s = machine.state;
        const at = s.phase === 'bed' || s.phase === 'focus' || (!roam && s.phase === 'overview');
        if (s.mode === 'garden' && at && d.settled() && !helpOpen()) show();
        return;
      }
      const v = d.visitor;
      if (stage === 'shown' && v !== null && Math.hypot(v[0]! - x0, v[1]! - z0) > WELCOME.movedM) dropHint();
    },
  };
}
