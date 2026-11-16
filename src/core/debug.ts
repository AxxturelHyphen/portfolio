import type { DebugParams } from '../types.ts';

/** URL debug params of spec section 11. Unknown or malformed values are dropped, never an error. */
export function parseDebug(search: URLSearchParams): DebugParams {
  const q: DebugParams = {};
  const mode = search.get('mode');
  if (mode === 'garden' || mode === 'herbario') q.mode = mode;
  const shot = search.get('shot');
  if (shot !== null && /^S\d\d$/.test(shot)) q.shot = shot;
  const t = Number.parseFloat(search.get('t') ?? '');
  if (Number.isFinite(t) && t >= 0) q.t = t;
  const tier = search.get('tier');
  if (tier === 'high' || tier === 'mid' || tier === 'low') q.tier = tier;
  const lang = search.get('lang');
  if (lang === 'en' || lang === 'es') q.lang = lang;
  for (const key of ['film', 'stats', 'bench'] as const) {
    const v = search.get(key);
    if (v === '0' || v === '1') q[key] = v === '1' ? 1 : 0;
  }
  return q;
}
