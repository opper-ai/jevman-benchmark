import { describe, expect, it } from 'vitest';
import { placeFor } from '../src/highscores';

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
