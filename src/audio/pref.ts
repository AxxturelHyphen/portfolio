/**
 * The visitor's sound choice, remembered across visits. On unless they turned it off; storage blocked keeps it for
 * this visit only. The sound tag (ui/toggles.ts) writes it and announces the change with SOUND_EVENT on window
 * (detail: on); the garden's sound control (audio/control.ts) follows that event.
 */

const KEY = 'jardin.sound';
export const SOUND_EVENT = 'jardin:sound';

let fallback = true;

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return fallback;
  }
}

export function setSoundOn(on: boolean): void {
  fallback = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: the choice holds for this visit.
  }
}
