import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

const RAW_GLSL = /\.glsl\?raw$/;
/** No + or -: `a - -b` must not become the decrement `a--b`. */
const PUNCTUATION = /\s*([{}()[\],;=*/<>!&|?:])\s*/g;
const IDENTIFIER = /[A-Za-z_]\w*/g;
/** Identifiers first, so the digits in `vec3` or `hash12` are never read as a number. */
const TOKEN = /[A-Za-z_]\w*|\d*\.\d*(?:[eE][+-]?\d+)?/g;
const TYPE = String.raw`(?:void|bool|u?int|float|[biu]?vec[234]|mat[234](?:x[234])?)`;
/** A declaration the program owns: a function, parameter, local or global constant, by its built-in type. */
const DECLARED = new RegExp(String.raw`\b${TYPE}\s+([A-Za-z_]\w*)\s*[[;,=)(]`, 'g');
const FUNCTION = new RegExp(String.raw`\b${TYPE}\s+([A-Za-z_]\w*)\s*\(`, 'g');
/** Names three or the GPU bind by spelling: uniforms, stage inputs and outputs (and, harmlessly, `in`/`out` parameters). */
const INTERFACE = /\b(?:uniform|in|out|inout|attribute|varying)\b[^;)]*/g;
/** A global stage input or output, on a line of its own. */
const STAGE = (qualifier: string): RegExp => new RegExp(String.raw`^(?:(?:flat|smooth|centroid)\s+)*${qualifier}\s[^;]*;`, 'gm');
const MEMBER = /\.\s*([A-Za-z_]\w*)/g;
const VARIABLE = String.raw`[A-Za-z_]\w*(?:\[\d*\])?`;
/** Two declarations of one qualified type in a row, each a variable (never a function), at the start of a statement. */
const REPEATED = new RegExp(String.raw`(?<=^|[;{}\n])((?:(?:const|uniform|(?:flat )?(?:in|out)) )?(?:${TYPE}|sampler\w+)) (${VARIABLE}(?![\w(])[^;{}\n]*);\1 (?=${VARIABLE}[=;,])`, 'g');

/** Two tokens need a space between them only when they would fuse: two words, or two signs (`b - -c`). */
const fuses = (a: string, b: string): boolean => (/[\w.]/.test(a) && /[\w.]/.test(b)) || (/[+-]/.test(a) && /[+-]/.test(b));

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

/** `1.0` to `1.`, `0.50` to `.5`, `2.0e-3` to `2.e-3`; never a lone dot. */
export function shortenFloat(literal: string): string {
  const m = /^(\d*)\.(\d*)(.*)$/.exec(literal);
  if (m === null) return literal;
  const fraction = (m[2] ?? '').replace(/0+$/, '');
  const whole = m[1] === '0' && fraction !== '' ? '' : (m[1] ?? '');
  return `${whole}.${fraction}${m[3] ?? ''}`;
}

const names = (source: string, pattern: RegExp): string[] => [...source.matchAll(pattern)].map((m) => m[1] ?? '');

/** Short names never seen in the sources: letters, then a letter and digits (no GLSL keyword has that shape). */
function* shortNames(taken: ReadonlySet<string>): Generator<string> {
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let digits = 0; ; digits++) {
    for (let n = 0; n < 10 ** digits; n++) {
      for (const letter of letters) {
        const name = digits === 0 ? letter : letter + String(n).padStart(digits, '0');
        if (!taken.has(name)) yield name;
      }
    }
  }
}

/**
 * One renaming for every shader of the build. The chunks are concatenated in any combination before compiling, so the
 * map must be shared and one-to-one: every identifier keeps the same name in every file, and no new name exists
 * anywhere in the sources, so scoping and shadowing are unchanged. Only names the program declares with a built-in
 * type are renamed, varyings included (one stage's output is the next one's input, linked by name in the same build);
 * uniforms, attributes, fragment outputs, anything read as a member or swizzle, `main` and any declared name that is
 * also called without being a function of ours (a local shadowing a built-in) keep their spelling.
 */
