/**
 * The System One decision models Opper serves (GET https://api.opper.ai/v3/models?type=evaluation, 2026-10).
 * Shared by the game and the server, which only forwards models from this list. `opper` is the id Opper serves a model
 * under when it differs from the game's own: Opper retired opper/clef and opper/clef-flash (2026-10-08), and the game
 * keeps its ids so the leaderboard, recordings and high-score boards stay as they are.
 */
export const DECISION_MODELS = [
  { id: 'typesafe/jev-1.13.0', name: 'jev 1.13', maker: 'TypeSafe' },
  { id: 'opper/clef', name: 'Clef', maker: 'Cloudflare', opper: 'sference/clef' },
  { id: 'opper/clef-flash', name: 'Clef Flash', maker: 'Cloudflare', opper: 'cloudflare:global/clef-flash' },
  { id: 'opper/kev-4b', name: 'Kev 4B', maker: 'Jared Palmer' },
  { id: 'berget/convaiinnovations/laya', name: 'Laya', maker: 'ConvAI Innovations' },
  { id: 'openai/gpt-6-luna-decisions', name: 'GPT-6 Luna', maker: 'OpenAI' },
] as const;

export type ModelId = (typeof DECISION_MODELS)[number]['id'];

export const DEFAULT_MODEL: ModelId = 'typesafe/jev-1.13.0';

export const isModelId = (v: unknown): v is ModelId => DECISION_MODELS.some((m) => m.id === v);

/** The display name of a listed model; any other System One model (say, from JEV_MODEL) shows its id. */
export const modelName = (id: string): string => DECISION_MODELS.find((m) => m.id === id)?.name ?? id;
