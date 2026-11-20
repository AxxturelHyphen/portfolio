import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const RAW_GLSL = /\.glsl\?raw$/;
/** No + or -: `a - -b` must not become the decrement `a--b`. */
const PUNCTUATION = /\s*([{}()[\],;=*/<>!&|?:])\s*/g;

/** Drops // and block comments; GLSL has no string literals, so no other token can contain them. */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      out += ' ';
      i = end === -1 ? source.length : end + 2;
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out;
}

/**
 * Same program, fewer bytes: no comments, no indentation, no blank lines, no spaces around punctuation.
 * Lines stay lines (preprocessor directives need them) and the result ends with a newline, so sources that are
 * concatenated before compiling never fuse two lines. Directive lines only lose their indentation: the space in
 * `#define F (x)` is meaningful.
 */
export function minifyGlsl(source: string): string {
  const lines: string[] = [];
  for (const raw of stripComments(source).split('\n')) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (line === '') continue;
    lines.push(line.startsWith('#') ? line : line.replace(PUNCTUATION, '$1'));
  }
  return `${lines.join('\n')}\n`;
}

/** Vite plugin (build only): every `*.glsl?raw` import ships minified. Dev keeps the readable source. */
export function glslMinify(): Plugin {
  return {
    name: 'jardin-glsl-minify',
    apply: 'build',
    enforce: 'pre',
    load(id) {
      if (!RAW_GLSL.test(id)) return null;
      const path = id.replace(/\?raw$/, '');
      this.addWatchFile(path);
      return `export default ${JSON.stringify(minifyGlsl(readFileSync(path, 'utf8')))};`;
    },
  };
}
