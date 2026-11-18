/**
 * Paint order bases (the cutout material has no depth): the overview atlas under every bed, the grotto under its host
 * so the ivy covers it; `near` is the ground dressing in front of every bed (world/dressing.ts).
 */
export const RENDER_ORDER = { overview: -1, hidden: 0, bed: 100, near: 600 } as const;