export function shaderRenames(sources: readonly string[]): Map<string, string> {
  const all = sources.join('\n');
  const ids = (pattern: RegExp): Set<string> => new Set([...all.matchAll(pattern)].flatMap((m) => m[0].match(IDENTIFIER) ?? []));
  const outs = ids(STAGE('out'));
  const varyings = [...ids(STAGE('in'))].filter((id) => outs.has(id));
  const keep = ids(INTERFACE);
  for (const id of varyings) keep.delete(id);
  for (const id of ['main', ...names(all, MEMBER)]) keep.add(id);
  const functions = new Set(names(all, FUNCTION));
  for (const m of all.matchAll(/([A-Za-z_]\w*)\s*\(/g)) if (!functions.has(m[1] ?? '')) keep.add(m[1] ?? '');
  const counts = new Map<string, number>();
  for (const id of all.match(IDENTIFIER) ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  const renamed = [...new Set(names(all, DECLARED))].filter((id) => !keep.has(id) && !id.startsWith('gl_'));
  renamed.sort((a, b) => (counts.get(b) ?? 0) * b.length - (counts.get(a) ?? 0) * a.length || (a < b ? -1 : 1));
  const fresh = shortNames(new Set(counts.keys()));
  const map = new Map<string, string>();
  for (const id of renamed) {
    const next = fresh.next().value ?? id;
    if (next.length < id.length) map.set(id, next);
  }
  return map;
}

/**
 * `float a=1.;float b=a;` to `float a=1.,b=a;` and `uniform vec3 a;uniform vec3 b;` to `uniform vec3 a,b;`: each name
 * is in scope from its own initializer on, as before, and keeps its qualifiers.
 */
export function mergeDeclarations(code: string): string {
  let merged = code;
  for (let last = ''; last !== merged; ) {
    last = merged;
    merged = merged.replace(REPEATED, '$1 $2,');
  }
  return merged;
}

/**
 * The second pass on minified sources: renamed identifiers, shortest float literals, every run of code lines joined
 * into one and repeated declarations merged. Directive lines keep a line of their own and the result still ends with a
 * newline.
 */
export function packGlsl(minified: string, renames: ReadonlyMap<string, string>): string {
  let out = '';
  for (const line of minified.split('\n')) {
    if (line === '') continue;
    const renamed = line.replace(TOKEN, (t) => (/^[\d.]/.test(t) ? shortenFloat(t) : (renames.get(t) ?? t)));
    if (renamed.startsWith('#')) {
      out += `${out === '' || out.endsWith('\n') ? '' : '\n'}${renamed}\n`;
      continue;
    }
    const packed = renamed.replace(/ /g, (space, i: number, s: string) => (fuses(s[i - 1] ?? '', s[i + 1] ?? '') ? space : ''));
    const joined = out === '' || out.endsWith('\n') || !fuses(out.at(-1) ?? '', packed[0] ?? '');
    out += (joined ? '' : ' ') + packed;
  }
  return mergeDeclarations(out.endsWith('\n') ? out : `${out}\n`);
}

/**
 * Vite plugin (build only): every `*.glsl?raw` import under `dir` ships minified and packed with one renaming shared by
 * the whole directory. A shader outside `dir` stops the build, since it would miss the shared renaming. Dev keeps the
 * readable source.
 */
export function glslMinify(dir = 'src/gl/shaders'): Plugin {
  const minified = new Map<string, string>();
  let renames = new Map<string, string>();
  return {
    name: 'jardin-glsl-minify',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      minified.clear();
      for (const name of readdirSync(dir).filter((n) => n.endsWith('.glsl'))) {
        const path = resolve(join(dir, name));
        this.addWatchFile(path);
        minified.set(path, minifyGlsl(readFileSync(path, 'utf8')));
      }
      renames = shaderRenames([...minified.values()]);
    },
    load(id) {
      if (!RAW_GLSL.test(id)) return null;
      const source = minified.get(resolve(id.replace(/\?raw$/, '')));
      if (source === undefined) this.error(`${id}: shaders must live in ${dir} to share the build's renaming`);
      return `export default ${JSON.stringify(packGlsl(source, renames))};`;
    },
  };
}
