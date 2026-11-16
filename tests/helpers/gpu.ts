/// <reference types="node" />
// GPU-backed Chromium launch options, shared by the e2e config and the scripts (stills, perf, budgets).
// Headed on the dev machine when a display exists (real GPU, real compositor), else headless with GPU flags.
// JARDIN_HEADLESS=1 forces the headless path; JARDIN_HEADED=1 forces headed.

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
  const forceHeadless = env['JARDIN_HEADLESS'] === '1';
  const forceHeaded = env['JARDIN_HEADED'] === '1';
  const headed = forceHeaded || (!forceHeadless && hasDisplay(env));
  return headed
    ? { mode: 'headed', headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] }
    : { mode: 'headless-gpu-flags', headless: true, args: GPU_FLAGS };
}
