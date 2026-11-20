import { projectsOf } from '../content/load.ts';
import type { BedId, Project, ProjectBed } from '../types.ts';
import type { BedSign } from './signposts.ts';
import { hasGap } from './welcome.rules.ts';

/**
 * The plan's index of the work: one group per bed that holds projects, in bed order, the bed's name over its projects.
 * Each project is a full-width button of thumb height named by its title alone; its status sits at the row's right
 * end as a small ink mark and word (ring: idea, ring with a dot: in progress, filled: shipped), outside the button's
 * name and clear of its clicks. The group of the place the visitor stands in carries a rose mark.
 */

export interface PlanIndex {
  mount(beds: readonly BedSign[], projects: readonly Project[], statusText: (s: Project['status']) => string): void;
  mark(here: BedId | null): void;
}

export function createPlanIndex(list: HTMLUListElement): PlanIndex {
  return {
    mount(beds, projects, statusText) {
      const isProjectBed = (b: BedId): b is ProjectBed => projects.some((p) => p.bed === b);
      list.replaceChildren(...beds.flatMap((b) => {
        const shown = isProjectBed(b.id) ? projectsOf(b.id, projects).filter((p) => !hasGap(p.title)) : [];
        if (shown.length === 0) return [];
        const group = document.createElement('li');
        group.className = 'pl-group';
        group.dataset.bed = b.id;
        const name = document.createElement('p');
        name.className = 'pl-bed';
        name.textContent = b.title;
        const items = document.createElement('ul');
        items.append(...shown.map((p) => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.dataset.project = p.id;
          btn.textContent = p.title;
          const status = document.createElement('span');
          status.className = 'pl-status';
          status.dataset.status = p.status;
          status.textContent = statusText(p.status);
          li.append(btn, status);
          return li;
        }));
        group.append(name, items);
        return [group];
      }));
    },
    mark(here) {
      for (const g of list.querySelectorAll<HTMLElement>('.pl-group')) g.toggleAttribute('data-here', g.dataset.bed === here);
    },
  };
}
