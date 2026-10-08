import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite configuration.
 *
 * Note: this file imports `defineConfig` from 'vite', NOT from 'vitest/config'.
 * Mixing the two pulls Vite's plugin types in through two different module
 * paths, which produces a confusing "Plugin is not assignable to PluginOption"
 * error during `tsc --noEmit`.
 *
 * Vitest needs no configuration here. Its default test discovery pattern
 * already picks up `tests/*.test.ts`, and the default `node` environment is
 * correct for the compiler tests, which are pure TypeScript with no DOM.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
