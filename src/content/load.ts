import projects from '../../content/projects.json' with { type: 'json' };
import profile from '../../content/profile.json' with { type: 'json' };
import strings from '../../content/strings.json' with { type: 'json' };
import type { Profile, Project, ProjectBed, Strings } from '../types.ts';
import type { HerbarioContent } from './schema.ts';

/** Static content, validated at build by scripts/prerender.ts (schema.ts), so the browser only casts. */
const content: HerbarioContent = {
  projects: projects as Project[],
  profile: profile as Profile,
  strings: strings as Strings,
};

export function loadContent(): HerbarioContent {
  return content;
}

const yearOf = (p: Project): number => (typeof p.year === 'number' ? p.year : 0);

/** Importance desc, then year desc: the one order for slots, Herbario articles and tab order. */
export function projectsOf(bed: ProjectBed, list: readonly Project[] = content.projects): Project[] {
  return list.filter((p) => p.bed === bed).sort((a, b) => b.importance - a.importance || yearOf(b) - yearOf(a));
}
