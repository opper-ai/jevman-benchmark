import { describe, expect, it } from 'vitest';
import type { LeaderboardEntry } from '../shared/leaderboard';
import { SORTS, sortRows } from '../src/results';

const entry = (name: string, over: Partial<LeaderboardEntry>): { e: LeaderboardEntry } => ({
  e: {
    model: name,
    name,
    games: 100,
    meanScore: 0,
    bestScore: 0,
    scoreStdError: 50,
    meanSurvivedSeconds: 60,
    meanPellets: 200,
    pelletsPerLife: 60,
    meanGhostsEaten: 1,
    fruitEaten: '0/0',
    bestLevel: 1,
    fallbackRate: 0.03,
    meanLatencyMs: 300,
    costPerGame: 0.005,
    deathsBy: {},
    ...over,
  } as LeaderboardEntry,
});

// In rank order, as the leaderboard hands them over.
const rows = [
  entry('a', { meanScore: 4000, bestScore: 6000, meanSurvivedSeconds: 70, meanLatencyMs: 400, fallbackRate: 0.05, costPerGame: 0.27 }),
  entry('b', { meanScore: 3000, bestScore: 9000, meanSurvivedSeconds: 80, meanLatencyMs: null, fallbackRate: 0.02, costPerGame: 0 }),
  entry('c', { meanScore: 2000, bestScore: undefined, meanSurvivedSeconds: 70, meanLatencyMs: 100, fallbackRate: 0.05, costPerGame: 0.003 }),
];
const names = (key: Parameters<typeof sortRows>[1], reversed = false) => sortRows(rows, key, reversed).map((r) => r.e.name);

describe('sorting the leaderboard', () => {
  it('keeps the rank by default', () => {
    expect(SORTS[0].key).toBe('rank');
    expect(names('rank')).toEqual(['a', 'b', 'c']);
  });
  it('puts the best first: the highest score and survival, the lowest latency, backup rate and cost', () => {
    expect(names('best')).toEqual(['b', 'a', 'c']);
    expect(names('survival')).toEqual(['b', 'a', 'c']);
    expect(names('latency')).toEqual(['c', 'a', 'b']);
    expect(names('backup')).toEqual(['b', 'a', 'c']);
    expect(names('cost')).toEqual(['c', 'a', 'b']);
  });
  it('puts a number a model did not report last, and keeps the rank order between equal ones', () => {
    // c has no best game, b no latency and no cost; a and c survived and backed up equally.
    expect(names('best').at(-1)).toBe('c');
    expect(names('latency').at(-1)).toBe('b');
    expect(names('cost').at(-1)).toBe('b');
    expect(names('survival').slice(1)).toEqual(['a', 'c']);
    expect(names('backup').slice(1)).toEqual(['a', 'c']);
  });
  it('turns round on a second click, worst first, with a missing number still last', () => {
    expect(names('rank', true)).toEqual(['c', 'b', 'a']);
    expect(names('latency', true)).toEqual(['a', 'c', 'b']);
    expect(names('best', true)).toEqual(['a', 'b', 'c']);
    expect(names('cost', true)).toEqual(['a', 'c', 'b']);
  });
  it('leaves the rows it was given as they were', () => {
    sortRows(rows, 'latency');
    expect(rows.map((r) => r.e.name)).toEqual(['a', 'b', 'c']);
  });
});
