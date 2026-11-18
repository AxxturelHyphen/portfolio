import type { BedId, Machine, ProjectId, SlotId } from '../types.ts';

/**
 * A project chosen in the plan (ui/plan.ts WORK_EVENT): walks the visitor to the project's bed by the assisted walk
 * (GOTO), then, once the bed is entered and its flowers are mounted, to the flower itself (free roam: the Tab-to-flower
 * walk, focused on arrival) and moves keyboard focus onto the flower's proxy, so Enter opens it. On the rail the flower
 * is focused as soon as the bed is reached. Leaving for another bed, the Herbario or a project cancels it.
 */

export interface WorkWalkDeps {
  machine: Machine;
  bedOf(id: ProjectId): BedId | null;
  slotOf(id: ProjectId): SlotId | null;
  /** The proxies layer: the flower's proxy is in it once its bed is entered. */
  proxies: HTMLElement;
  /** Free roam: walks the visitor to the slot (true), false while it cannot yet (still landing); null on the rail. */
  seek: ((slot: SlotId) => boolean) | null;
  /** Moves keyboard focus onto the slot's proxy. */
  focus(slot: SlotId): void;
}

export interface WorkWalk {
  start(id: ProjectId): void;
  /** Stage 'dom' and every state change: hands over to the flower once the bed is reached. True while one is pending. */
  step(): boolean;
}

export function createWorkWalk(d: WorkWalkDeps): WorkWalk {
  const { machine } = d;
  let bed: BedId | null = null;
  let slot: SlotId | null = null;
  let selector = '';

  function cancel(): void {
    bed = null;
    slot = null;
  }

  return {
    start(id) {
      const b = d.bedOf(id);
      const v = d.slotOf(id);
      if (b === null || v === null || machine.state.mode !== 'garden') return;
      bed = b;
      slot = v;
      selector = `[data-slot="${CSS.escape(v)}"]`;
      if (machine.state.bed !== b) machine.send({ type: 'GOTO', place: { k: 'bed', bed: b } });
    },
    step() {
      if (bed === null || slot === null) return false;
      const s = machine.state;
      if (s.mode !== 'garden' || (s.bed !== bed && s.phase !== 'travel') || s.phase === 'opening' || s.phase === 'inspect') {
        cancel();
        return false;
      }
      if ((s.phase !== 'bed' && s.phase !== 'focus') || s.bed !== bed || d.proxies.querySelector(selector) === null) return true;
      if (d.seek !== null && !d.seek(slot)) return true;
      const target = slot;
      cancel();
      d.focus(target);
      return false;
    },
  };
}
