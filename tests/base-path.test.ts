import { describe, expect, it, vi } from 'vitest';
import { mountAt, mountedUrl, normalizeBasePath } from '../server/base-path';

describe('normalizeBasePath', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['  ', ''],
    ['/', ''],
    ['/jevman-benchmark', '/jevman-benchmark'],
    ['/jevman-benchmark/', '/jevman-benchmark'],
    ['jevman-benchmark', '/jevman-benchmark'],
    [' /apps/jevman ', '/apps/jevman'],
  ])('%j -> %j', (raw, expected) => {
    expect(normalizeBasePath(raw)).toBe(expected);
  });

  it.each(['/a b', '/a?x', '/a#x', '/../etc', '/a/./b', '/a//b', '/%2e%2e', 'https://opper.ai/x'])('refuses %j', (raw) => {
    expect(() => normalizeBasePath(raw)).toThrow(/APP_BASE_PATH/);
  });
});

describe('mountedUrl', () => {
  const base = '/jevman-benchmark';
  it('leaves every URL unchanged without a base path', () => {
    expect(mountedUrl('/api/me?x=1', '')).toEqual({ kind: 'inside', url: '/api/me?x=1' });
  });
  it('removes the prefix from URLs below it', () => {
    expect(mountedUrl('/jevman-benchmark/', base)).toEqual({ kind: 'inside', url: '/' });
    expect(mountedUrl('/jevman-benchmark/leaderboard?x=1', base)).toEqual({ kind: 'inside', url: '/leaderboard?x=1' });
    expect(mountedUrl('/jevman-benchmark/auth/callback?code=c&state=s', base)).toEqual({ kind: 'inside', url: '/auth/callback?code=c&state=s' });
  });
  it('redirects the bare prefix to the prefix with a slash, keeping the query', () => {
    expect(mountedUrl('/jevman-benchmark', base)).toEqual({ kind: 'bare', location: '/jevman-benchmark/' });
    expect(mountedUrl('/jevman-benchmark?pacman=opper%2Fclef', base)).toEqual({ kind: 'bare', location: '/jevman-benchmark/?pacman=opper%2Fclef' });
  });
  it.each(['/', '/health', '/api/me', '/jevman-benchmarks/', '/jevman-benchmark-x', '/media-studio/', '/JEVMAN-BENCHMARK/'])('%s is outside', (url) => {
    expect(mountedUrl(url, base)).toEqual({ kind: 'outside' });
  });
});

describe('mountAt', () => {
  it('hands the handler the URL without the prefix and restores it for the next middleware', () => {
    const seen: string[] = [];
    const handler = mountAt('/jb', (req: { url?: string }, _res: unknown, next: () => void) => {
      seen.push(req.url!);
      next();
    });
    const req = { url: '/jb/api/me?x=1' };
    const next = vi.fn(() => seen.push(`next:${req.url}`));
    handler(req, null, next);
    expect(seen).toEqual(['/api/me?x=1', 'next:/jb/api/me?x=1']);
  });
  it('skips the handler outside the prefix', () => {
    const inner = vi.fn();
    const next = vi.fn();
    mountAt('/jb', inner)({ url: '/api/me' }, null, next);
    mountAt('/jb', inner)({ url: '/jb' }, null, next);
    expect(inner).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
  });
  it('is the handler itself without a base path', () => {
    const inner = vi.fn();
    expect(mountAt('', inner)).toBe(inner);
  });
});
