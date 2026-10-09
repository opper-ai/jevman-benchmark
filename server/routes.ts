import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { crossSite, handleCallback, handleLogin, handleLogout, handleMe, json, loginConfigured, opperExchange, redirect, sessionFrom, type AuthConfig, type HttpRequest, type HttpResponse } from './auth.ts';
import { normalizeBasePath } from './base-path.ts';
import { handleDecideRequest, poolLimitRequest, rejectDecideRequest, resolveKey, type PoolAccess } from './decide.ts';
import { devTargetFromEnv, type JevTarget } from './jev.ts';
import { answerVerifier } from './answers.ts';
import { accountHash, cleanInitials, HighScores, highScoresStore, visitorHash } from './highscores.ts';
import { clientIp, MAX_POOL_BODY_BYTES, poolFromEnv, trustedProxiesFromEnv, visitorKey, VisitorLimits } from './pool.ts';
import { BOARD_KEYS } from '../shared/lineups.ts';

/** Largest /api/decide body read; a game state plus five questions is a few KB. */
export const MAX_BODY_BYTES = 256 * 1024;
/** Largest high-score entry read: a half-hour game's recording (its steering and the ghosts' signed answers). */
export const MAX_SCORE_BODY_BYTES = 1536 * 1024;
/** Entries one account (or, signed out, one address) may send an hour. */
const SCORE_ENTRIES_PER_HOUR = 20;

/** The high-score check (src/player-check.ts): loaded through Vite in development, from the server bundle in production. */
export type PlayerCheck = (recording: unknown, verify: (message: string, sig: string) => boolean) => { ok: true; score: number; board: string | null } | { ok: false; error: string };
const MAX_LOG_CHARS = 300;

export interface RouteLogger {
  info(msg: string, opts?: { timestamp?: boolean }): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

/** PUBLIC_BASE_URL as a bare origin (`https://opper.ai`), or undefined when unset. */
function publicOriginFromEnv(env: Record<string, string>): string | undefined {
  const raw = env.PUBLIC_BASE_URL?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`[auth] PUBLIC_BASE_URL must be an origin like https://opper.ai, got ${JSON.stringify(raw)}`);
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.pathname.replace(/\/+$/, '') || url.search || url.hash) {
    throw new Error(`[auth] PUBLIC_BASE_URL must be an origin like https://opper.ai (the path goes in APP_BASE_PATH), got ${JSON.stringify(raw)}`);
  }
  return url.origin;
}

/**
 * Login with Opper's redirect URI: OPPER_OAUTH_REDIRECT_URI, else OPPER_REDIRECT_URI, else built from
 * PUBLIC_BASE_URL + APP_BASE_PATH, else the Vite dev server's.
 */
export function redirectUriFromEnv(env: Record<string, string>, basePath = normalizeBasePath(env.APP_BASE_PATH)): string {
  const explicit = env.OPPER_OAUTH_REDIRECT_URI?.trim() || env.OPPER_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return `${publicOriginFromEnv(env) ?? 'http://localhost:5173'}${basePath}/auth/callback`;
}

