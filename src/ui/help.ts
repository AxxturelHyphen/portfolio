import type { Content, Machine, State } from '../types.ts';
import { playText } from './play.copy.ts';
import './styles/help.css';

/**
 * The "how to play" card (ui/play.ts opens it): a paper card with three lines for the device in hand (keys and mouse,
 * or the stick and gestures on touch), a "Got it" button, and two quiet entries under them: back to the gate, start
 * over. A light-dismiss popover dialog, so Escape, a click outside or the button close it and the garden stays live.
 * It comes up once by itself on a first visit, after the gate has opened (HELP.seenKey remembers it was dismissed),
 * and from the "?" tag or the H and ? keys after that.
 */

export const HELP = {
  /** The card's id: the "?" tag targets it and the first-visit plate (ui/welcome.ts) yields to it. */
  id: 'hp',
  /** localStorage key: the card was dismissed once, it never comes up by itself again. */
  seenKey: 'jardin.help',
} as const;

export interface HelpDeps {
  machine: Machine;
  content: Content;
  touch: boolean;
  home(): void;
  restart(): void;
}

export interface Help {
  readonly el: HTMLElement;
  /** True once the card was dismissed on this browser. */
  readonly seen: boolean;
  open(): void;
}

/** Fields keep the H and ? keys. */
const TYPING = 'input, textarea, select, [contenteditable]';
const panelUp = (s: State): boolean => s.phase === 'opening' || s.phase === 'inspect' || s.phase === 'closing';

function readSeen(): boolean {
  try {
    return localStorage.getItem(HELP.seenKey) === '1';
  } catch {
    return false;
  }
}

function button(cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  return b;
}

export function createHelp(parent: HTMLElement, d: HelpDeps): Help {
  const { machine, content } = d;
  const card = document.createElement('dialog');
  card.className = 'hp';
  card.id = HELP.id;
  card.setAttribute('popover', 'auto');
  card.setAttribute('aria-labelledby', 'hp-title');
  const title = document.createElement('h2');
  title.className = 'hp-title';
  title.id = 'hp-title';
  const lines = document.createElement('ul');
  lines.className = 'hp-lines';
  const items = [document.createElement('li'), document.createElement('li'), document.createElement('li')] as const;
  lines.append(...items);
  const ok = button('hp-ok');
  ok.autofocus = true;
  const more = document.createElement('div');
  more.className = 'hp-more';
  const home = button('hp-link');
  const restart = button('hp-link');
  more.append(home, restart);
  card.append(title, lines, ok, more);
  parent.append(card);

  let seen = readSeen();
  const text = (key: string): string => playText(content.strings, machine.state.lang, key);

  function paint(): void {
    title.textContent = text('play.help');
    items[0].textContent = text(d.touch ? 'play.touch1' : 'play.keys1');
    items[1].textContent = text(d.touch ? 'play.touch2' : 'play.keys2');
    items[2].textContent = text('play.goal');
    ok.textContent = text('play.gotIt');
    home.textContent = text('play.home');
    restart.textContent = text('play.restart');
  }

  const isOpen = (): boolean => card.matches(':popover-open');
  const close = (): void => {
    if (isOpen()) card.hidePopover();
  };

  function open(): void {
    const s = machine.state;
    if (isOpen() || s.mode !== 'garden' || panelUp(s)) return;
    card.showPopover();
  }

  card.addEventListener('toggle', (e) => {
    if ((e as ToggleEvent).newState !== 'closed' || seen) return;
    seen = true;
    try {
      localStorage.setItem(HELP.seenKey, '1');
    } catch {
      /* storage blocked: the card may come up by itself again on the next visit */
    }
  });
  ok.addEventListener('click', close);
  home.addEventListener('click', () => {
    close();
    d.home();
  });
  restart.addEventListener('click', () => {
    close();
    d.restart();
  });
  /** Escape closes the card before anything under it hears the key; H and ? toggle it. */
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'h' && e.key !== 'H' && e.key !== '?')) return;
    if (e.target instanceof Element && e.target.closest(TYPING) !== null) return;
    e.preventDefault();
    if (isOpen()) close();
    else open();
  }, true);
  machine.subscribe((s, prev) => {
    if (s.lang !== prev.lang) paint();
    if (s.mode !== 'garden' || panelUp(s)) close();
  });
  paint();

  return {
    el: card,
    get seen() {
      return seen;
    },
    open,
  };
}
