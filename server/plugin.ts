import type { Plugin } from 'vite';
import { mountAt, normalizeBasePath } from './base-path.ts';
import { createJevMiddleware } from './routes.ts';

/** The production server's clean URL for the leaderboard page (`base` is APP_BASE_PATH, '' at the root). */
export function cleanUrls(req: { url?: string }, _res: unknown, next: () => void, base = ''): void {
  if (req.url?.split('?')[0] === `${base}/leaderboard`) req.url = req.url.replace(`${base}/leaderboard`, `${base}/leaderboard.html`);
  next();
}

/** Mounts the jev routes (Login with Opper, /api/me, /api/decide) on the Vite dev and preview servers, below APP_BASE_PATH. */
export function jevPlugin(env: Record<string, string>, opts: { quiet?: boolean } = {}): Plugin {
  const base = normalizeBasePath(env.APP_BASE_PATH);
  const clean = (req: { url?: string }, res: unknown, next: () => void) => cleanUrls(req, res, next, base);
  return {
    name: 'jev-decide',
    configureServer(server) {
      server.middlewares.use(mountAt(base, createJevMiddleware(env, server.config.logger, opts)));
      server.middlewares.use(clean);
    },
    configurePreviewServer(server) {
      server.middlewares.use(mountAt(base, createJevMiddleware(env, server.config.logger, opts)));
      server.middlewares.use(clean);
    },
  };
}