/** Auth settings from the environment. An https redirect URI means a deployment, which needs a real SESSION_SECRET. */
export function authConfigFromEnv(env: Record<string, string>, warn: (msg: string) => void): AuthConfig {
  const clientId = env.OPPER_CLIENT_ID || undefined;
  const clientSecret = env.OPPER_CLIENT_SECRET || undefined;
  const basePath = normalizeBasePath(env.APP_BASE_PATH);
  const publicOrigin = publicOriginFromEnv(env);
  const redirectUri = redirectUriFromEnv(env, basePath);
  // A production image (NODE_ENV=production) is a deployment: without an https redirect URI (PUBLIC_BASE_URL or
  // OPPER_OAUTH_REDIRECT_URI unset) it would run with a localhost callback, insecure cookies and a server key that
  // pays for every visitor, so refuse to start. JEVMAN_ALLOW_HTTP=1 opts out (a production build tried locally).
  if (env.NODE_ENV === 'production' && !redirectUri.startsWith('https:') && env.JEVMAN_ALLOW_HTTP !== '1') {
    throw new Error('[auth] In production, set PUBLIC_BASE_URL (or OPPER_OAUTH_REDIRECT_URI) to the https address the app is served at; JEVMAN_ALLOW_HTTP=1 opts out');
  }
  let sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) {
    if (redirectUri.startsWith('https:')) throw new Error('[auth] SESSION_SECRET must be set to at least 32 characters when the redirect URI is https');
    if (clientId && clientSecret) warn('[auth] SESSION_SECRET is missing or shorter than 32 characters — using a random one; sign-ins reset on restart');
    sessionSecret = randomBytes(32).toString('hex');
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    opperUrl: env.OPPER_BASE_URL || 'https://api.opper.ai',
    sessionSecret,
    basePath,
    ...(publicOrigin ? { publicOrigin } : {}),
  };
}

/**
 * The server's own key (TYPESAFE_API_KEY, else OPPER_API_KEY), unless this is a deployment (https redirect URI),
 * where it would pay for every visitor.
 */
export function devKeyFromEnv(env: Record<string, string>, cfg: AuthConfig, warn: (msg: string) => void): JevTarget | undefined {
  const target = devTargetFromEnv(env);
  if (!target || !cfg.redirectUri.startsWith('https:')) return target;
  const name = target.provider === 'typesafe' ? 'TYPESAFE_API_KEY' : 'OPPER_API_KEY';
  if (env.JEV_ALLOW_DEV_KEY !== '1') {
    warn(`[jev] ${name} is ignored because the redirect URI is https — a deployed site must not pay for visitors with a server key. Set JEV_ALLOW_DEV_KEY=1 to use it anyway.`);
    return undefined;
  }
  warn(`[jev] JEV_ALLOW_DEV_KEY=1: ${name} pays for every signed-out visitor of this https deployment`);
  return target;
}

const toHttp = (req: IncomingMessage): HttpRequest => ({ method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, remoteAddress: req.socket?.remoteAddress });

function send(res: ServerResponse, r: HttpResponse): void {
  res.statusCode = r.status;
  for (const [k, v] of Object.entries(r.headers)) if (!(Array.isArray(v) && v.length === 0)) res.setHeader(k, v);
  res.end(r.body);
}

/** Last resort when writing a response failed: end it so the request never hangs. */
function abort(res: ServerResponse): void {
  if (!res.headersSent) res.statusCode = 500;
  res.end();
}

/** The request body as UTF-8, or null once it grows past `limit` bytes. */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer | string) => {
      if (over) return;
      const b = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += b.length;
      if (size > limit) {
        over = true;
        resolve(null);
      } else chunks.push(b);
    });
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

/** The free credits, when OPPER_POOL_API_KEY is set: signed-out visitors play on it until its balance runs out. */
export function poolAccessFromEnv(env: Record<string, string>, cfg: AuthConfig, log: (msg: string) => void): PoolAccess | undefined {
  const pool = poolFromEnv(env, cfg.opperUrl, log);
  return pool ? { pool, limits: new VisitorLimits(), trustedProxies: trustedProxiesFromEnv(env) } : undefined;
}

/**
 * Connect-style middleware for Login with Opper, the account endpoint and the jev proxy, for the Vite dev and
 * preview servers (or any Node HTTP server). The player, pool and dev keys never leave the server.
 */
