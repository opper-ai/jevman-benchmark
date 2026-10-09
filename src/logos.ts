import { appPath } from './paths';

/**
 * Each decision model's maker mark, as the maker shows it on its own profiles (site, GitHub, Hugging Face). Jared
 * Palmer publishes Kev as himself, so Kev's mark is his avatar; Convai Innovations uses its brain-and-circuit logo.
 */
const LOGOS: Record<string, { src: string; maker: string; page: string; shape?: 'round' | 'tile'; mono?: true }> = {
  'typesafe/jev-1.13.0': { src: 'logos/typesafe.png', maker: 'TypeSafe', page: 'typesafe/jev-1-13-0', shape: 'tile' },
  'opper/clef': { src: 'logos/cloudflare.svg', maker: 'Cloudflare', page: 'cloudflare/clef' },
  'opper/clef-flash': { src: 'logos/cloudflare.svg', maker: 'Cloudflare', page: 'cloudflare/clef-flash' },
  'opper/kev-4b': { src: 'logos/jared-palmer.webp', maker: 'Jared Palmer', page: 'community/kev-4b', shape: 'round' },
  'berget/convaiinnovations/laya': { src: 'logos/convai.webp', maker: 'Convai Innovations', page: 'community/laya', shape: 'tile' },
  'openai/gpt-6-luna-decisions': { src: 'logos/openai.svg', maker: 'OpenAI', page: 'openai/gpt-6-luna-decisions', mono: true },
};

/**
 * Community models (by submission id) get the mark their makers use on their own profiles too: the model's maker
 * (Qwen, Liquid AI), the project's own icon (RizzoFlow), or its author's GitHub or Hugging Face avatar. The random
 * baseline gets a die.
 */
const COMMUNITY_LOGOS: Record<string, { src: string; shape?: 'round' | 'tile'; mono?: true }> = {
  semif: { src: 'logos/community/semif.png', shape: 'round' },
  'qwen-3-8-flash-next-nvfp4': { src: 'logos/community/qwen.svg' },
  'rizzo-flow': { src: 'logos/community/rizzo-flow.png' },
  'winnow-12b-nvfp4': { src: 'logos/community/eldanring.png', shape: 'round' },
  'd1-3b': { src: 'logos/community/liquid-ai.svg', mono: true },
  von: { src: 'logos/community/von.png', shape: 'round' },
  'random-dice': { src: 'logos/community/dice.svg' },
};

export const makerOf = (model: string): string | undefined => LOGOS[model]?.maker;

/** The model's page on opper.ai (its specs, prices and routes), for the models Opper serves. */
export const pageOf = (model: string): string | undefined => (LOGOS[model] ? `https://opper.ai/${LOGOS[model].page}` : undefined);

/** The model's maker mark as an <img>, or nothing for a model without one (say, a new community submission). */
export function logoFor(model: string): HTMLImageElement | null {
  const l = LOGOS[model] ?? COMMUNITY_LOGOS[model];
  if (!l) return null;
  const img = document.createElement('img');
  img.src = appPath(l.src);
  img.alt = '';
  img.className = `logo${l.shape ? ` ${l.shape}` : ''}${l.mono ? ' mono-mark' : ''}`; // a black mark turns white in dark mode
  img.width = 18;
  img.height = 18;
  return img;
}
