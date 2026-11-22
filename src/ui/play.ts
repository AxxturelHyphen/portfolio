import type { StickPad } from '../core/stick.gesture.ts';
import type { BedId, Content, Lang, Machine, State } from '../types.ts';
import type { GardenMemory } from '../world/memory.ts';
import { createHelp } from './help.ts';
import { playText } from './play.copy.ts';
import { createQuest, type QuestNote } from './quest.ts';
import { createStick } from './stick.ts';
import { hasGap } from './welcome.rules.ts';
import './styles/play.css';

/**
 * The garden as a little game (free roam only): the lantern round's tag top left ("2 / 4 flowers lit", ui/quest.ts),
 * with the "?" tag that opens the how-to-play card (ui/help.ts); a one-time slip under the tag when a bed is all lit;
 * and when every flower is, a one-time card with the real ways on (Download CV, the owner's links) while the tag turns
 * into the invitation to walk to the Salida. On touch, the floating stick (ui/stick.ts) and a round Open button low
 * right that is there only while a flower or a pet is in reach (the same action as Enter). The tag and the "?" step
 * aside while the first-visit plate stands (play.css). The help card never comes up by itself: the first visit's
 * controls are chalked at the gate (garden/chalk.drive.ts). Notes wait until no panel is up.
 */

export interface PlayDeps {
  machine: Machine;
  content: Content;
  memory: GardenMemory;
  /** The flower slots' layer, where the focused one's name is read for the Open button. */
  proxies: HTMLElement;
  /** Opens the focused slot as Enter does. */
  activate(): void;
  home(): void;
  bedTitle(bed: BedId, lang: Lang): string;
}

export interface Play { readonly stick: StickPad }

/** The bed note stays this long (ms). */
const NOTE_MS = 4200;
/** "[FILL: ...]" owner gaps, stripped from a link's label. */
const GAP_LABEL = /\s*\[FILL[^\]]*\]/g;

const panelUp = (s: State): boolean => s.phase === 'opening' || s.phase === 'inspect' || s.phase === 'closing';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  n.textContent = text;
  if (n instanceof HTMLButtonElement) n.type = 'button';
  return n;
}

export function createPlay(parent: HTMLElement, d: PlayDeps): Play {
  const { machine, content, memory } = d;
  const touch = matchMedia('(pointer: coarse)').matches;
  const quest = createQuest(content.projects.map((p) => ({ id: p.id, bed: p.bed })), (id) => memory.visited(id), globalThis.localStorage ?? null);
  const salida = content.garden.order.find((b) => b === 'salida') ?? content.garden.order[content.garden.order.length - 1]!;
  const text = (key: string, fill?: Record<string, string | number>): string => playText(content.strings, machine.state.lang, key, fill);

  const stick = createStick(parent);
  const hud = el('div', 'pq');
  hud.setAttribute('role', 'group');
  const count = el('p', 'pq-tag');
  count.setAttribute('role', 'status');
  const invite = el('button', 'pq-tag pq-invite');
  const ask = el('button', 'pq-ask', '?');
  hud.append(count, invite, ask);
  const note = el('p', 'pq-note');
  note.setAttribute('role', 'status');
  const open = el('button', 'pq-open');
  open.hidden = true;
  const done = el('dialog', 'hp pq-done');
  done.setAttribute('popover', 'auto');
  done.setAttribute('aria-labelledby', 'pq-done-title');
  const doneTitle = el('h2', 'hp-title');
  doneTitle.id = 'pq-done-title';
  const doneLine = el('p', 'hp-line');
  const ways = el('div', 'pq-ways');
  const walk = el('button', 'hp-ok');
  walk.autofocus = true;
  const cv = el('a', 'pq-way');
  cv.href = content.profile.cv;
  cv.download = '';
  const links = content.profile.links.filter((l) => !hasGap(l.href)).map((l) => {
    const a = el('a', 'pq-way');
    a.href = l.href;
    a.rel = 'noopener';
    a.target = '_blank';
    return { a, label: l.label };
  });
  const shut = el('button', 'hp-link');
  ways.append(cv, ...links.map((l) => l.a));
  done.append(doneTitle, doneLine, walk, ways, shut);
  /** The counter and "?" come before the world's controls in the Tab order: top tags, this tag, the world, the corner. */
  parent.insertBefore(hud, d.proxies);
  parent.append(note, open, done);

  const help = createHelp(parent, {
    machine, content, touch,
    home: d.home,
    restart() {
      pending = null;
      memory.reset();
      quest.reset();
      paint();
    },
  });
  ask.setAttribute('popovertarget', help.el.id);

  let pending: QuestNote = null;
  let noteTimer = 0;

  function paint(): void {
    const lang = machine.state.lang;
    const complete = quest.complete();
    count.textContent = text('play.lit', { n: quest.lit(), total: quest.total });
    count.hidden = complete;
    invite.hidden = !complete;
    invite.textContent = text('play.allLit');
    hud.setAttribute('aria-label', text('play.hud'));
    ask.setAttribute('aria-label', text('play.help'));
    open.textContent = text('play.open');
    doneTitle.textContent = text('play.doneTitle');
    doneLine.textContent = text('play.doneLine');
    walk.textContent = text('play.toSalida');
    cv.textContent = playText(content.strings, lang, 'cv.download');
    for (const l of links) l.a.textContent = l.label[lang].replace(GAP_LABEL, '').trim();
    shut.textContent = text('play.close');
  }

  function showNote(): void {
    const n = pending;
    if (n === null || panelUp(machine.state) || machine.state.mode !== 'garden') return;
    pending = null;
    if (n.k === 'complete') {
      done.showPopover();
      return;
    }
    note.textContent = text('play.bedDone', { bed: d.bedTitle(n.bed as BedId, machine.state.lang) });
    note.dataset.on = '';
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => delete note.dataset.on, NOTE_MS);
  }

  /** The Open button: on touch, while a slot is focused in the garden; named for what it opens. */
  function reach(s: State): void {
    const on = touch && s.mode === 'garden' && s.phase === 'focus' && s.slot !== null;
    open.hidden = !on;
    if (!on || s.slot === null) return;
    const name = d.proxies.querySelector(`[data-slot="${CSS.escape(s.slot)}"]`)?.textContent?.trim() ?? '';
    open.setAttribute('aria-label', name === '' ? text('play.open') : `${text('play.open')}: ${name}`);
  }

  const toSalida = (): void => {
    if (done.matches(':popover-open')) done.hidePopover();
    machine.send({ type: 'GOTO', place: { k: 'bed', bed: salida } });
  };
  invite.addEventListener('click', toSalida);
  walk.addEventListener('click', toSalida);
  shut.addEventListener('click', () => done.hidePopover());
  open.addEventListener('click', d.activate);
  memory.onVisit((id) => {
    pending = quest.note(id) ?? pending;
    paint();
  });
  machine.subscribe((s, prev) => {
    if (s.lang !== prev.lang) paint();
    if (s.mode !== 'garden' && done.matches(':popover-open')) done.hidePopover();
    reach(s);
    showNote();
  });
  paint();
  reach(machine.state);
  return { stick };
}
