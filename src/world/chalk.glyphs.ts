/**
 * The chalk hand's single-stroke letters (world/chalk.hand.ts draws them): every glyph is a few polylines on a small
 * grid, y up, the baseline at 2, the x-height at 6, capitals and ascenders at 9, descenders down to 0 and accents over
 * capitals up to 11. A stroke is its points' base-36 digits run together (x then y: "0229" is (0, 2) then (2, 9)); strokes apart by "|"; a
 * stroke that starts with "~" is a curve (rounded off by the hand), the rest are straight runs. Accented letters are
 * their base letter with an accent laid over its middle. No font files: this table is the whole alphabet.
 */

/** Grid units per glyph box: the baseline, the x-height and the cap height. */
export const GRID = { baseline: 2, xHeight: 6, cap: 9, top: 11 } as const;
/** Space between letters and the width of a space, in grid units. */
export const SPACING = { gap: 1.6, space: 3.4 } as const;

/** One stroke: points as x, y pairs in grid units, and whether the hand rounds it. */
export interface GlyphStroke { readonly pts: readonly number[]; readonly curve: boolean }
export interface Glyph { readonly strokes: readonly GlyphStroke[]; readonly width: number }

const TABLE_SRC =
  'A022942|1535;B0209|~093948463505|~053544433202;C~4839190704123243;'
  + 'D0209|~092947442202;E49090242|0535;F490902|0535;G~4839190704123243|434525;'
  + 'H0209|4249|0545;I2922|1939|1232;J~4944321203;K0209|490542;L090242;M0209254942;N02094249;'
  + 'O~190704123244473919;P0209|~093948463505;Q~190704123244473919|3351;'
  + 'R0209|~093948463505|2542;S~4839190716354443321203;T0949|2922;U~090412324449;V092249;'
  + 'W0912263249;X0942|4902;Y092549|2522;Z09490242;a~4536160503123244|4642;'
  + 'b0902|~052645432203;c~4536160503123243;d4942|~452605032243;e~04444536160503123243;'
  + 'f~38291812|0636;g~4536160504133344|~4641301001;h0902|~0416364542;i1612|1819;'
  + 'j~26211001|2829;k0902|360432;l~191322;m0602|~05162522|~25364542;n0602|~0516364542;'
  + 'o~160503123243453616;p0600|~0516364543321203;q4640|~4536160503123243;r0602|~041636;'
  + 's~453616052443321203;t~18132232|0636;u~0603123244|4642;v062246;w0612253246;x0642|4602;'
  + 'y~0603123244|~4641301001;z06460242;0~190704123244473919;1172922|1232;'
  + '2~071939484602|0242;3~08193948463515|~354443321203;4390444|3732;'
  + '5490906|~06364543321203;6~382919070412324445361605;7094922;'
  + '8~3919080716354443321203041536474839;9~473616070819394844321203;-0535;.0203;,1301;'
  + ':0506|0203;/0239;+0545|2723;?~07193948462524|2122;!1914|1213;¿~44321203052627|2829;'
  + '¡1217|1819;→0585|638567;←8505|230527;↑2229|072947;↓2922|042244;↗0268|386865;↖6208|380805;'
  + '⟶~04356595c5|a7c5a3;⤳~0526456485a6c5|a7c5a3;';
/** The table by character: each entry of TABLE_SRC is its character followed by its strokes. */
const TABLE = new Map(TABLE_SRC.split(';').filter((e) => e !== '').map((e) => [e[0]!, e.slice(1)] as const));

/**
 * Accents in the same grid, two units left of the letter's middle (so x 2 is the middle), for lowercase and capitals.
 */
const ACCENTS = {
  acute: ['1738', '1a3b'],
  tilde: ['~07183748', '~0a1b3a4b'],
  dieresis: ['1718|3738', '1a1b|3a3b'],
} as const;
/** Spanish letters as base and accent; the accented i drops its dot. */
const COMPOSED: Readonly<Record<string, readonly [string, keyof typeof ACCENTS]>> = {
  á: ['a', 'acute'], é: ['e', 'acute'], í: ['ı', 'acute'], ó: ['o', 'acute'], ú: ['u', 'acute'], ñ: ['n', 'tilde'], ü: ['u', 'dieresis'],
  Á: ['A', 'acute'], É: ['E', 'acute'], Í: ['I', 'acute'], Ó: ['O', 'acute'], Ú: ['U', 'acute'], Ñ: ['N', 'tilde'], Ü: ['U', 'dieresis'],
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
    const over = parse(ACCENTS[accent][letter === letter.toUpperCase() ? 1 : 0]).strokes
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
