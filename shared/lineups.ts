/**
 * The ghost lineups the picker offers, and so the player high-score boards: one board per lineup. Shared by the page
 * and the server (Node built-ins only, so the server can run it as is).
 */
export type GhostName = 'blinky' | 'pinky' | 'inky' | 'clyde';
export const GHOST_NAMES_IN_ORDER: readonly GhostName[] = ['blinky', 'pinky', 'inky', 'clyde'];
export type GhostLineup = Record<GhostName, string>;

/** The mixed lineup: a different AI behind each ghost, like the arcade original where every ghost had its own mind. */
export const MIXED_LINEUP: GhostLineup = { blinky: 'opper/clef', pinky: 'typesafe/jev-1.14.0', inky: 'perplexity/pplx-decider-v1.2', clyde: 'openai/gpt-6-luna-decisions' };
/** The models a lineup can put on all four ghosts. */
export const SOLO_MODELS: readonly string[] = ['typesafe/jev-1.14.0', 'opper/clef', 'openai/gpt-6-luna-decisions', 'microsoft/decision-1', 'perplexity/pplx-decider-v1.2', 'bespoke/nimble-v4-max'];

/** A high-score board: "mixed", or the model all four ghosts play. */
export const BOARD_KEYS: readonly string[] = ['mixed', ...SOLO_MODELS];
/** Boards whose model moved on to a newer version: their scores carry over to the new one's board. */
export const MOVED_BOARDS: Readonly<Record<string, string>> = { 'typesafe/jev-1.13.0': 'typesafe/jev-1.14.0' };

/** A saved lineup, with a moved board's model on all four ghosts brought up to the version its board went to. */
export function movedOn(lineup: GhostLineup): GhostLineup {
  const next = MOVED_BOARDS[lineup.blinky];
  return next && GHOST_NAMES_IN_ORDER.every((g) => lineup[g] === lineup.blinky) ? { blinky: next, pinky: next, inky: next, clyde: next } : lineup;
}

/** The board a lineup's games count on, or null for a custom mix (those don't go on a board). */
export function boardOf(lineup: GhostLineup): string | null {
  if (GHOST_NAMES_IN_ORDER.every((g) => lineup[g] === MIXED_LINEUP[g])) return 'mixed';
  const first = lineup.blinky;
  return SOLO_MODELS.includes(first) && GHOST_NAMES_IN_ORDER.every((g) => lineup[g] === first) ? first : null;
}
