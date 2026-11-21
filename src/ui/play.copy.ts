import type { Lang, Strings } from '../types.ts';

/**
 * Words of the lantern round and the play controls (ui/play.ts, ui/help.ts), kept in the garden chunk. Content
 * strings win when they hold the same key. `{n}`, `{total}` and `{bed}` are filled by playText.
 */
const PLAY: Strings = {
  en: {
    'play.hud': 'Lantern round',
    'play.lit': '{n} / {total} flowers lit',
    'play.allLit': 'All flowers lit: to the Salida',
    'play.bedDone': '{bed}: every flower lit',
    'play.help': 'How to play',
    'play.keys1': 'Walk with WASD or the arrows, hold Shift to hurry, or click the ground.',
    'play.keys2': 'Q and E turn the view. Near a flower, press Enter or Space to open it.',
    'play.touch1': 'Drag a thumb at the lower left to walk, or tap the ground.',
    'play.touch2': 'Two fingers turn and zoom. Near a flower, press Open.',
    'play.goal': 'Light every flower by visiting its project.',
    'play.gotIt': 'Got it',
    'play.home': 'Back to the gate',
    'play.restart': 'Start over',
    'play.open': 'Open',
    'play.doneTitle': 'The garden is lit',
    'play.doneLine': 'You have visited every project. The Salida gate is open whenever you are ready.',
    'play.toSalida': 'Walk to the Salida',
    'play.close': 'Close',
  },
  es: {
    'play.hud': 'Ronda del farol',
    'play.lit': '{n} / {total} flores encendidas',
    'play.allLit': 'Todas encendidas: a la Salida',
    'play.bedDone': '{bed}: todas sus flores encendidas',
    'play.help': 'Cómo jugar',
    'play.keys1': 'Camina con WASD o las flechas, mantén Shift para ir deprisa, o haz clic en el suelo.',
    'play.keys2': 'Q y E giran la vista. Junto a una flor, pulsa Intro o Espacio para abrirla.',
    'play.touch1': 'Arrastra el pulgar abajo a la izquierda para caminar, o toca el suelo.',
    'play.touch2': 'Dos dedos giran y acercan la vista. Junto a una flor, pulsa Abrir.',
    'play.goal': 'Enciende cada flor visitando su proyecto.',
    'play.gotIt': 'Entendido',
    'play.home': 'Volver a la puerta',
    'play.restart': 'Empezar de nuevo',
    'play.open': 'Abrir',
    'play.doneTitle': 'El jardín está encendido',
    'play.doneLine': 'Has visitado todos los proyectos. La puerta de la Salida está abierta cuando quieras.',
    'play.toSalida': 'Ir a la Salida',
    'play.close': 'Cerrar',
  },
};

export function playText(strings: Strings | null, lang: Lang, key: string, fill: Readonly<Record<string, string | number>> = {}): string {
  const raw = strings?.[lang][key] ?? PLAY[lang][key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in fill ? String(fill[k]) : m));
}
