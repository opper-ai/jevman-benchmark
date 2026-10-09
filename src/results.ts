import { jointLeaders, type Community, type Leaderboard, type LeaderboardEntry } from '../shared/leaderboard';
import { logoFor, makerOf, pageOf } from './logos';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

const margin = (e: LeaderboardEntry) => (e.scoreStdError === undefined ? '' : `± ${Math.round(2 * e.scoreStdError).toLocaleString('en-US')}`);

/**
 * The leaderboard table on the main page: rank (=1 for models tied within the margin of error), model and maker, mean
 * score with its margin, then survival, latency, backup moves and cost. Watch plays that model. Self-reported
 * submissions are ranked with our runs by mean score, marked as such.
 */
export function renderLeaderboard(table: HTMLTableElement, sub: HTMLElement, board: Leaderboard, community: Community | null, onWatch: (model: string) => void, canWatch: (model: string) => boolean): void {
  // One ranking: our runs and the self-reported ones by mean score (ours first on an equal score).
  const all: { e: LeaderboardEntry; by?: string }[] = [...board.entries.map((e) => ({ e })), ...(community?.entries ?? []).map((e) => ({ e, by: e.by }))];
  all.sort((a, b) => b.e.meanScore - a.e.meanScore);
  const tied = new Set(jointLeaders(all.map((r) => r.e)));
  const top = Math.max(1, ...all.map((r) => r.e.meanScore));
  const date = new Date(board.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  sub.textContent = `${board.settings.gamesPerModel} games per model against the classic ghosts, last run on ${date}.${community?.entries.length ? ' Self-reported models are ranked alongside: their makers ran the games, and CI replayed each one.' : ''}`;

  const head = el('thead');
  const hr = el('tr');
  for (const [label, cls] of [['#', ''], ['Model', ''], ['Mean score ± 95%', ''], ['High score', 'r hide-n'], ['Survival', 'r hide-n'], ['Latency', 'r hide-n'], ['Backup moves', 'r hide-n'], ['Cost / game', 'r hide-n'], ['', '']]) {
    hr.append(el('th', label, cls || undefined));
  }
  head.append(hr);

  const row = (e: LeaderboardEntry, rank: string, opts: { tie: boolean; by?: string; self?: boolean }) => {
    const tr = el('tr', undefined, [opts.tie ? 'tie' : '', opts.self ? 'self' : ''].filter(Boolean).join(' ') || undefined);
    const mdl = el('div', undefined, 'mdl');
    const logo = logoFor(e.model);
    if (logo) mdl.append(logo);
    const who = el('div');
    // The name links to the model's page on opper.ai (specs, prices, routes); a self-reported model has none.
    const page = opts.self ? undefined : pageOf(e.model);
    const name = page ? Object.assign(el('a', undefined, 'mname'), { href: page }) : el('span', undefined, 'mname');
    name.append(el('b', e.name));
    who.append(name, el('small', opts.self ? `Self-reported by ${opts.by}` : (makerOf(e.model) ?? '')), el('span', `${e.meanScore.toLocaleString('en-US')} ${margin(e)}`, 'score-m'));
    mdl.append(who);
    const scw = el('div', undefined, 'scw');
    const bar = el('span', undefined, 'bar');
    const fill = el('i');
    fill.style.width = `${((e.meanScore / top) * 100).toFixed(1)}%`;
    bar.append(fill);
    const n = el('span', `${e.meanScore.toLocaleString('en-US')} `, 'n');
    n.append(el('span', margin(e), 'pm'));
    scw.append(bar, n);
    const cell = (text: string, cls = 'n r hide-n') => el('td', text, cls);
    const act = el('td', undefined, 'act');
    if (canWatch(e.model)) {
      const watch = el('button', 'Watch');
      watch.type = 'button';
      watch.setAttribute('aria-label', `Watch ${e.name} play`);
      watch.addEventListener('click', () => onWatch(e.model));
      act.append(watch);
    }
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
      act,
    );
    return tr;
  };

  const body = el('tbody');
  all.forEach(({ e, by }, i) => body.append(row(e, tied.has(e) ? '=1' : String(i + 1), { tie: tied.has(e), by, self: by !== undefined })));
  // The "Mean score" column hides on narrow screens; the score then sits under the model's name.
  head.querySelector('th:nth-child(3)')!.className = 'hide-n';
  table.replaceChildren(head, body);
}
