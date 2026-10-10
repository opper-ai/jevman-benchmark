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
 * A model's mark (or, without one, its initial, so every name lines up). When the name links somewhere, the mark links
 * there too: a copy of the name's link, left out of the tab order and screen readers, where the name is the link.
 */
function markOf(e: LeaderboardEntry, name: HTMLElement): HTMLElement {
  const mark = logoFor(e.model) ?? el('span', e.name.trim().charAt(0).toUpperCase(), 'logo initial');
  if (!(name instanceof HTMLAnchorElement)) return mark;
  const a = name.cloneNode(false) as HTMLAnchorElement;
  a.className = 'logo-link';
  a.tabIndex = -1;
  a.setAttribute('aria-hidden', 'true');
  a.append(mark);
  return a;
}

/** The chevron on a phone row: down when closed, turned up when open. */
function chevron(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ class: 'chev', width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const path = document.createElementNS(ns, 'path');
  for (const [k, v] of Object.entries({ d: 'M4 6l4 4 4-4', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(k, v);
  svg.append(path);
  return svg;
}

/**
 * The leaderboard on the main page: rank (=1 for models tied within the margin of error), model and maker, mean
 * score with its margin, then survival, latency, backup moves, cost and who ran the games. Community models
 * (self-reported submissions) are ranked with our runs by mean score. `table` is the full table; `list` is the same
 * ranking for phones, a row per model that opens its numbers when tapped.
 */
export function renderLeaderboard(table: HTMLTableElement, list: HTMLElement, sub: HTMLElement, board: Leaderboard, community: Community | null): void {
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
  // Narrower than a laptop, Survival and Run by go (who ran it sits under the model's name); on phones only the rank
  // and model stay, with the score under the name too.
  for (const [label, cls] of [['#', ''], ['Model', ''], ['Mean score ± 95%', 'hide-n'], ['High score', 'r hide-n'], ['Survival', 'r hide-m'], ['Latency', 'r hide-n'], ['Backup moves', 'r hide-n'], ['Cost / game', 'r hide-n'], ['Run by', 'hide-m']]) {
    hr.append(el('th', label, cls || undefined));
  }
  head.append(hr);

  const row = (e: LeaderboardEntry, rank: string, opts: { tie: boolean; by?: string; url?: string }) => {
    const self = opts.by !== undefined;
    const tr = el('tr', undefined, [opts.tie ? 'tie' : '', self ? 'self' : ''].filter(Boolean).join(' ') || undefined);
    const mdl = el('div', undefined, 'mdl');
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
    mdl.append(markOf(e, name));
    const small = el('small', self ? undefined : (makerOf(e.model) ?? ''));
    if (self) {
      const runM = el('span', 'Run by ', 'show-m');
      runM.append(runBy(opts.by!));
      small.append(el('span', 'Community', 'hide-m'), runM);
    }
    who.append(name, small, el('span', `${e.meanScore.toLocaleString('en-US')} ${margin(e)}`, 'score-m'));
    mdl.append(who);
    const run = el('td', undefined, 'run hide-m');
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
      cell(`${e.meanSurvivedSeconds.toFixed(1)} s`, 'n r hide-m'),
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

  // Phones: rank, model, maker (or Community) and mean score per row; a tap opens the rest, one row at a time.
  const setOpen = (item: HTMLElement, open: boolean) => {
    item.classList.toggle('open', open);
    item.querySelector('.lbl-toggle')!.setAttribute('aria-expanded', String(open));
    item.querySelector<HTMLElement>('.lbl-d')!.hidden = !open;
  };
  const listItem = (e: LeaderboardEntry, rank: string, i: number, opts: { tie: boolean; by?: string; url?: string }) => {
    const self = opts.by !== undefined;
    const item = el('div', undefined, opts.tie ? 'lbl-row tie' : 'lbl-row');
    // The name links where the table's does; a tap anywhere else on the row (or its chevron button) opens the numbers.
    const page = self ? undefined : pageOf(e.model);
    const own = self && opts.url && /^https?:\/\//.test(opts.url) ? opts.url : undefined;
    const name = page
      ? tag(Object.assign(el('a', e.name, 'mname'), { href: page }), 'click_view_model', { source: 'leaderboard_mobile', model: e.model })
      : own
        ? tag(outLink(own, e.name, 'mname'), 'click_community_model', { source: 'leaderboard_mobile', model: e.model })
        : el('b', e.name, 'mname');
    const who = el('span', undefined, 'who');
    who.append(name, el('small', self ? 'Community' : (makerOf(e.model) ?? '')));
    const toggle = el('button', undefined, 'lbl-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', `lbl-${i}`);
    toggle.setAttribute('aria-label', `${e.name}: all numbers`);
    toggle.append(chevron());
    const head = tag(el('div', undefined, 'lbl-head'), 'click_leaderboard_row', { source: 'mobile', model: e.model });
    head.append(el('span', rank, 'rk'), markOf(e, name), who, el('span', e.meanScore.toLocaleString('en-US'), 'n'), toggle);
    const details = el('dl', undefined, 'lbl-d');
    details.id = `lbl-${i}`;
    details.hidden = true;
    const add = (label: string, value: string | Node) => {
      const dd = el('dd');
      dd.append(value);
      details.append(el('dt', label), dd);
    };
    add('Mean score ± 95%', `${e.meanScore.toLocaleString('en-US')} ${margin(e)}`);
    add('Best game', e.bestScore === undefined ? '–' : e.bestScore.toLocaleString('en-US'));
    add('Survival', `${e.meanSurvivedSeconds.toFixed(1)} s`);
    add('Latency', e.meanLatencyMs === null ? '–' : `${e.meanLatencyMs} ms`);
    add('Backup moves', `${(e.fallbackRate * 100).toFixed(1)}%`);
    add('Cost / game', e.costPerGame > 0 ? `$${e.costPerGame.toFixed(4)}` : '–');
    add('Run by', self ? runBy(opts.by!) : ranByUs());
    head.addEventListener('click', (ev) => {
      if (ev.target instanceof Element && ev.target.closest('a')) return; // the name's link
      const open = !item.classList.contains('open');
      for (const other of list.querySelectorAll<HTMLElement>('.lbl-row.open')) setOpen(other, false);
      setOpen(item, open);
    });
    item.append(head, details);
    return item;
  };
  const cols = el('div', undefined, 'lbl-cols');
  cols.append(el('span', '#', 'rk'), el('span', 'Model', 'grow'), el('span', 'Mean score'));
  list.replaceChildren(cols, ...all.map(({ e, by, url }, i) => listItem(e, tied.has(e) ? '=1' : String(i + 1), i, { tie: tied.has(e), by, url })));
}
