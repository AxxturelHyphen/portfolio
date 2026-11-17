import { UI } from '../core/motion.ts';

/**
 * Writes the CSS timing tokens from src/core/motion.ts (cook/MOTION.md section D), so CSS-driven transitions
 * (Herbario panel, hover, notes) use the same numbers as the channel-driven ones. base.css holds equal fallbacks
 * for the no-JS page. EASE_OUT is cubic-bezier(0.27, 0.82, 0.62, 1) in motion.ts.
 */
export function applyMotionTokens(root: HTMLElement): void {
  const s = root.style;
  s.setProperty('--ease-out', 'cubic-bezier(0.27, 0.82, 0.62, 1)');
  s.setProperty('--dur-ui', `${UI.panelOpenS}s`);
  s.setProperty('--dur-ui-exit', `${UI.panelCloseS}s`);
  s.setProperty('--dur-hover', `${UI.hoverS}s`);
}
