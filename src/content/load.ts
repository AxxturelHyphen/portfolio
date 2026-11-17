import projects from '../../content/projects.json' with { type: 'json' };
import profile from '../../content/profile.json' with { type: 'json' };
import strings from '../../content/strings.json' with { type: 'json' };
import garden from '../../content/garden.json' with { type: 'json' };
import type { Content, GardenLayout, Profile, Project, ProjectBed, Strings } from '../types.ts';

/** Static content, validated at build by scripts/prerender.ts (schema.ts, world/scene.ts), so the browser only casts. */
const content: Content = {
  projects: projects as Project[],
  profile: profile as Profile,
  strings: strings as Strings,
  garden: garden as unknown as GardenLayout,
};

export function loadContent(): Content {
  return content;
}

const yearOf = (p: Project): number => (typeof p.year === 'number' ? p.year : 0);

/** Importance desc, then year desc: the one order for slots, Herbario articles and tab order. */
export function projectsOf(bed: ProjectBed, list: readonly Project[] = content.projects): Project[] {
  return list.filter((p) => p.bed === bed).sort((a, b) => b.importance - a.importance || yearOf(b) - yearOf(a));
}
