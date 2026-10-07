/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import { normalizeBasePath } from './server/base-path.ts';
import { jevPlugin } from './server/plugin.ts';

/** Where the site is published, for share links and social-card meta tags (VITE_PUBLIC_URL overrides it). */
const DEFAULT_PUBLIC_URL = 'https://jevman.apps.chadda.se';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['OPPER_', 'SESSION_', 'JEV_', 'TYPESAFE_', 'APP_', 'PUBLIC_', 'TRUST_']);
  // APP_BASE_PATH (e.g. /jevman-benchmark) serves the whole app below that prefix; empty serves it at the root.
  const basePath = normalizeBasePath(env.APP_BASE_PATH);
  const publicUrl = (loadEnv(mode, process.cwd(), 'VITE_').VITE_PUBLIC_URL || DEFAULT_PUBLIC_URL).replace(/\/+$/, '');
  return {
    base: `${basePath}/`,
    // Also replaced in index.html and leaderboard.html as %VITE_PUBLIC_URL% and %VITE_APP_URL%.
    define: {
      'import.meta.env.VITE_PUBLIC_URL': JSON.stringify(publicUrl),
      /** The app's public address with a trailing slash, e.g. https://opper.ai/jevman-benchmark/. */
      'import.meta.env.VITE_APP_URL': JSON.stringify(`${publicUrl}${basePath}/`),
    },
    plugins: [jevPlugin(env)],
    build: { rollupOptions: { input: { main: 'index.html', leaderboard: 'leaderboard.html' } } },
    // Some tests replay whole games, which can take several seconds on a busy CI runner.
    test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
  };
});
