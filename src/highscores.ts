import { appPath } from './paths';
import type { Recording } from './replay';
import { BOARD_KEYS } from '../shared/lineups';
import { modelName } from '../shared/models';

/** A line on a player high-score board. */
export interface BoardEntry {
  initials: string;
  score: number;
  at: string;
}
/** The boards: "mixed", and one per model playing all four ghosts. */
export type Boards = Record<string, BoardEntry[]>;

const BOARD_SIZE = 10;

/** "Mixed", "All jev", "All Luna": a board's name as the picker's lineups name it. */
export const boardLabel = (key: string): string => (key === 'mixed' ? 'Mixed' : `All ${modelName(key).replace(/ 1\.13$/, '').replace(/ 4B$/, '').replace(/^GPT-6 /, '')}`);

export async function fetchBoards(): Promise<Boards | null> {
  try {
    const res = await fetch(appPath('/api/highscores'), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { boards?: Boards };
    return data.boards && BOARD_KEYS.every((k) => Array.isArray(data.boards![k])) ? data.boards : null;
  } catch {
    return null;
  }
}

/** The place a score would take on a board (1 to 10), or null; with no boards yet, the first place. */
export function placeFor(boards: Boards | null, board: string, score: number): number | null {
  // Boards that couldn't be loaded give no place: the server takes no entries then either.
  if (score <= 0 || !boards) return null;
  const list = boards[board] ?? [];
  const place = list.filter((e) => e.score >= score).length + 1;
  return place <= BOARD_SIZE ? place : null;
}

export type EntryResult = { ok: true; place: number | null; score: number; boards: Boards } | { ok: false; error: string };

/** Sends a finished game for a board: the server replays the recording for the score. */
export async function enterScore(board: string, initials: string, recording: Recording): Promise<EntryResult> {
  try {
    const res = await fetch(appPath('/api/highscores'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board, initials, recording }) });
    const data = (await res.json().catch(() => ({}))) as { place?: number | null; score?: number; boards?: Boards; error?: string };
    if (res.ok && data.boards && typeof data.score === 'number') return { ok: true, place: data.place ?? null, score: data.score, boards: data.boards };
    return { ok: false, error: data.error ?? 'That did not work. Try again.' };
  } catch {
    return { ok: false, error: 'No connection. Try again.' };
  }
}
