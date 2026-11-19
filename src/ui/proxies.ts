import { GESTURE } from '../core/input.ts';
import type { BedId, CameraRig, Machine, ProxyLayer, ScreenPt, SlotId, SlotView } from '../types.ts';
import { LABEL_ID } from './label.ts';
import { createPlan } from './plan.ts';
import { createSignposts, type BedSign, type SignAnchor } from './signposts.ts';
import './styles/proxies.css';
import { createMover, type Mover } from './xform.ts';

/**
 * DOM proxies, the only picking of the garden (cook/ARCH.md 2.10): one real <button> per project flower or prop and
 * one <a> per link, in the bed's slot order, then the two signposts of the current bed, then the garden plan
 * (ui/signposts.ts, ui/plan.ts). Tab order is DOM order. #proxies[data-phase] mirrors the phase for the CSS.
 * Each slot proxy is an ellipse sized to its hit area in world units at mount; sync() moves it by transform from the
 * rig's projection in stage 'dom', only when the rig moved. Mouse hover and keyboard focus send FOCUS, leaving sends
 * BLUR, click or Enter sends OPEN. Touch: the first tap focuses, the second one opens.
 * Props have no route: activating one dispatches `jardin:activate` (detail: the slot id) for the bed's behaviour.
 * One polite live region announces the bed the visitor arrives in and, in free roam, the flower the visitor walks up to.
 * Free roam: Tab onto a flower off screen or out of reach walks the visitor to it (the seek hook) instead of focusing
 * it at once; it is focused on arrival.
 */

/** Proxy boxes are laid out at this many CSS px per world unit; the transform scales them to the projection. */
const PX_PER_UNIT = 100;
const ANNOUNCE_DELAY_MS = 100;

export const ACTIVATE_EVENT = 'jardin:activate';

/** ProxyLayer plus the sign anchors that world supplies (bed boards in world units). */
export interface GardenProxies extends ProxyLayer {
  mountBeds(beds: readonly BedSign[]): void;
  setSigns(anchors: readonly SignAnchor[]): void;
  /**
   * Free roam: the signs stand planted in the world, clear of the visitor at this [x, z], and the plan's moth follows it
   * (places at their anchors). Slots off screen stay in the Tab order, so a keyboard or screen-reader visitor never has
   * to walk to reach a flower: `seek` walks the visitor to a Tab-reached flower and says whether it did.
   */
  setVisitor(at: Float32Array, anchors: Readonly<Record<BedId, number>>, seek: (slot: SlotId, offScreen: boolean) => boolean): void;
  /**
   * Free roam: the slot the visitor stands by (proximity focus). The pointer leaving it does not blur it, and its name
   * is said once per newly focused flower. DOM focus is not moved.
   */
  setNear(id: SlotId | null): void;
  /** Activates a slot's proxy as a click would (free roam: Enter on the page opens the focused flower). */
  activate(id: SlotId): void;
}

const pt: ScreenPt = { x: 0, y: 0, scale: 1, visible: true };

