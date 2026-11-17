import type { BedId, CameraRig, Machine, ProxyLayer, ScreenPt, SlotView } from '../types.ts';
import { LABEL_ID } from './label.ts';
import './styles/proxies.css';
import { createMover, type Mover } from './xform.ts';

/**
 * DOM proxies, the only picking of the garden (cook/ARCH.md 2.10): one real <button> per project flower or prop and
 * one <a> per link, in the bed's slot order, then one button per bed in garden order. Tab order is DOM order.
 * Each slot proxy is an ellipse sized to its hit area in world units at mount; sync() moves it by transform from the
 * rig's projection in stage 'dom', only when the rig moved. Mouse hover and keyboard focus send FOCUS, leaving sends
 * BLUR, click or Enter sends OPEN. Touch: the first tap focuses, the second one opens.
 * Props have no route: activating one dispatches `jardin:activate` (detail: the slot id) for the bed's behaviour.
 * One polite live region announces the bed the visitor arrives in.
 */

/** Proxy boxes are laid out at this many CSS px per world unit; the transform scales them to the projection. */
const PX_PER_UNIT = 100;
const ANNOUNCE_DELAY_MS = 100;

export const ACTIVATE_EVENT = 'jardin:activate';

const pt: ScreenPt = { x: 0, y: 0, scale: 1, visible: true };

export function createProxies(el: HTMLElement, m: Machine): ProxyLayer {
  const slotsGroup = document.createElement('div');
  slotsGroup.className = 'px-slots';
  slotsGroup.setAttribute('role', 'group');
  const bedsGroup = document.createElement('div');
  bedsGroup.className = 'px-beds';
  const live = document.createElement('p');
  live.className = 'px-live';
  live.setAttribute('aria-live', 'polite');
  el.replaceChildren(slotsGroup, bedsGroup, live);

  const bedTitles = new Map<BedId, string>();
  let nodes: HTMLElement[] = [];
  let movers: Mover[] = [];
  let world = new Float32Array(0);
  let off: boolean[] = [];
  let dirty = false;
  let lastPointer = 'mouse';
  let announceTimer = 0;

  el.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType;
  }, { capture: true });

  const isFocused = (slot: string): boolean => m.state.phase === 'focus' && m.state.slot === slot;
  const canFocus = (): boolean => m.state.phase === 'bed' || m.state.phase === 'focus';

  function focusSlot(slot: string): void {
    if (canFocus() && !isFocused(slot)) m.send({ type: 'FOCUS', slot });
  }

  function blurSlot(slot: string, n: HTMLElement): void {
    if (isFocused(slot) && document.activeElement !== n) m.send({ type: 'BLUR' });
  }

  function announce(text: string): void {
    live.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      live.textContent = text;
    }, ANNOUNCE_DELAY_MS);
  }

  function slotNode(v: SlotView): HTMLElement {
    const n: HTMLElement = document.createElement(v.kind === 'link' ? 'a' : 'button');
    if (n instanceof HTMLAnchorElement) {
      n.href = v.href ?? '#';
      n.target = '_blank';
      n.rel = 'noopener';
    } else {
      n.setAttribute('type', 'button');
    }
    n.className = `px-slot px-${v.kind}`;
    n.dataset.slot = v.id;
    if (v.project !== undefined) n.dataset.project = v.project.id;
    n.setAttribute('aria-describedby', LABEL_ID);
    n.textContent = v.alt;
    const w = v.hit[0] * PX_PER_UNIT;
    const h = v.hit[1] * PX_PER_UNIT;
    n.style.width = `${w}px`;
    n.style.height = `${h}px`;
    n.style.marginLeft = `${-w / 2}px`;
    n.style.marginTop = `${-h / 2}px`;

    n.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') focusSlot(v.id);
    });
    n.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch') blurSlot(v.id, n);
    });
    /** A touch tap also focuses the button: the click handler decides there (first tap focuses, second opens). */
    n.addEventListener('focus', () => {
      if (lastPointer !== 'touch') focusSlot(v.id);
    });
    n.addEventListener('blur', () => blurSlot(v.id, n));
    n.addEventListener('click', (e) => {
      if (lastPointer === 'touch' && !isFocused(v.id)) {
        e.preventDefault();
        lastPointer = 'mouse';
        focusSlot(v.id);
        return;
      }
      lastPointer = 'mouse';
      if (v.kind === 'project' && v.project !== undefined) m.send({ type: 'OPEN', id: v.project.id });
      else if (v.kind === 'prop') {
        focusSlot(v.id);
        el.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: v.id, bubbles: true }));
      }
    });
    return n;
  }

  return {
    mountBeds(beds: readonly { id: BedId; title: string }[]): void {
      bedTitles.clear();
      const buttons = beds.map((b) => {
        bedTitles.set(b.id, b.title);
        const n = document.createElement('button');
        n.type = 'button';
        n.className = 'px-bed';
        n.dataset.bed = b.id;
        n.textContent = b.title;
        n.addEventListener('click', () => m.send({ type: 'GOTO', place: { k: 'bed', bed: b.id } }));
        return n;
      });
      bedsGroup.replaceChildren(...buttons);
    },

    mountSlots(bed: BedId, slots: readonly SlotView[]): void {
      nodes = slots.map(slotNode);
      movers = nodes.map(createMover);
      off = nodes.map(() => false);
      world = new Float32Array(slots.length * 3);
      slots.forEach((v, i) => world.set(v.world, i * 3));
      const title = bedTitles.get(bed) ?? bed;
      slotsGroup.setAttribute('aria-label', title);
      slotsGroup.replaceChildren(...nodes);
      el.dataset.bed = bed;
      dirty = true;
      announce(title);
    },

    unmountSlots(): void {
      slotsGroup.replaceChildren();
      slotsGroup.removeAttribute('aria-label');
      delete el.dataset.bed;
      nodes = [];
      movers = [];
      off = [];
      world = new Float32Array(0);
    },

    sync(rig: CameraRig): void {
      if (!rig.changed && !dirty) return;
      dirty = false;
      for (let i = 0; i < movers.length; i++) {
        rig.project(world[i * 3] ?? 0, world[i * 3 + 1] ?? 0, world[i * 3 + 2] ?? 0, pt);
        const hidden = !pt.visible;
        if (hidden !== off[i]) {
          off[i] = hidden;
          nodes[i]?.toggleAttribute('data-off', hidden);
        }
        if (!hidden) movers[i]?.move(pt.x, pt.y, pt.scale / PX_PER_UNIT);
      }
    },

    focus(id: string): void {
      const sel = `[data-slot="${CSS.escape(id)}"], [data-bed="${CSS.escape(id)}"]`;
      el.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
    },
  };
}
