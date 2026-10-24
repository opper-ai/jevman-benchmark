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
  { id: 'bespoke/nimble-v4-max', name: 'Nimble v4 Max', maker: 'Bespoke Labs' },
  { id: 'perplexity/pplx-decider-v1.2', name: 'Perplexity Decider 1.2', maker: 'Perplexity' },
  { id: 'perplexity/pplx-decider-flash-v1.2', name: 'Perplexity Decider Flash 1.2', maker: 'Perplexity' },
  { id: 'cloudflare/clef-omni', name: 'Clef Omni', maker: 'Cloudflare', opper: 'cloudflare:global/clef-omni' },
  // Upright serves Eevo-1 from two routes; the EU one answered about 100 ms faster in our test (2026-10-16). At 60
  // times jev's price per token it is on the leaderboard and in Watch, but not in Play. Upright's eevo-1 names its
  // latest version and keeps no old ones: the first, Eevo-1, is retired (its row and Watch game stay, the server no
  // longer forwards it), and Eevo-1.1 (2026-10-18) goes through that name until Opper lists eevo-1.1 itself.
  { id: 'upright/eevo-1', name: 'Eevo-1', maker: 'Upright', play: false, retired: true },
  { id: 'upright/eevo-1.1', name: 'Eevo-1.1', maker: 'Upright', opper: 'eevo:eu/eevo-1', play: false },
] as const;

export type ModelId = (typeof DECISION_MODELS)[number]['id'];

export const DEFAULT_MODEL: ModelId = 'typesafe/jev-1.13.0';

export const isModelId = (v: unknown): v is ModelId => DECISION_MODELS.some((m) => m.id === v);

/** Whether Play offers the model: free and signed-in games alike. */
export const inPlay = (id: string): boolean => !(DECISION_MODELS as readonly { id: string; play?: boolean }[]).some((m) => m.id === id && m.play === false);

/** Whether its maker no longer serves the model: it keeps its leaderboard row and recordings, but nothing calls it. */
export const isRetired = (id: string): boolean => (DECISION_MODELS as readonly { id: string; retired?: boolean }[]).some((m) => m.id === id && m.retired === true);

/** The display name of a listed model; any other System One model (say, from JEV_MODEL) shows its id. */
export const modelName = (id: string): string => DECISION_MODELS.find((m) => m.id === id)?.name ?? id;
