import type { Lang, Strings } from '../types.ts';

/**
 * Words of the diegetic UI that content/strings.json does not carry yet (cook/ART.md section 4). Content strings win
 * when they hold the same key, so moving a key into strings.json needs no code change here.
 */
const COPY: Strings = {
  en: {
    'mode.exit': 'Exit',
    'mode.exitLabel': 'Exit to the CV album',
    'mode.exitHint': 'To the CV album',
    'plan.tag': 'Plan',
    'cv.short': 'CV',
    'plan.title': 'Plan of the garden',
    'sign.go': 'Go to',
    'sign.cv': 'To the CV',
  },
  es: {
    'mode.exit': 'Salir',
    'mode.exitLabel': 'Salir al álbum del CV',
    'mode.exitHint': 'Al álbum del CV',
    'plan.tag': 'Plano',
    'cv.short': 'CV',
    'plan.title': 'Plano del jardín',
    'sign.go': 'Ir a',
    'sign.cv': 'Al CV',
  },
};

export function uiText(strings: Strings | null, lang: Lang, key: string): string {
  return strings?.[lang][key] ?? COPY[lang][key] ?? key;
}
