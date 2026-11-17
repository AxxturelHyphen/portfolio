import type { Lang } from '../../types.ts';
import { esc } from './html.ts';

/**
 * Specimen thumbnails for the Herbario mounts, from public/thumbs/manifest.json (written by `npm run assets thumbs`).
 * The template is pure and runs in two places, so the manifest reaches it two ways:
 *  - at build and in dev (scripts/prerender.ts, in Node) it is read from disk; a missing or broken file means
 *    no thumbnails, and every mount keeps its honest empty state;
 *  - in the browser (a language switch re-renders the Herbario) it is read back once from the JSON block that the
 *    prerendered page carries (thumbBlock), so both renders show the same specimens.
 */

export interface Thumb { project: string; file: string; source: string; title: string; latin: string }
export type ThumbIndex = ReadonlyMap<string, Thumb>;

const MANIFEST = 'public/thumbs/manifest.json';
const BLOCK_ID = 'h-thumbs';
const CREDIT: Record<Lang, string> = { en: 'Plate', es: 'Lámina' };

function isThumb(v: unknown): v is Thumb {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return ['project', 'file', 'source', 'title', 'latin'].every((k) => typeof t[k] === 'string');
}

function parse(json: string | undefined): Thumb[] {
  if (json === undefined || json === '') return [];
  try {
    const raw: unknown = JSON.parse(json);
    const list = typeof raw === 'object' && raw !== null ? (raw as { thumbs?: unknown }).thumbs : undefined;
    return Array.isArray(list) ? list.filter(isThumb).filter((t) => /^[\w-]+\.avif$/.test(t.file)) : [];
  } catch {
    return [];
  }
}

interface NodeFs { existsSync(p: string): boolean; readFileSync(p: string, enc: 'utf8'): string }
interface NodeProcess { getBuiltinModule?(id: string): unknown }

function readSource(): string | undefined {
  const proc = (globalThis as { process?: NodeProcess }).process;
  const fs = proc?.getBuiltinModule?.('node:fs') as NodeFs | undefined;
  if (fs !== undefined) return fs.existsSync(MANIFEST) ? fs.readFileSync(MANIFEST, 'utf8') : undefined;
  return typeof document === 'undefined' ? undefined : (document.getElementById(BLOCK_ID)?.textContent ?? undefined);
}

let cached: Thumb[] | null = null;

/** Node reads the file on every call (dev picks up a new manifest on reload); the browser reads its block once. */
export function loadThumbs(): ThumbIndex {
  const inNode = typeof document === 'undefined';
  const list = inNode || cached === null ? parse(readSource()) : cached;
  if (!inNode) cached = list;
  return new Map(list.map((t) => [t.project, t]));
}

/** The JSON block the browser reads back; '<' is escaped so a title can never close the script. */
export function thumbBlock(index: ThumbIndex): string {
  if (index.size === 0) return '';
  const json = JSON.stringify({ thumbs: [...index.values()] }).replace(/</g, '\\u003c');
  return `<script type="application/json" id="${BLOCK_ID}">${json}</script>`;
}

/** The mounted specimen with its plate's Latin name and credit, or '' when the project has no thumbnail yet. */
export function specimen(t: Thumb | undefined, l: Lang): string {
  if (t === undefined) return '';
  return `<figure class="h-specimen">
<img class="h-specimen-img" src="thumbs/${esc(t.file)}" alt="" width="480" height="480" loading="lazy" decoding="async">
<figcaption class="h-specimen-cap"><span class="h-specimen-latin" lang="la">${esc(t.latin)}</span><span class="h-specimen-credit">${CREDIT[l]}: ${esc(t.title)}</span></figcaption>
</figure>`;
}
