import { jointLeaders, type Community, type Leaderboard, type LeaderboardEntry } from '../shared/leaderboard';
import { logoFor, makerOf, pageOf } from './logos';
import { tag } from './track';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

const margin = (e: LeaderboardEntry) => (e.scoreStdError === undefined ? '' : `± ${Math.round(2 * e.scoreStdError).toLocaleString('en-US')}`);

/** A link someone submitted (their model's page, their profile): opened in a new tab and marked as user-submitted. */
const outLink = (href: string, text: string, cls?: string) => Object.assign(el('a', text, cls), { href, target: '_blank', rel: 'noopener nofollow ugc' });

/** Who ran a community model: their GitHub profile (submissions come by pull request, `--by <github-handle>`). */
const runBy = (by: string) => (/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(by) ? tag(outLink(`https://github.com/${by}`, `@${by}`), 'click_github', { source: 'leaderboard_run_by' }) : el('span', by));

/** Our own runs: run by this repo's benchmark. */
const ranByUs = () => tag(Object.assign(el('a', '@opper-ai'), { href: 'https://github.com/opper-ai/jevman-benchmark', target: '_blank', rel: 'noopener' }), 'click_github', { source: 'leaderboard_run_by' });

/**
 * The leaderboard table on the main page: rank (=1 for models tied within the margin of error), model and maker, mean
 * score with its margin, then survival, latency, backup moves, cost and who ran the games. Community models
 * (self-reported submissions) are ranked with our runs by mean score.
 */
export function renderLeaderboard(table: HTMLTableElement, sub: HTMLElement, board: Leaderboard, community: Community | null): void {
  // One ranking: our runs and the self-reported ones by mean score (ours first on an equal score).
  const all: { e: LeaderboardEntry; by?: string; url?: string }[] = [...board.entries.map((e) => ({ e })), ...(community?.entries ?? []).map((e) => ({ e, by: e.by, url: e.url }))];
  all.sort((a, b) => b.e.meanScore - a.e.meanScore);
  const tied = new Set(jointLeaders(all.map((r) => r.e)));
  const top = Math.max(1, ...all.map((r) => r.e.meanScore));
  const date = new Date(board.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const lead = `${board.settings.gamesPerModel} games per model against the classic ghosts, last run on ${date}`;
  sub.replaceChildren(community?.entries.length ? `${lead}, ranked together with models the community ran. ` : `${lead}. `, tag(Object.assign(el('a', 'Add your model'), { href: 'https://github.com/opper-ai/jevman-benchmark/blob/main/CONTRIBUTING.md#benchmark-your-own-model', target: '_blank', rel: 'noopener' }), 'click_add_model', { source: 'leaderboard' }));

  const head = el('thead');
  const hr = el('tr');
  // On narrow screens only the rank and model stay: the score and who ran it sit under the model's name.
  for (const [label, cls] of [['#', ''], ['Model', ''], ['Mean score ± 95%', 'hide-n'], ['High score', 'r hide-n'], ['Survival', 'r hide-n'], ['Latency', 'r hide-n'], ['Backup moves', 'r hide-n'], ['Cost / game', 'r hide-n'], ['Run by', 'hide-n']]) {
    hr.append(el('th', label, cls || undefined));
  }
  head.append(hr);

  const row = (e: LeaderboardEntry, rank: string, opts: { tie: boolean; by?: string; url?: string }) => {
    const self = opts.by !== undefined;
    const tr = el('tr', undefined, [opts.tie ? 'tie' : '', self ? 'self' : ''].filter(Boolean).join(' ') || undefined);
    const mdl = el('div', undefined, 'mdl');
    // A model without a maker mark (a self-reported one) gets its initial, so every name lines up.
    mdl.append(logoFor(e.model) ?? el('span', e.name.trim().charAt(0).toUpperCase(), 'logo initial'));
    const who = el('div');
    // The name links to the model's page on opper.ai (specs, prices, routes), or for a self-reported model to the page
    // its submitter gave, if any.
    const page = self ? undefined : pageOf(e.model);
    const own = self && opts.url && /^https?:\/\//.test(opts.url) ? opts.url : undefined;
    const name = page
      ? tag(Object.assign(el('a', undefined, 'mname'), { href: page }), 'click_view_model', { source: 'leaderboard', model: e.model })
      : own
        ? tag(outLink(own, '', 'mname'), 'click_community_model', { source: 'leaderboard', model: e.model })
        : el('span', undefined, 'mname');
    name.append(el('b', e.name));
    const small = el('small', self ? undefined : (makerOf(e.model) ?? ''));
    if (self) {
      const runM = el('span', 'Run by ', 'show-n');
      runM.append(runBy(opts.by!));
      small.append(el('span', 'Community', 'hide-n'), runM);
    }
    who.append(name, small, el('span', `${e.meanScore.toLocaleString('en-US')} ${margin(e)}`, 'score-m'));
    mdl.append(who);
    const run = el('td', undefined, 'run hide-n');
    run.append(self ? runBy(opts.by!) : ranByUs());
    const scw = el('div', undefined, 'scw');
    const bar = el('span', undefined, 'bar');
    const fill = el('i');
    fill.style.width = `${((e.meanScore / top) * 100).toFixed(1)}%`;
    bar.append(fill);
    const n = el('span', `${e.meanScore.toLocaleString('en-US')} `, 'n');
    n.append(el('span', margin(e), 'pm'));
    scw.append(bar, n);
    const cell = (text: string, cls = 'n r hide-n') => el('td', text, cls);
    const tdModel = el('td');
    tdModel.append(mdl);
    const tdScore = el('td', undefined, 'hide-n');
    tdScore.append(scw);
    tr.append(
      el('td', rank, 'rk'),
      tdModel,
      tdScore,
      cell(e.bestScore === undefined ? '–' : e.bestScore.toLocaleString('en-US')), // the best single game; the ranking uses the mean
      cell(`${e.meanSurvivedSeconds.toFixed(1)} s`),
      cell(e.meanLatencyMs === null ? '–' : `${e.meanLatencyMs} ms`),
      cell(`${(e.fallbackRate * 100).toFixed(1)}%`),
      cell(`$${e.costPerGame.toFixed(4)}`),
      run,
    );
    return tr;
  };

  const body = el('tbody');
  all.forEach(({ e, by, url }, i) => body.append(row(e, tied.has(e) ? '=1' : String(i + 1), { tie: tied.has(e), by, url })));
  table.replaceChildren(head, body);
}
