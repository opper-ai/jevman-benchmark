/**
 * The System One decision models Opper serves (GET https://api.opper.ai/v3/models?type=evaluation, 2026-10).
 * Shared by the game and the server, which only forwards models from this list. `opper` is the id Opper serves a model
 * under when it differs from the game's own: Opper retired opper/clef and opper/clef-flash (2026-10-08), and the game
 * keeps its ids so the leaderboard, recordings and high-score boards stay as they are.
 */
export const DECISION_MODELS = [
  { id: 'typesafe/jev-1.13.0', name: 'jev 1.13', maker: 'TypeSafe' },
  { id: 'typesafe/jev-1.14.0', name: 'jev 1.14', maker: 'TypeSafe' },
  { id: 'opper/clef', name: 'Clef', maker: 'Cloudflare', opper: 'sference/clef' },
  { id: 'opper/clef-flash', name: 'Clef Flash', maker: 'Cloudflare', opper: 'cloudflare:global/clef-flash' },
  { id: 'opper/kev-4b', name: 'Kev 4B', maker: 'Jared Palmer' },
  { id: 'berget/convaiinnovations/laya', name: 'Laya', maker: 'ConvAI Innovations' },
  { id: 'openai/gpt-6-luna-decisions', name: 'GPT-6 Luna', maker: 'OpenAI' },
  { id: 'empiriolabs/aplomb-1', name: 'Aplomb 1', maker: 'EmpirioLabs' },
  { id: 'microsoft/decision-1', name: 'Microsoft Decision 1', maker: 'Microsoft', opper: 'azure:global/microsoft-decision-1' },
  // Upright serves Eevo 1 from two routes; the EU one answered about 100 ms faster in our test (2026-10-16). At 60
  // times jev's price per token it is on the leaderboard and in Watch, but not in Play.
  { id: 'upright/eevo-1', name: 'Eevo 1', maker: 'Upright', opper: 'eevo:eu/eevo-1', play: false },
] as const;

export type ModelId = (typeof DECISION_MODELS)[number]['id'];

export const DEFAULT_MODEL: ModelId = 'typesafe/jev-1.13.0';

export const isModelId = (v: unknown): v is ModelId => DECISION_MODELS.some((m) => m.id === v);

/** Whether Play offers the model: free and signed-in games alike. */
export const inPlay = (id: string): boolean => !(DECISION_MODELS as readonly { id: string; play?: boolean }[]).some((m) => m.id === id && m.play === false);

/** The display name of a listed model; any other System One model (say, from JEV_MODEL) shows its id. */
export const modelName = (id: string): string => DECISION_MODELS.find((m) => m.id === id)?.name ?? id;
