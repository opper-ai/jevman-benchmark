import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { mountedUrl, normalizeBasePath } from './base-path.ts';
import { createJevMiddleware } from './routes.ts';

export type Log = (event: string, details?: Record<string, unknown>) => void;

export interface AppOptions {
  env: Record<string, string | undefined>;
  /** The `vite build` output. */
  distDir: string;
  /** The deployed Git commit (SOURCE_COMMIT, set at image build time). */
  commit: string;
  log?: Log;
  /** How long to keep serving after SIGTERM while health checks and the load balancer withdraw this container. */
  drainMs?: number;
  /** Hard limit from SIGTERM to exit; below ECS's 30 s stopTimeout, so the process exits before SIGKILL. */
  deadlineMs?: number;
}

export interface App {
  listen(port: number, host?: string): Promise<number>;
  /** Withdraw readiness, keep serving for `drainMs`, then close and wait for in-flight requests. */
  shutdown(): Promise<'clean' | 'deadline'>;
  /** Immediate close, for tests. */
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/** After SIGTERM: keep serving this long so the load balancer stops sending traffic, then wait for open requests. */
export const SHUTDOWN_DRAIN_MS = 5000;
/** Then give up on open requests, inside ECS's 30 s stopTimeout. */
export const SHUTDOWN_DEADLINE_MS = 25_000;

/**
 * The jevman production server: static build, Login with Opper, the jev proxy, /health and /revision.
 * With APP_BASE_PATH (e.g. /jevman-benchmark) all of it lives below that prefix, the prefix itself redirects to
 * `prefix/`, anything else is 404, and /health also answers at the root for load balancer health checks.
 */
export function createApp(opts: AppOptions): App {
  const log: Log = opts.log ?? ((event, details = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details })));
  const drainMs = opts.drainMs ?? SHUTDOWN_DRAIN_MS;
  const deadlineMs = opts.deadlineMs ?? SHUTDOWN_DEADLINE_MS;
  const root = resolve(opts.distDir);
  const basePath = normalizeBasePath(opts.env.APP_BASE_PATH);
  const env = Object.fromEntries(Object.entries(opts.env).filter((e): e is [string, string] => typeof e[1] === 'string'));
  // Throws for an https deployment without a real SESSION_SECRET, before anything listens.
  const jev = createJevMiddleware(env, {
    info: (msg) => log('jev', { msg }),
    warn: (msg) => log('warn', { msg }),
    error: (msg) => log('error', { msg }),
  });
  let ready = false;
  let draining = false;
  let shutdownPromise: Promise<'clean' | 'deadline'> | null = null;

  const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    res.end(JSON.stringify(body));
  };

  async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS });
      res.end();
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://jevman').pathname);
    } catch {
      return notFound(res);
    }
    if (path.endsWith('/')) path += 'index.html';
    else if (!extname(path)) path += '.html'; // clean URLs: /leaderboard serves leaderboard.html
    const file = resolve(join(root, path));
    if (!file.startsWith(root + sep)) return notFound(res);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return notFound(res);
    const hashed = path.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).pipe(res);
  }

  function notFound(res: http.ServerResponse): void {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Not found');
  }

  const server = http.createServer((req, res) => {
    const mounted = mountedUrl(req.url ?? '/', basePath);
    if (mounted.kind === 'bare') {
      res.writeHead(308, { Location: mounted.location, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
      res.end();
      return;
    }
    // Outside the base path only /health answers (the load balancer may check either one).
    if (mounted.kind === 'outside' && (req.url ?? '/').split('?')[0] !== '/health') return notFound(res);
    if (mounted.kind === 'inside') req.url = mounted.url;
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/health') {
      const healthy = ready && !draining;
      res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end(healthy ? 'ready' : 'not ready');
      return;
    }
    if (path === '/revision') return sendJson(res, 200, { app: 'jevman', commit: opts.commit, draining });
    jev(req, res, () => {
      serveStatic(req, res).catch((err) => {
        log('error', { msg: `static: ${(err as Error)?.message ?? String(err)}` });
        if (!res.headersSent) notFound(res);
        else res.destroy();
      });
    });
  });

  return {
    listen(port, host = '0.0.0.0') {
      return new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(port, host, () => {
          const actual = (server.address() as AddressInfo).port;
          log('listening', { port: actual, commit: opts.commit, ...(basePath ? { basePath } : {}) });
          ready = true;
          log('ready');
          done(actual);
        });
      });
    },
    shutdown() {
      shutdownPromise ??= new Promise((done) => {
        draining = true;
        log('draining', { drainMs, deadlineMs });
        const deadline = setTimeout(() => {
          log('shutdown-deadline');
          done('deadline');
        }, deadlineMs);
        deadline.unref();
        setTimeout(() => {
          log('listener-close');
          server.close(() => {
            clearTimeout(deadline);
            log('shutdown-complete');
            done('clean');
          });
          server.closeIdleConnections();
        }, drainMs);
      });
      return shutdownPromise;
    },
    close() {
      return new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
        if (!server.listening) done();
      });
    },
  };
}
