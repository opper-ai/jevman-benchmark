/**
 * Plausible custom events, named as on opper.ai (snake_case, a `source` prop) and sent to its Plausible site, where
 * each one also carries the page it came from. Analytics never breaks the page.
 */
export type TrackProps = Record<string, string>;

export function track(event: string, props: TrackProps = {}): void {
  try {
    (window as unknown as { plausible?: (event: string, options: { props: TrackProps }) => void }).plausible?.(event, { props });
  } catch {
    // no analytics
  }
}

/** Marks an element so a click on it is tracked (see trackClicks): `event`, plus `source` and any other props. */
export function tag<T extends HTMLElement>(el: T, event: string, props: TrackProps): T {
  el.dataset.event = event;
  for (const [k, v] of Object.entries(props)) el.dataset[`track${k[0]!.toUpperCase()}${k.slice(1)}`] = v;
  return el;
}

/**
 * opper.ai's own navbar and footer sources (its layout-navbar-desktop.tsx, layout-navbar-mobile.tsx and
 * layout-footer.tsx), by link: the header and footer here are copies of the site's, so their clicks count as the
 * site's do. Keys are paths on opper.ai, `docs` for docs.opper.ai and `jevman` for this app.
 */
const NAV: Record<string, string> = {
  '/models': 'models',
  '/llm-leaderboard': 'rankings',
  '/apps': 'apps',
  '/ai-roundtable/chat': 'chat',
  '/ai-roundtable': 'roundtable',
  jevman: 'jevman',
  '/enterprise': 'enterprise',
  '/pricing': 'pricing',
  docs: 'docs',
  '/ai-control-plane': 'features_control_plane',
  '/llm-gateway': 'features_llm_gateway',
  '/llm-router': 'features_llm_router',
  '/ai-agent-sdk': 'features_agent_sdk',
  '/agent-cli': 'features_agent_cli',
  '/ai-wallet': 'features_ai_wallet',
  '/': 'logo',
};
/** The Chat menu's items (and the phone menu's Chat family list). */
const CHAT_MENU: Record<string, string> = {
  '/ai-roundtable/chat': 'chat_menu_chat',
  '/ai-roundtable': 'chat_menu_roundtable',
  '/ai-roundtable/history': 'chat_menu_history',
  '/ai-roundtable/stats': 'chat_menu_stats',
  jevman: 'chat_menu_jevman',
};
const FOOTER: Record<string, string> = {
  '/models': 'ecosystem_models', '/providers': 'ecosystem_providers', '/apps': 'ecosystem_apps', '/ai-roundtable': 'ecosystem_roundtable',
  '/compare': 'ecosystem_compare', '/models/eu': 'ecosystem_models_eu', '/llm-leaderboard': 'ecosystem_leaderboard',
  '/model-releases': 'ecosystem_releases', '/blog/car-wash-test': 'ecosystem_car_wash', '/real-world-benchmarks': 'ecosystem_real_world',
  '/ai-roundtable/chat': 'product_chat', '/media-studio': 'product_media_studio', '/pricing': 'product_pricing', '/enterprise': 'product_enterprise',
  '/ai-control-plane': 'product_control_plane', '/llm-gateway': 'product_llm_gateway', '/llm-router': 'product_llm_router',
  '/ai-agent-sdk': 'product_agent_sdk', '/agent-cli': 'product_agent_cli', '/ai-wallet': 'product_ai_wallet',
  '/ai-compliance': 'resources_compliance', '/sovereign-ai': 'resources_sovereign', docs: 'resources_docs', 'docs/v3-api-reference': 'resources_api_reference',
  '/mcp': 'resources_mcp', '/changelog': 'resources_changelog', '/blog': 'resources_blog', '/stories': 'resources_stories', '/uptime': 'resources_uptime',
  '/contact': 'resources_contact', '/openrouter-alternative': 'compare_openrouter', '/blog/openrouter-alternatives': 'compare_openrouter_alternatives',
  '/litellm-alternative': 'compare_litellm', '/blog/best-ai-gateways': 'compare_best_ai_gateways',
  '/legal': 'legal_hub', '/terms-of-service': 'legal_terms', '/privacy-policy': 'legal_privacy', '/security-overview': 'legal_security',
  '/data-processing-agreement': 'legal_dpa', '/llms.txt': 'legal_llms_txt', trust: 'legal_trust_center',
  'mailto:hello@opper.ai': 'email', 'github.com': 'social_github', 'discord.gg': 'social_discord', 'www.linkedin.com': 'social_linkedin', 'x.com': 'social_x',
};

/** The key a link has in the maps above. */
function linkKey(a: HTMLAnchorElement, home: string): string {
  if (a.protocol === 'mailto:') return a.href;
  const path = a.pathname.length > 1 ? a.pathname.replace(/\/+$/, '') : '/';
  if (a.host === location.host && a.pathname.startsWith(home)) return 'jevman';
  if (a.hostname === 'opper.ai') return path;
  if (a.hostname === 'docs.opper.ai') return path === '/' ? 'docs' : `docs${path}`;
  if (a.hostname === 'trust.opper.ai') return 'trust';
  return a.hostname;
}

/**
 * One listener for the whole page: a click on an element tagged with `tag` (or `data-event` in the HTML) sends that
 * event; a click on a link in the header, the phone menu or the footer sends opper.ai's click_nav or click_footer.
 */
export function trackClicks(home: string): void {
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const tagged = target?.closest<HTMLElement>('[data-event]');
      if (tagged) {
        const props: TrackProps = {};
        for (const [k, v] of Object.entries(tagged.dataset)) if (k.startsWith('track') && v !== undefined) props[k[5]!.toLowerCase() + k.slice(6)] = v;
        return track(tagged.dataset.event!, props);
      }
      const a = target?.closest('a');
      if (!a) return;
      const key = linkKey(a, home);
      if (a.closest('.oc-footer')) {
        const source = FOOTER[key];
        if (source) track('click_footer', { source });
        return;
      }
      const phone = a.closest('#oc-drawer') !== null;
      if (!phone && !a.closest('.oc-header')) return;
      // A Chat-menu item has a description under its title; in the phone menu the Chat family is a list of its own.
      const inMenu = phone ? a.closest('#oc-fam') !== null : a.querySelector('p') !== null;
      const source = (inMenu ? CHAT_MENU[key] : undefined) ?? NAV[key];
      if (source) track('click_nav', { source: phone ? `${source}_mobile` : source });
    },
    { capture: true },
  );
}
