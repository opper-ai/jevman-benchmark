import { createHash, createHmac } from 'node:crypto';

/**
 * Just enough S3 for the high-score boards: get and put one object, signed with AWS Signature Version 4. The server
 * runs on Node built-ins only (no node_modules ship in the image), so this replaces the AWS SDK for those two calls.
 */

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** When temporary credentials stop working (ms since the epoch). */
  expiresAt?: number;
}

const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest();
/** RFC 3986 encoding, as SigV4 wants it: encodeURIComponent leaves !'()* alone. */
const encode = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The headers that sign a request: x-amz-date, x-amz-content-sha256, the session token if any, and Authorization.
 * `headers` are the request's other headers to sign (lowercase names); the host comes from `url`.
 */
export function signRequest(req: {
  method: string;
  url: URL;
  region: string;
  headers: Record<string, string>;
  payloadHash: string;
  credentials: AwsCredentials;
  now: Date;
}): Record<string, string> {
  const amzDate = req.now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const signed: Record<string, string> = {
    ...req.headers,
    host: req.url.host,
    'x-amz-content-sha256': req.payloadHash,
    'x-amz-date': amzDate,
    ...(req.credentials.sessionToken ? { 'x-amz-security-token': req.credentials.sessionToken } : {}),
  };
  const names = Object.keys(signed).sort();
  const path = req.url.pathname.split('/').map((seg) => encode(decodeURIComponent(seg))).join('/');
  const query = [...req.url.searchParams].map(([k, v]) => `${encode(k)}=${encode(v)}`).sort().join('&');
  const canonical = [req.method, path, query, ...names.map((n) => `${n}:${signed[n]!.trim()}`), '', names.join(';'), req.payloadHash].join('\n');
  const scope = `${day}/${req.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${req.credentials.secretAccessKey}`, day), req.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const { host: _host, ...rest } = signed;
  return { ...rest, authorization: `AWS4-HMAC-SHA256 Credential=${req.credentials.accessKeyId}/${scope},SignedHeaders=${names.join(';')},Signature=${signature}` };
}

/** Temporary credentials are fetched again this long before they expire. */
const REFRESH_BEFORE_MS = 5 * 60_000;

/**
 * Where AWS credentials come from: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (and AWS_SESSION_TOKEN) in the
 * environment, else the ECS task role's endpoint (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI, or _FULL_URI with
 * AWS_CONTAINER_AUTHORIZATION_TOKEN), cached until shortly before they expire.
 */
export function credentialsFromEnv(env: Record<string, string | undefined>, fetchFn: typeof fetch = fetch, now: () => number = Date.now): () => Promise<AwsCredentials> {
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    const fixed: AwsCredentials = { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}) };
    return async () => fixed;
  }
  const endpoint = env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ? `http://169.254.170.2${env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI}` : env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  if (!endpoint) return async () => Promise.reject(new Error('no AWS credentials: neither AWS_ACCESS_KEY_ID nor an ECS task role'));
  let cached: AwsCredentials | null = null;
  let pending: Promise<AwsCredentials> | null = null;
  return async () => {
    if (cached && (cached.expiresAt === undefined || now() < cached.expiresAt - REFRESH_BEFORE_MS)) return cached;
    pending ??= (async () => {
      try {
        const res = await fetchFn(endpoint, {
          headers: env.AWS_CONTAINER_AUTHORIZATION_TOKEN ? { Authorization: env.AWS_CONTAINER_AUTHORIZATION_TOKEN } : {},
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`the task role's credentials: HTTP ${res.status}`);
        const body = (await res.json()) as { AccessKeyId?: string; SecretAccessKey?: string; Token?: string; Expiration?: string };
        if (!body.AccessKeyId || !body.SecretAccessKey) throw new Error("the task role's credentials came back without keys");
        cached = {
          accessKeyId: body.AccessKeyId,
          secretAccessKey: body.SecretAccessKey,
          ...(body.Token ? { sessionToken: body.Token } : {}),
          ...(body.Expiration ? { expiresAt: Date.parse(body.Expiration) } : {}),
        };
        return cached;
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
}

/** A stored text and its version (an S3 ETag). */
export interface Stored {
  text: string;
  version: string;
}

/**
 * One stored text: what the high-score boards are kept in. Writes are conditional, so two servers writing at once
 * (old and new tasks overlap during a deploy) can't silently replace each other's changes.
 */
export interface TextStore {
  /** Where, for logs. */
  where: string;
  /** The text and its version, or null when nothing is stored yet. */
  load(): Promise<Stored | null>;
  /** Writes `text` if the stored version is still `expected` (null: nothing stored yet): the new version, or null if another writer got there first. */
  save(text: string, expected: string | null): Promise<string | null>;
}

/** S3's error code from an error response body, e.g. AccessDenied. */
const errorCode = (body: string): string => /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? '';

/**
 * An S3 object as a TextStore. A missing object (404 NoSuchKey) is "nothing yet"; any other failure throws. Writes use S3's
 * conditional writes: If-Match the ETag that was read, or If-None-Match: * for the first one.
 */
export function s3Store(opts: { bucket: string; key: string; region: string; credentials: () => Promise<AwsCredentials>; fetch?: typeof fetch; now?: () => Date }): TextStore {
  const url = new URL(`https://${opts.bucket}.s3.${opts.region}.amazonaws.com/${opts.key.split('/').map(encode).join('/')}`);
  const fetchFn = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const request = async (method: 'GET' | 'PUT', body?: string, extra: Record<string, string> = {}) => {
    const headers = signRequest({
      method,
      url,
      region: opts.region,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
      payloadHash: sha256(body ?? ''),
      credentials: await opts.credentials(),
      now: now(),
    });
    return fetchFn(url.href, { method, headers, ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(10_000) });
  };
  const failed = async (what: string, res: Response) => new Error(`${what} s3://${opts.bucket}/${opts.key}: HTTP ${res.status} ${errorCode(await res.text())}`.trim());
  return {
    where: `s3://${opts.bucket}/${opts.key}`,
    async load() {
      const res = await request('GET');
      // Only a missing object is "nothing yet": a missing bucket (NoSuchBucket) is a broken setup.
      if (res.status === 404) {
        const body = await res.text();
        if (errorCode(body) === 'NoSuchKey') return null;
        throw new Error(`reading s3://${opts.bucket}/${opts.key}: HTTP 404 ${errorCode(body)}`.trim());
      }
      if (!res.ok) throw await failed('reading', res);
      const version = res.headers.get('etag');
      if (!version) throw new Error(`reading ${url.href}: no ETag`);
      return { text: await res.text(), version };
    },
    async save(text, expected) {
      const res = await request('PUT', text, expected === null ? { 'if-none-match': '*' } : { 'if-match': expected });
      // 412: the object changed since it was read (or now exists); 409: another conditional write is under way.
      if (res.status === 412 || res.status === 409) return null;
      if (!res.ok) throw await failed('writing', res);
      const version = res.headers.get('etag');
      if (!version) throw new Error(`writing ${url.href}: no ETag`);
      return version;
    },
  };
}
