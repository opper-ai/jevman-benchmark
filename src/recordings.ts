/**
 * The game Watch plays for each model: one real benchmark game (the classic ghosts, the 300 s cap), the one of three
 * closest to the model's leaderboard average, recorded with `npm run bench -- --games 1 --pacman jev --pacman-model
 * <id> --ghosts greedy --max 300 --record public/demo/<file>`. jev's is the original 120 s demo. Recordings cost
 * nothing to watch; no model is called.
 */
export const RECORDINGS: Record<string, { path: string; score: number }> = {
  'typesafe/jev-1.13.0': { path: '/demo/jev-demo.json', score: 3870 },
  'opper/clef': { path: '/demo/clef-demo.json', score: 3340 },
  'opper/clef-flash': { path: '/demo/clef-flash-demo.json', score: 2840 },
  'openai/gpt-6-luna-decisions': { path: '/demo/gpt-6-luna-demo.json', score: 2870 },
  'microsoft/decision-1': { path: '/demo/microsoft-decision-1-demo.json', score: 2700 },
  'empiriolabs/aplomb-1': { path: '/demo/aplomb-1-demo.json', score: 1810 },
  'opper/kev-4b': { path: '/demo/kev-4b-demo.json', score: 1480 },
  'berget/convaiinnovations/laya': { path: '/demo/laya-demo.json', score: 590 },
};

/** The best recorded game: the cabinet's high score until a visitor beats it. */
export const TOP_RECORDED_SCORE = Math.max(...Object.values(RECORDINGS).map((r) => r.score));
