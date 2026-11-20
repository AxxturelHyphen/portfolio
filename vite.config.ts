import { defineConfig } from 'vite';
import { creditsSlim } from './scripts/credits.slim.ts';
import { glslMinify } from './scripts/glsl.ts';
import { prerender } from './scripts/prerender.ts';

/**
 * Relative base so the build runs from any path. three gets its own chunk (excluded from the app JS budget).
 * public/ is copied verbatim: atlases (.ktx2), the vendored Basis transcoder (public/basis/*.js, *.wasm), fonts, audio.
 * They are fetched at runtime by URL, never imported, so Vite neither hashes nor inlines them. Shaders ship minified
 * and packed (scripts/glsl.ts); the credits ship only the fields their view prints (scripts/credits.slim.ts). No
 * modulepreload polyfill: browsers without <link rel=modulepreload> still load every chunk, only without the preload.
 */
export default defineConfig({
  base: './',
  publicDir: 'public',
  plugins: [prerender(), glslMinify(), creditsSlim()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 800,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
});
