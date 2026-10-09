import { describe, expect, it, vi } from 'vitest';
import { credentialsFromEnv, s3Store, signRequest, type AwsCredentials } from '../server/s3';

// AWS's own Signature Version 4 examples for S3 (Amazon S3 API reference, "Signature Calculations for the
// Authorization Header: Transferring Payload in a Single Chunk").
const EXAMPLE: AwsCredentials = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
const EXAMPLE_DATE = new Date('2013-05-24T00:00:00Z');
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('signRequest', () => {
  it("matches AWS's GET Object example", () => {
    const headers = signRequest({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      region: 'us-east-1',
      headers: { range: 'bytes=0-9' },
      payloadHash: EMPTY_SHA256,
      credentials: EXAMPLE,
      now: EXAMPLE_DATE,
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it("matches AWS's PUT Object example, with a key that needs encoding", () => {
    const headers = signRequest({
      method: 'PUT',
      url: new URL('https://examplebucket.s3.amazonaws.com/test$file.text'),
      region: 'us-east-1',
      headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
      payloadHash: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
      credentials: EXAMPLE,
      now: EXAMPLE_DATE,
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    );
  });

  it('signs the session token of temporary credentials', () => {
    const headers = signRequest({ method: 'GET', url: new URL('https://b.s3.eu-north-1.amazonaws.com/k'), region: 'eu-north-1', headers: {}, payloadHash: EMPTY_SHA256, credentials: { ...EXAMPLE, sessionToken: 'tok' }, now: EXAMPLE_DATE });
    expect(headers['x-amz-security-token']).toBe('tok');
    expect(headers.authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token,');
  });
});

describe('credentialsFromEnv', () => {
  const ecsBody = (expiresIn: number) => ({ AccessKeyId: 'ASIA1', SecretAccessKey: 's1', Token: 't1', Expiration: new Date(Date.UTC(2026, 9, 9) + expiresIn).toISOString() });

  it("reads the ECS task role's credentials and reuses them until shortly before they expire", async () => {
    let now = Date.UTC(2026, 9, 9);
    const fetch = vi.fn(async () => new Response(JSON.stringify(ecsBody(60 * 60_000))));
    const creds = credentialsFromEnv({ AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/abc' }, fetch as never, () => now);
    expect(await creds()).toEqual({ accessKeyId: 'ASIA1', secretAccessKey: 's1', sessionToken: 't1', expiresAt: now + 60 * 60_000 });
    expect(fetch).toHaveBeenCalledWith('http://169.254.170.2/v2/credentials/abc', expect.anything());
    now += 50 * 60_000;
    await creds();
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 6 * 60_000; // within five minutes of expiry: fetched again
    await creds();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('prefers keys in the environment (a local run against the bucket)', async () => {
    const fetch = vi.fn();
    const creds = credentialsFromEnv({ AWS_ACCESS_KEY_ID: 'AK', AWS_SECRET_ACCESS_KEY: 'SK', AWS_SESSION_TOKEN: 'ST', AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/x' }, fetch as never, () => 0);
    expect(await creds()).toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'ST' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says plainly when there are no credentials at all', async () => {
    await expect(credentialsFromEnv({}, vi.fn() as never, () => 0)()).rejects.toThrow(/no AWS credentials/);
  });
});

describe('s3Store', () => {
  const creds = async () => EXAMPLE;
  const store = (fetch: typeof globalThis.fetch) => s3Store({ bucket: 'opper-jevman-benchmark-highscores-eu-north', key: 'highscores.json', region: 'eu-north-1', credentials: creds, fetch });

  it('reads the object with its version, and a missing one as no boards yet', async () => {
    const fetch = vi.fn(async (url: string) => (url.endsWith('/highscores.json') ? new Response('{"mixed":[]}', { headers: { etag: '"abc"' } }) : new Response('', { status: 500 })));
    expect(await store(fetch as never).load()).toEqual({ text: '{"mixed":[]}', version: '"abc"' });
    expect(fetch.mock.calls[0]![0]).toBe('https://opper-jevman-benchmark-highscores-eu-north.s3.eu-north-1.amazonaws.com/highscores.json');
    expect(await store((async () => new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 })) as never).load()).toBeNull();
  });

  it('fails loudly on anything else, so the boards are never started empty over saved ones', async () => {
    const noBucket = async () => new Response('<Error><Code>NoSuchBucket</Code></Error>', { status: 404 });
    await expect(store(noBucket as never).load()).rejects.toThrow('HTTP 404 NoSuchBucket');
    const denied = async () => new Response('<Error><Code>AccessDenied</Code><Message>no</Message></Error>', { status: 403 });
    await expect(store(denied as never).load()).rejects.toThrow('HTTP 403 AccessDenied');
  });

  it('writes the whole object, signed for its body, only over the version it read', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 200, headers: { etag: '"new"' } }));
    expect(await store(fetch as never).save('{"mixed":[]}', '"abc"')).toBe('"new"');
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['if-match']).toBe('"abc"');
    expect(url).toBe('https://opper-jevman-benchmark-highscores-eu-north.s3.eu-north-1.amazonaws.com/highscores.json');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"mixed":[]}');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/eu-north-1\/s3\/aws4_request,/);
    await expect(store((async () => new Response('', { status: 503 })) as never).save('{}', null)).rejects.toThrow('HTTP 503');
  });

  it('creates the object only if there is none yet', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 200, headers: { etag: '"first"' } }));
    expect(await store(fetch as never).save('{}', null)).toBe('"first"');
    const init = (fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1];
    expect(init.headers['if-none-match']).toBe('*');
    expect(init.headers).not.toHaveProperty('if-match');
  });

  it('says so when another writer got there first', async () => {
    expect(await store((async () => new Response('<Error><Code>PreconditionFailed</Code></Error>', { status: 412 })) as never).save('{}', '"old"')).toBeNull();
    expect(await store((async () => new Response('<Error><Code>ConditionalRequestConflict</Code></Error>', { status: 409 })) as never).save('{}', '"old"')).toBeNull();
  });
});
