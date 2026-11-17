import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Dev server for the gl-cutout test page (sources from src/gl, film pass included).
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  server: { fs: { allow: [here('../../..')] } },
});
