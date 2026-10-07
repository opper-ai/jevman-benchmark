// Serving jevman below a path prefix (APP_BASE_PATH), e.g. https://opper.ai/jevman-benchmark/.
// The proxies in front forward the full path, so the server removes the prefix itself.

/**
 * APP_BASE_PATH normalised: '' (served at the root, the default) or `/segment[/segment…]` without a trailing slash.
 * Throws for anything that is not a plain path, so a typo fails at startup instead of serving nothing.
 */
export function normalizeBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const segments = path.split('/').slice(1);
  if (!segments.every((s) => /^[A-Za-z0-9._~-]+$/.test(s) && s !== '.' && s !== '..')) {
    throw new Error(`APP_BASE_PATH must be a path like /jevman-benchmark, got ${JSON.stringify(raw)}`);
  }
  return path;
}

export type Mounted =
  /** Below the prefix: `url` is the request URL with the prefix removed (always starts with '/'). */
  | { kind: 'inside'; url: string }
  /** Exactly the prefix (`/jevman-benchmark`, maybe with a query): redirect to `location`, the same with a slash. */
  | { kind: 'bare'; location: string }
  /** Anywhere else on the host. */
  | { kind: 'outside' };

/** Where a request URL falls relative to the base path. With no base path everything is inside, unchanged. */
export function mountedUrl(url: string, base: string): Mounted {
  if (!base) return { kind: 'inside', url };
  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  const query = q === -1 ? '' : url.slice(q);
  if (path === base) return { kind: 'bare', location: `${base}/${query}` };
  if (path.startsWith(`${base}/`)) return { kind: 'inside', url: url.slice(base.length) };
  return { kind: 'outside' };
}

type Next = () => void;
type Handler<Req extends { url?: string }, Res> = (req: Req, res: Res, next: Next) => void;

/**
 * Connect-style mount, for the Vite dev and preview servers: the handler sees URLs without the prefix and requests
 * outside it skip the handler. `req.url` is restored before `next()`, so Vite's own middlewares see the full URL.
 */
export function mountAt<Req extends { url?: string }, Res>(base: string, handler: Handler<Req, Res>): Handler<Req, Res> {
  if (!base) return handler;
  return (req, res, next) => {
    const original = req.url ?? '/';
    const m = mountedUrl(original, base);
    if (m.kind !== 'inside') return next();
    req.url = m.url;
    handler(req, res, () => {
      req.url = original;
      next();
    });
  };
}
