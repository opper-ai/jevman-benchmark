import { modelName } from '../shared/models';

/**
 * The game Watch plays for each model: one real benchmark game (the classic ghosts, the 300 s cap), the one closest to
 * the model's leaderboard average. Ours were recorded with `npm run bench -- --games 1 --pacman jev --pacman-model
 * <id> --ghosts greedy --max 300 --record public/demo/<file>` (the closest of three); jev's is the original 120 s demo.
 * A community model's is the game from its submission closest to its mean, unpacked as submitted
 * (`gunzip -c submissions/<id>/game-NN.json.gz > public/demo/<id>-demo.json`), keyed by the submission id and named
 * as its submitter named it. Listed in leaderboard order. Recordings cost nothing to watch; no model is called.
 * Each also needs its highlight to download: `npm run clips -- <model>` (scripts/clips.ts).
 */
export const RECORDINGS: Record<string, { path: string; score: number; name?: string }> = {
  'typesafe/jev-1.14.0': { path: '/demo/jev-1-14-demo.json', score: 2820 },
  semif: { path: '/demo/semif-demo.json', score: 3230, name: 'SemIf' }, // game-100
  'upright/eevo-1': { path: '/demo/eevo-1-demo.json', score: 2640 },
  'typesafe/jev-1.13.0': { path: '/demo/jev-demo.json', score: 3870 },
  'qwen-3-8-flash-next-nvfp4': { path: '/demo/qwen-3-8-flash-next-nvfp4-demo.json', score: 2700, name: 'Qwen 3.8 Flash Next NVFP4' }, // game-13
  'rizzo-flow': { path: '/demo/rizzo-flow-demo.json', score: 2640, name: 'RizzoFlow' }, // game-32
  'openai/gpt-6-luna-decisions': { path: '/demo/gpt-6-luna-demo.json', score: 2870 },
  'opper/clef-flash': { path: '/demo/clef-flash-demo.json', score: 2840 },
  'opper/clef': { path: '/demo/clef-demo.json', score: 3340 },
  'microsoft/decision-1': { path: '/demo/microsoft-decision-1-demo.json', score: 2700 },
  'winnow-12b-nvfp4': { path: '/demo/winnow-12b-nvfp4-demo.json', score: 2350, name: 'Winnow-12B NVFP4' }, // game-03
  'empiriolabs/aplomb-1': { path: '/demo/aplomb-1-demo.json', score: 1810 },
  'opper/kev-4b': { path: '/demo/kev-4b-demo.json', score: 1480 },
  'd1-3b': { path: '/demo/d1-3b-demo.json', score: 1160, name: 'd1-3B' }, // game-07
  'random-dice': { path: '/demo/random-dice-demo.json', score: 1030, name: 'Random (die roll)' }, // game-12
  von: { path: '/demo/von-demo.json', score: 970, name: 'Von' }, // game-06
  'berget/convaiinnovations/laya': { path: '/demo/laya-demo.json', score: 590 },
};

/** The game the page opens on, for everyone: jev's latest version. */
export const OPENING_RECORDING = 'typesafe/jev-1.14.0';

/** The name a watched model goes by: a community model's own, else the listed model's. */
export const watchName = (model: string): string => RECORDINGS[model]?.name ?? modelName(model);

/** The best recorded game: the cabinet's high score until a visitor beats it. */
export const TOP_RECORDED_SCORE = Math.max(...Object.values(RECORDINGS).map((r) => r.score));