export function createJevMiddleware(env: Record<string, string>, logger: RouteLogger, opts: { quiet?: boolean; poolAccess?: PoolAccess | null; loadPlayerCheck?: () => Promise<PlayerCheck>; highScores?: HighScores } = {}): Middleware {
  const cfg = authConfigFromEnv(env, (m) => logger.warn(m));
  const devKey = devKeyFromEnv(env, cfg, (m) => logger.warn(m));
  const access = opts.poolAccess === undefined ? poolAccessFromEnv(env, cfg, (m) => logger.warn(m)) : (opts.poolAccess ?? undefined);
  if (access && !opts.quiet) logger.info('[pool] free credits on: signed-out visitors play on OPPER_POOL_API_KEY until its balance runs out');
  if (!devKey && !access && !loginConfigured(cfg) && !opts.quiet) logger.warn('[jev] none of TYPESAFE_API_KEY, OPPER_API_KEY, OPPER_POOL_API_KEY or OPPER_CLIENT_ID/SECRET is set — jev cannot play');
  const redactSecrets = (s: string) => [cfg.clientSecret, devKey?.apiKey, access?.pool.apiKey].reduce<string>((acc, k) => (k ? acc.split(k).join('[redacted]') : acc), s);
  const baseExchange = opperExchange(cfg);
  // handleCallback maps any failure to /?auth_error=exchange; log why (message only, redacted, capped) so a misconfigured app is diagnosable.
  const exchange: typeof baseExchange = async (code) => {
    try {
      return await baseExchange(code);
    } catch (err) {
      logger.warn(`[auth] token exchange failed: ${redactSecrets((err as Error)?.message ?? String(err)).slice(0, MAX_LOG_CHARS)}`);
      throw err;
    }
  };

  const scores = opts.highScores ?? new HighScores(highScoresStore(env), (m) => logger.warn(m));
  // Read the boards now, so the first visitor doesn't wait for it (a failure is logged and tried again on use).
  scores.ready().catch(() => {});
  const unavailable = () => json(503, { error: 'The high scores are not available right now. Try again in a moment.' }, [], { 'Retry-After': '5' });
  const entriesBy = new Map<string, number[]>();
  /** Accounts and addresses with a check running: one at a time each, so nobody can keep the server busy replaying. */
  const checking = new Set<string>();
  const verifyAnswer = answerVerifier(cfg.sessionSecret);
  const trustedProxies = trustedProxiesFromEnv(env);

  /**
   * POST /api/highscores: a player's initials and their game's recording; the server replays it for the score. Signed
   * in or not: the replay checks the game, and a signed-out player is counted by their address.
   */
  const enterScore = (req: IncomingMessage, res: ServerResponse, http: HttpRequest) => {
    if (crossSite(http, cfg)) return send(res, json(403, { error: 'Cross-site request refused' }));
    if (!String(http.headers['content-type'] ?? '').includes('application/json')) return send(res, json(415, { error: 'Send JSON' }));
    const session = sessionFrom(http, cfg);
    const visitor = visitorKey(clientIp(http, trustedProxies));
    // Who the rate limit counts: the account, else the address.
    const sender = session ? accountHash(session.user, cfg.sessionSecret) : `visitor:${visitor}`;
    const now = Date.now();
    const recent = (entriesBy.get(sender) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= SCORE_ENTRIES_PER_HOUR || checking.has(sender)) return send(res, json(429, { error: 'Too many entries for now. Try again later.' }));
    if (!opts.loadPlayerCheck) return send(res, json(503, { error: 'High scores are not available here' }));
    const check = opts.loadPlayerCheck;
    // Every attempt counts (refused ones too), before the body is read.
    entriesBy.set(sender, [...recent, now]);
    checking.add(sender);
    readBody(req, MAX_SCORE_BODY_BYTES)
      .then(async (raw) => {
        if (raw === null) return send(res, json(413, { error: 'Request body too large' }, [], { Connection: 'close' }));
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return send(res, json(400, { error: 'Bad JSON' }));
        }
        const board = typeof body.board === 'string' && BOARD_KEYS.includes(body.board) ? body.board : null;
        const initials = cleanInitials(body.initials);
        if (!board || !initials) return send(res, json(400, { error: 'Pick a lineup board and three letters' }));
        // One line per board each: per account, or per address and initials.
        const who = session ? sender : visitorHash(visitor, initials, cfg.sessionSecret);
        // Never put an entry on boards that weren't read: saving them would replace the stored ones.
        if (!(await scores.ready().then(() => true, () => false))) return send(res, unavailable());
        const result = (await check())(body.recording, verifyAnswer);
        if (!result.ok || result.board !== board) {
          logger.warn(`[highscores] refused an entry from ${who}: ${result.ok ? 'played against another lineup' : result.error}`);
          return send(res, json(422, { error: 'That game did not check out' }));
        }
        let place = scores.add(board, { initials, score: result.score, at: new Date(now).toISOString(), who });
        // Saved before the answer, so the entry is stored once the player sees it (a failed save is retried). The
        // save may merge in another server's entries, so the place is read again after it.
        if (place !== null) {
          // Not stored: say so, so the player tries again (the same game again is the same line, so that's safe).
          if (!(await scores.flush())) return send(res, json(503, { error: 'Your score could not be saved. Try again in a moment.' }, [], { 'Retry-After': '5' }));
          place = scores.placeOf(board, who);
        }
        logger.info(`[highscores] ${initials} ${result.score} on ${board}: ${place === null ? 'not in the top ten' : `#${place}`} (${who})`);
        send(res, json(200, { place, score: result.score, boards: scores.view() }));
      })
      .catch((err) => {
        logger.error(`[highscores] entry failed: ${String((err as Error)?.message ?? err).slice(0, MAX_LOG_CHARS)}`);
        if (!res.headersSent) send(res, json(500, { error: 'internal error' }));
        else abort(res);
      })
      .finally(() => checking.delete(sender));
  };

  return (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    const http = toHttp(req);
    if (path === '/api/highscores') {
      if (http.method === 'GET') {
        void scores.ready().then(
          () => send(res, json(200, { boards: scores.view() }, [], { 'Cache-Control': 'no-store' })),
          () => send(res, unavailable()),
        );
        return;
      }
      if (http.method === 'POST') return enterScore(req, res, http);
      return send(res, json(405, { error: 'Method not allowed' }, [], { Allow: 'GET, POST' }));
    }
    if (path === '/auth/login') return send(res, handleLogin(http, cfg));
    if (path === '/auth/callback') {
      void handleCallback(http, cfg, exchange)
        .then((r) => send(res, r), () => send(res, redirect(`${cfg.basePath ?? ''}/?auth_error=exchange`)))
        .catch(() => abort(res));
      return;
    }
    if (path === '/auth/logout') return send(res, handleLogout(http, cfg));
    if (path === '/api/me') return send(res, handleMe(http, cfg, devKey?.provider, undefined, access?.pool.current()));
    if (path !== '/api/decide' && path !== '/api/warm') return next();

    // Refuse what needs no body (wrong method, cross-site, not JSON, signed out, over a free-credits limit) before reading any of it.
    const refused = rejectDecideRequest(http, cfg, devKey, access) ?? poolLimitRequest(http, cfg, devKey, access);
    if (refused) return send(res, refused);
    const redact = redactSecrets;
    const pooled = resolveKey(sessionFrom(http, cfg), devKey, cfg.opperUrl, access?.pool)?.mode === 'pool';
    readBody(req, pooled ? MAX_POOL_BODY_BYTES : MAX_BODY_BYTES)
      .then(async (raw) => {
        if (raw === null) return send(res, json(413, { error: 'Request body too large' }, [], { Connection: 'close' }));
        const r = await handleDecideRequest(
          http,
          raw,
          cfg,
          devKey,
          {
            fetch,
            now: () => performance.now(),
            log: (line) => logger.info(line, { timestamp: true }),
            logError: (line) => logger.error(line),
          },
          { warm: path === '/api/warm' },
          access,
        );
        send(res, r);
      })
      .catch((err) => {
        try {
          logger.error(`[jev] /api/decide request failed: ${redact((err as Error)?.message ?? String(err)).slice(0, MAX_LOG_CHARS)}`);
          if (!res.headersSent) return send(res, json(500, { error: 'internal error in /api/decide' }));
        } catch {
          // fall through to abort
        }
        abort(res);
      });
  };
}
