import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD_KEYS } from '../shared/lineups';
import { fetchBoards, placeFor } from '../src/highscores';

describe('placeFor', () => {
  it('finds the place a score would take on a loaded board', () => {
    const boards = { mixed: [{ initials: 'AAA', score: 500, at: '' }] };
    expect(placeFor(boards, 'mixed', 900)).toBe(1);
    expect(placeFor(boards, 'mixed', 100)).toBe(2);
    expect(placeFor({ mixed: [] }, 'mixed', 100)).toBe(1);
  });

  it('offers no place while the boards could not be loaded (entries are refused then too)', () => {
    expect(placeFor(null, 'mixed', 9000)).toBeNull();
  });
});

describe('fetchBoards', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a board an older server doesn't have (mid-deploy) as empty, and keeps the rest", async () => {
    const top = { initials: 'FAR', score: 30480, at: '2026-10-15T00:00:00.000Z' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ boards: { mixed: [top], 'opper/kev-4b': [] } }))));
    const boards = await fetchBoards();
    expect(Object.keys(boards!)).toEqual([...BOARD_KEYS]);
    expect(boards!.mixed).toEqual([top]);
    expect(boards!['perplexity/pplx-decider-v1.2']).toEqual([]);
  });

  it('is null when the server has no boards to show', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unavailable' }))));
    expect(await fetchBoards()).toBeNull();
  });
});