export function createProxies(el: HTMLElement, m: Machine): GardenProxies {
  const slotsGroup = document.createElement('div');
  slotsGroup.className = 'px-slots';
  slotsGroup.setAttribute('role', 'group');
  const live = document.createElement('p');
  live.className = 'px-live';
  live.setAttribute('aria-live', 'polite');
  el.replaceChildren(slotsGroup);
  const signs = createSignposts(el, m);
  const plan = createPlan(el, m);
  el.append(live);

  const bedTitles = new Map<BedId, string>();
  let nodes: HTMLElement[] = [];
  let movers: Mover[] = [];
  let world = new Float32Array(0);
  let off: boolean[] = [];
  let dirty = false;
  let signsDirty = true;
  let lastPointer = 'mouse';
  let announceTimer = 0;
  let roaming = false;
  let near: SlotId | null = null;
  let said: SlotId | null = null;
  let seek: ((slot: SlotId, offScreen: boolean) => boolean) | null = null;
  /** The next focus comes from a Tab press (not a click, a script or the panel handing focus back). */
  let tabbed = false;

  el.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType;
  }, { capture: true });
  document.addEventListener('keydown', (e) => {
    tabbed = e.key === 'Tab';
  }, { capture: true });
  document.addEventListener('pointerdown', () => {
    tabbed = false;
  }, { capture: true });

  /**
   * Touch on a slot proxy: the touch is implicitly captured by the button, so the garden's canvas input never sees it.
   * Within the tap slop it stays a tap (focus, then open). Past the slop the gesture is handed to the surface under
   * the proxy with a pointerdown at the touch's start point; the surface takes pointer capture, so the rest of the same
   * touch pans exactly as a drag begun on the canvas, and the button gets no click. #world sets touch-action: none.
   */
  let touchId = -1;
  let touchX = 0;
  let touchY = 0;

  function onSlotDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch' || touchId !== -1) return;
    touchId = e.pointerId;
    touchX = e.clientX;
    touchY = e.clientY;
  }

  function onSlotMove(e: PointerEvent): void {
    if (e.pointerId !== touchId || Math.hypot(e.clientX - touchX, e.clientY - touchY) < GESTURE.tapPx) return;
    touchId = -1;
    const surface = document.elementsFromPoint(touchX, touchY).find((n) => !el.contains(n));
    surface?.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: e.pointerId, pointerType: 'touch', isPrimary: e.isPrimary, clientX: touchX, clientY: touchY,
      screenX: touchX, screenY: touchY, button: 0, buttons: 1, bubbles: true, cancelable: true, composed: true,
    }));
  }

  function onSlotEnd(e: PointerEvent): void {
    if (e.pointerId === touchId) touchId = -1;
  }

  const isFocused = (slot: string): boolean => m.state.phase === 'focus' && m.state.slot === slot;
  const canFocus = (): boolean => m.state.phase === 'bed' || m.state.phase === 'focus';

  function focusSlot(slot: string): void {
    if (canFocus() && !isFocused(slot)) m.send({ type: 'FOCUS', slot });
  }

  function blurSlot(slot: string, n: HTMLElement): void {
    if (isFocused(slot) && document.activeElement !== n && slot !== near) m.send({ type: 'BLUR' });
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
    n.addEventListener('pointerdown', onSlotDown);
    n.addEventListener('pointermove', onSlotMove);
    n.addEventListener('pointerup', onSlotEnd);
    n.addEventListener('pointercancel', onSlotEnd);
    /** A touch tap also focuses the button: the click handler decides there (first tap focuses, second opens). */
    n.addEventListener('focus', () => {
      const walked = tabbed && seek !== null && seek(v.id, n.hasAttribute('data-off'));
      tabbed = false;
      if (lastPointer !== 'touch' && !walked) focusSlot(v.id);
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

  const follow = (): void => {
    const s = m.state;
    el.dataset.phase = s.phase;
    signs.onState(s);
    plan.onState(s);
    signsDirty = true;
  };
  m.subscribe(follow);
  follow();

  return {
    mountBeds(beds: readonly BedSign[]): void {
      bedTitles.clear();
      for (const b of beds) bedTitles.set(b.id, b.title);
      signs.mount(beds);
      plan.mount(beds);
      signsDirty = true;
    },

    setSigns(anchors: readonly SignAnchor[]): void {
      signs.setAnchors(anchors);
      signsDirty = true;
    },

    setVisitor(at, anchors, walkTo): void {
      roaming = true;
      seek = walkTo;
      signs.setVisitor(at);
      plan.follow(at, anchors);
      signsDirty = true;
    },

    setNear(id: SlotId | null): void {
      near = id;
      if (id === null || id === said) return;
      said = id;
      const name = nodes.find((n) => n.dataset.slot === id)?.textContent;
      if (name) announce(name);
    },

    activate(id: SlotId): void {
      nodes.find((n) => n.dataset.slot === id)?.click();
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
      signs.setSlots(slots);
      el.dataset.bed = bed;
      dirty = true;
      announce(title);
    },

    unmountSlots(): void {
      slotsGroup.replaceChildren();
      signs.setSlots([]);
      slotsGroup.removeAttribute('aria-label');
      delete el.dataset.bed;
      nodes = [];
      movers = [];
      off = [];
      world = new Float32Array(0);
    },

    sync(rig: CameraRig): void {
      signs.sync(rig, signsDirty);
      signsDirty = false;
      plan.sync();
      if (!rig.changed && !dirty) return;
      dirty = false;
      for (let i = 0; i < movers.length; i++) {
        rig.project(world[i * 3] ?? 0, world[i * 3 + 1] ?? 0, world[i * 3 + 2] ?? 0, pt);
        const hidden = !pt.visible;
        if (hidden !== off[i]) {
          off[i] = hidden;
          const n = nodes[i];
          if (n !== undefined) {
            n.toggleAttribute('data-off', hidden);
            n.tabIndex = hidden && !roaming ? -1 : 0;
          }
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
