/// <reference types="node" />
// GPU-backed Chromium launch options, shared by the e2e config and the scripts (stills, perf, budgets).
// Headless with GPU flags by default (owner rule 2026-11-17: Hyprland tiles and resizes headed windows, so headed runs
// get cropped or mis-sized; every run sets an explicit viewport). JARDIN_HEADED=1 opts into headed, and then the
// caller must assert innerWidth and innerHeight equal the intended viewport before capturing.

export type GpuMode = 'headed' | 'headless-gpu-flags';

export interface GpuLaunch {
  mode: GpuMode;
  headless: boolean;
  args: string[];
}

/** Flags that keep WebGL2 on the hardware GPU through ANGLE/GL in headless (checked on the RTX 3060 dev machine). */
const GPU_FLAGS = ['--ignore-gpu-blocklist', '--enable-gpu', '--use-gl=angle', '--use-angle=gl', '--enable-gpu-rasterization'];

export function hasDisplay(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env['DISPLAY'] ?? env['WAYLAND_DISPLAY']);
}

export function gpuLaunch(env: NodeJS.ProcessEnv = process.env): GpuLaunch {
  const headed = env['JARDIN_HEADED'] === '1' && env['JARDIN_HEADLESS'] !== '1' && hasDisplay(env);
  return headed
    ? { mode: 'headed', headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] }
    : { mode: 'headless-gpu-flags', headless: true, args: GPU_FLAGS };
}
