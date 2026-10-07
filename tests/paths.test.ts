import { describe, expect, it } from 'vitest';
import { appPath, SHARE_URL, shareUrlFor, withBase } from '../src/paths';

describe('client paths', () => {
  it.each([
    ['/', '/api/me', '/api/me'],
    ['/', '/', '/'],
    ['/', '/?pacman=opper%2Fclef', '/?pacman=opper%2Fclef'],
    ['/jevman-benchmark/', '/api/me', '/jevman-benchmark/api/me'],
    ['/jevman-benchmark/', '/', '/jevman-benchmark/'],
    ['/jevman-benchmark/', '/?pacman=opper%2Fclef', '/jevman-benchmark/?pacman=opper%2Fclef'],
    ['/jevman-benchmark/', 'leaderboard', '/jevman-benchmark/leaderboard'],
    ['/jevman-benchmark/', '/demo/jev-demo.json', '/jevman-benchmark/demo/jev-demo.json'],
  ])('withBase(%s, %s) = %s', (base, path, expected) => {
    expect(withBase(base, path)).toBe(expected);
  });

  it('builds for the root by default', () => {
    expect(appPath('/leaderboard.json')).toBe(withBase(import.meta.env.BASE_URL, '/leaderboard.json'));
    expect(SHARE_URL).toMatch(/^https:\/\//);
  });

  it('shares the bare origin at the root and the app address below a prefix', () => {
    expect(shareUrlFor('/', 'https://jevman.apps.chadda.se', 'https://jevman.apps.chadda.se/')).toBe('https://jevman.apps.chadda.se');
    expect(shareUrlFor('/jevman-benchmark/', 'https://opper.ai', 'https://opper.ai/jevman-benchmark/')).toBe('https://opper.ai/jevman-benchmark/');
  });
});
