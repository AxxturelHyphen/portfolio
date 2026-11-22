/**
 * The free-roam peacock's upright neck and head. The plate shows the bird preening with its head turned into its
 * shoulder, which reads as a headless torso at game distance, so a real neck and head stand on it: geometry drawn with
 * the garden's solids (gl/peacock.head.ts), placed by the Estanque behaviour each time it places the bird, so the head
 * follows the body through the wait, the boss's grow and turn and the end pose. `draw` is null until the solids are
 * placed (free roam only); a size of 0 hides the head.
 */
export type HeadDraw = (x: number, y: number, z: number, size: number, yaw: number, tint: ArrayLike<number>) => void;

export const peacockHead: { draw: HeadDraw | null } = { draw: null };
