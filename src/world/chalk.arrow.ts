/**
 * The cat note's arrow (world/chalk.hand.ts inks it after the word): a long hand-drawn swoop from the end of the word,
 * round a big loop-the-loop over the word's end and a smaller one further on, then down onto the cat in a zigzag, with
 * two barbs at the tip; the hand rounds the shaft off and jitters it like any stroke. In the glyph grid (y up, the
 * word's baseline at 2) for a word `wordW` wide; `side` -1 keeps the word on the left of the tip, +1 on its right (the
 * arrow then mirrors about the word).
 */

/**
 * The strokes as in world/chalk.glyphs.ts (base-36 digit pairs, strokes apart by "|", "~" a rounded one), x from the
 * word's end plus ARROW_X0 and y plus ARROW_Y0, so the tip can hang well under the baseline. The shaft ends at the tip.
 */
const ARROW_SRC = '~3j6k8m8p6r3r1p2m5l9lckfigffdcdbfdhfggdfbcag8c7f5f2|c5f2|f2i4';
const ARROW_X0 = 2;
const ARROW_Y0 = 14;

export interface ArrowStroke { readonly pts: number[]; readonly curve: boolean }
export interface Arrow { readonly strokes: ArrowStroke[]; readonly tip: readonly [number, number] }

export function arrowAfter(wordW: number, side: -1 | 1): Arrow {
  const strokes = ARROW_SRC.split('|').map((src) => {
    const curve = src.startsWith('~');
    const pts: number[] = [];
    for (const c of curve ? src.slice(1) : src) {
      const v = parseInt(c, 36);
      if (pts.length % 2 === 1) pts.push(v - ARROW_Y0);
      else pts.push(side === 1 ? ARROW_X0 - v : wordW + v - ARROW_X0);
    }
    return { pts, curve };
  });
  const shaft = strokes[0]!.pts;
  return { strokes, tip: [shaft[shaft.length - 2]!, shaft[shaft.length - 1]!] };
}
