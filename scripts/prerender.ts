import type { Plugin } from 'vite';
import projects from '../content/projects.json' with { type: 'json' };
import profile from '../content/profile.json' with { type: 'json' };
import strings from '../content/strings.json' with { type: 'json' };
import { bootInline } from '../src/boot.inline.ts';
import { decideMode } from '../src/core/quality.ts';
import { renderHerbario } from '../src/content/herbario/template.ts';
import { validateContent } from '../src/content/schema.ts';
import { renderToggles } from '../src/ui/toggles.ts';

/**
 * Vite plugin: validates the content JSON (a schema error fails the build) and fills index.html:
 * <!--herbario--> gets the English Herbario, <!--toggles--> the top-right controls, <!--boot--> the inline stub that picks the mode before first paint.
 */
export function prerender(): Plugin {
  return {
    name: 'jardin-prerender',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const content = validateContent({ projects, profile, strings });
        const boot = `<script>${`(${bootInline.toString()})(${decideMode.toString()})`.replace(/\s+/g, ' ')}</script>`;
        return html
          .replace('<!--boot-->', boot)
          .replace('<!--toggles-->', renderToggles(content.strings, 'en', content.profile.cv))
          .replace('<!--herbario-->', renderHerbario(content, 'en'));
      },
    },
  };
}
