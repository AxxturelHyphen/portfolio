/**
 * The first visit's pure rules (ui/welcome.ts and ui/plan.ts): which sentences of the owner's headline may show, which
 * movement hint fits the input, and how long the plate stays.
 */

export const WELCOME = {
  /** The movement hint goes once the visitor has walked this far (m) from where the plate came up... */
  movedM: 0.6,
  /** ...or after this long (ms). */
  hintMs: 8000,
  /** The name card folds away this long (ms) after it came up, never before the hint went. */
  cardMs: 10000,
  /** sessionStorage key: the plate came up in this session. */
  seenKey: 'jardin.welcome',
} as const;

/** An owner gap in content: "[FILL]" or "[FILL: what is missing]". */
const GAP = /\[FILL\b/;

/** Splits text into sentences at ".", "!" or "?" followed by a space, never inside square brackets. */
export function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === '.' || ch === '!' || ch === '?') && (i + 1 === text.length || text[i + 1] === ' ')) {
      out.push(text.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const rest = text.slice(start).trim();
  if (rest !== '') out.push(rest);
  return out;
}

export const hasGap = (text: string): boolean => GAP.test(text);

/** The sentences that hold no owner gap, in order: a sentence shows by itself as soon as its gap is filled. */
export function gapFree(text: string): string {
  return sentencesOf(text).filter((s) => !hasGap(s)).join(' ');
}

/** The strings.json keys of the hint for this input and way through the garden: how to move, then where the work is. */
export function hintKeys(touch: boolean, roam: boolean): readonly [string, string] {
  const move = roam ? (touch ? 'welcome.touch' : 'welcome.keys') : touch ? 'welcome.railTouch' : 'welcome.railKeys';
  return [move, 'welcome.work'];
}
