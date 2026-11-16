import { defineConfig } from 'vite';
import { prerender } from './scripts/prerender.ts';

export default defineConfig({
  base: './',
  plugins: [prerender()],
  build: {
    target: 'es2022',
  },
});
