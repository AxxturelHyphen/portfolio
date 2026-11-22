/**
 * The chalk hand's single-stroke letters (world/chalk.hand.ts draws them): every glyph is a few polylines on a small
 * grid, y up, the baseline at 2, the x-height at 6, ascenders at 9, descenders down to 0 and the arrows' tips at 10.
 * A stroke is its points' base-36 digits run together (x then y: "0229" is (0, 2) then (2, 9)); strokes apart by "|";
 * a stroke that starts with "~" is a curve (rounded off by the hand), the rest are straight runs. Accented letters are
 * their base letter with an accent laid over its middle. No font files: the lowercase alphabet, the Spanish letters and
 * two arrows are all the chalk writes.
 */

/** Grid units per glyph box: the baseline, the x-height and the ascender height. */
export const GRID = { baseline: 2, xHeight: 6, cap: 9 } as const;
/** Space between letters and the width of a space, in grid units. */
export const SPACING = { gap: 1.6, space: 3.4 } as const;

/** One stroke: points as x, y pairs in grid units, and whether the hand rounds it. */
export interface GlyphStroke { readonly pts: readonly number[]; readonly curve: boolean }
export interface Glyph { readonly strokes: readonly GlyphStroke[]; readonly width: number }

const TABLE_SRC =
  'a~4536160503123244|4642;b0902|~052645432203;c~4536160503123243;d4942|~452605032243;'
  + 'e~04444536160503123243;f~38291812|0636;g~4536160504133344|~4641301001;h0902|~0416364542;i1612|1819;'
  + 'j~26211001|2829;k0902|360432;l~191322;m0602|~05162522|~25364542;n0602|~0516364542;'
  + 'o~160503123243453616;p0600|~0516364543321203;q4640|~4536160503123243;r0602|~041636;'
  + 's~453616052443321203;t~18132232|0636;u~0603123244|4642;v062246;w0612253246;x0642|4602;'
  + 'y~0603123244|~4641301001;z06460242;↑~2114272a|082a48;↓~2a172421|032143;';
/** The table by character: each entry of TABLE_SRC is its character followed by its strokes. */
const TABLE = new Map(TABLE_SRC.split(';').filter((e) => e !== '').map((e) => [e[0]!, e.slice(1)] as const));

/** Accents in the same grid over the x-height, two units left of the letter's middle (so x 2 is the middle). */
const ACCENTS = { acute: '1738', tilde: '~07183748', dieresis: '1718|3738' } as const;
/** Spanish letters as base and accent; the accented i drops its dot. */
const COMPOSED: Readonly<Record<string, readonly [string, keyof typeof ACCENTS]>> = {
  á: ['a', 'acute'], é: ['e', 'acute'], í: ['ı', 'acute'], ó: ['o', 'acute'], ú: ['u', 'acute'], ñ: ['n', 'tilde'], ü: ['u', 'dieresis'],
};
const DOTLESS_I = '1612';

function parseStroke(src: string): GlyphStroke {
  const curve = src.startsWith('~');
  const pts: number[] = [];
  for (const c of curve ? src.slice(1) : src) pts.push(parseInt(c, 36));
  return { pts, curve };
}

function widthOf(strokes: readonly GlyphStroke[]): number {
  let w = 0;
  for (const s of strokes) for (let i = 0; i < s.pts.length; i += 2) w = Math.max(w, s.pts[i]!);
  return w;
}

function parse(src: string): Glyph {
  const strokes = src.split('|').map(parseStroke);
  return { strokes, width: widthOf(strokes) };
}

const cache = new Map<string, Glyph | null>();

/** The glyph for one character, or null for a space or a character the hand does not know. */
export function glyphOf(ch: string): Glyph | null {
  const hit = cache.get(ch);
  if (hit !== undefined) return hit;
  let g: Glyph | null = null;
  const parts = COMPOSED[ch];
  const own = TABLE.get(ch);
  if (parts !== undefined) {
    const [letter, accent] = parts;
    const base = parse(letter === 'ı' ? DOTLESS_I : TABLE.get(letter)!);
    const shift = base.width / 2 - 2;
    const over = parse(ACCENTS[accent]).strokes
      .map((s) => ({ curve: s.curve, pts: s.pts.map((v, i) => (i % 2 === 0 ? v + shift : v)) }));
    g = { strokes: [...base.strokes, ...over], width: base.width };
  } else if (own !== undefined) {
    g = parse(own);
  }
  cache.set(ch, g);
  return g;
}

/** Every character the hand can write, for the tests. */
export const KNOWN = [...TABLE.keys(), ...Object.keys(COMPOSED)];
