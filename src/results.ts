import { jointLeaders, type Community, type Leaderboard, type LeaderboardEntry, type ModelKind } from '../shared/leaderboard';
import { logoFor, makerOf, pageOf } from './logos';
import { tag, track } from './track';

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

/** What a row that isn't ranked is: a chat model or a baseline (rules, no model), shown at its score for reference. */
const REFERENCE: Partial<Record<ModelKind, { tag: string; tip: string }>> = {
  chat: { tag: 'Chat', tip: 'Chat model: an LLM that writes its answer. Shown at its score for reference, not ranked.' },
  rules: { tag: 'Base', tip: 'Baseline: no model, like hand-written rules or a die roll. Shown at its score for reference, not ranked.' },
};

// One tooltip for the tags, placed against the window so the table's scrolling box can't clip it. Hover or focus shows
// it; a click (a tap on phones) pins it until a click elsewhere, Escape, or a scroll.
let tip: HTMLElement | null = null;
let tipFor: HTMLButtonElement | null = null;
let pinned = false;
function showTip(button: HTMLButtonElement, text: string): void {
  if (!tip) {
    tip = el('div', undefined, 'kind-tip');
    tip.id = 'kind-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.append(tip);
    const close = () => hideTip(true);
    document.addEventListener('click', (e) => {
      if (!(e.target instanceof Element && e.target.closest('.kind-tag'))) close();
    });
    document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    window.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
  }
  tip.textContent = text;
  tip.hidden = false;
  tipFor?.removeAttribute('aria-describedby');
  tipFor = button;
  button.setAttribute('aria-describedby', 'kind-tip');
  const r = button.getBoundingClientRect();
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  tip.style.left = `${Math.max(12, Math.min(r.left, document.documentElement.clientWidth - width - 12))}px`;
  tip.style.top = `${r.bottom + 8 + height > window.innerHeight ? r.top - 8 - height : r.bottom + 8}px`;
}
function hideTip(force = false): void {
  if (!tip || (pinned && !force)) return;
  pinned = false;
  tip.hidden = true;
  tipFor?.removeAttribute('aria-describedby');
  tipFor = null;
}
/** The rank cell of a reference row: what it is instead of a number, explained on hover or a tap. */
function kindTag(kind: ModelKind): HTMLElement {
  const { tag: label, tip: text } = REFERENCE[kind]!;
  const b = el('button', label, 'kind-tag');
  b.type = 'button';
  b.addEventListener('mouseenter', () => !pinned && showTip(b, text));
  b.addEventListener('mouseleave', () => hideTip());
  b.addEventListener('focus', () => !pinned && showTip(b, text));
  b.addEventListener('blur', () => hideTip());
  b.addEventListener('click', (e) => {
    e.stopPropagation(); // on a phone row, a tap on the tag explains it instead of opening the row
    const open = !(pinned && tipFor === b);
    hideTip(true);
    if (open) {
      showTip(b, text);
      pinned = true;
    }
  });
  return b;
}

/**
 * What the leaderboard can be sorted by: its rank (the mean score) or one of its other numbers, each best first: the
 * highest score, the longest survival, the lowest latency, backup rate and cost. In the table's column order, after
 * # and Model; `head` is the column's name on phones.
 */
export const SORTS = [
  { key: 'rank', head: 'Mean score', best: 'descending' },
  { key: 'best', head: 'High score', best: 'descending' },
  { key: 'survival', head: 'Survival', best: 'descending' },
  { key: 'latency', head: 'Latency', best: 'ascending' },
  { key: 'backup', head: 'Backup moves', best: 'ascending' },
  { key: 'cost', head: 'Cost / game', best: 'ascending' },
] as const;
export type SortKey = (typeof SORTS)[number]['key'];

/** A row's number for a sort, lowest first; null when the model didn't report it (a self-reported run may not). */
const SORT_VALUE: Record<Exclude<SortKey, 'rank'>, (e: LeaderboardEntry) => number | null> = {
  best: (e) => (e.bestScore === undefined ? null : -e.bestScore),
  survival: (e) => -e.meanSurvivedSeconds,
  latency: (e) => e.meanLatencyMs,
  backup: (e) => e.fallbackRate,
  cost: (e) => (e.costPerGame > 0 ? e.costPerGame : null),
};

/**
 * The rows (in rank order) sorted by `key`, best first, or worst first when `reversed`. A missing number goes last
 * either way, and equal ones keep their rank order.
 */
export function sortRows<T extends { e: LeaderboardEntry }>(rows: readonly T[], key: SortKey, reversed = false): T[] {
  if (key === 'rank') return reversed ? [...rows].reverse() : [...rows];
  const value = SORT_VALUE[key];
  const sorted = [...rows].sort((a, b) => {
    const x = value(a.e);
    const y = value(b.e);
    return x === null ? (y === null ? 0 : 1) : y === null ? -1 : x - y;
  });
  if (!reversed) return sorted;
  const missing = sorted.filter((r) => value(r.e) === null);
  return [...sorted.filter((r) => value(r.e) !== null).reverse(), ...missing];
}

/** The number a phone row shows beside the name: the one the list is sorted by. */
const SHOWN: Record<SortKey, (e: LeaderboardEntry) => string> = {
  rank: (e) => e.meanScore.toLocaleString('en-US'),
  best: (e) => (e.bestScore === undefined ? '–' : e.bestScore.toLocaleString('en-US')),
  survival: (e) => `${e.meanSurvivedSeconds.toFixed(1)} s`,
  latency: (e) => (e.meanLatencyMs === null ? '–' : `${e.meanLatencyMs} ms`),
  backup: (e) => `${(e.fallbackRate * 100).toFixed(1)}%`,
  cost: (e) => (e.costPerGame > 0 ? `$${e.costPerGame.toFixed(4)}` : '–'),
};

/**
 * The leaderboard on the main page: rank (=1 for models tied within the margin of error), model and maker, mean
 * score with its margin, then survival, latency, backup moves, cost and who ran the games. Community models
 * (self-reported submissions) are ranked with our runs by mean score. Only decision models are ranked: chat models
 * and rules sit in the table at their score as reference rows, marked Chat or Base where the rank would be. `table`
 * is the full table; `list` is the same ranking for phones, a row per model that opens its numbers when tapped.
 * A click on a column's name sorts both by it (SORTS), best first, and a second click turns it round; # or the mean
 * score goes back to the rank, the default. The # column keeps the rank. On phones the list's number column picks the
 * sort from a menu.
 */
export function renderLeaderboard(table: HTMLTableElement, list: HTMLElement, sub: HTMLElement, board: Leaderboard, community: Community | null): void {
  // One table: our runs (all decision models) and the self-reported ones by mean score (ours first on an equal score).
  const all: { e: LeaderboardEntry; by?: string; url?: string; kind: ModelKind }[] = [...board.entries.map((e) => ({ e, kind: 'decision' as ModelKind })), ...(community?.entries ?? []).map((e) => ({ e, by: e.by, url: e.url, kind: e.kind }))];
  all.sort((a, b) => b.e.meanScore - a.e.meanScore);
  // The ranking counts decision models only, so a reference row between two of them takes no place.
  const ranked = all.filter((r) => r.kind === 'decision').map((r) => r.e);
  const tied = new Set(jointLeaders(ranked));
  const rankOf = (e: LeaderboardEntry) => (tied.has(e) ? '=1' : String(ranked.indexOf(e) + 1));
  // Every row's bar on one scale, the best mean in the table, so a reference row reads against the models.
  const top = Math.max(1, ...all.map((r) => r.e.meanScore));
  const date = new Date(board.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const lead = `${board.settings.gamesPerModel} games per model against the classic ghosts, last run on ${date}`;
  sub.replaceChildren(community?.entries.length ? `${lead}, ranked together with models the community ran. ` : `${lead}. `, tag(Object.assign(el('a', 'Add your model'), { href: 'https://github.com/opper-ai/jevman-benchmark/blob/main/CONTRIBUTING.md#benchmark-your-own-model', target: '_blank', rel: 'noopener' }), 'click_add_model', { source: 'leaderboard' }));

  const head = el('thead');
  const hr = el('tr');
  // Narrower than a laptop, Survival and Run by go (who ran it sits under the model's name); on phones only the rank
  // and model stay, with the score under the name too.
  // The columns that sort, by name; Model and Run by don't.
  const sortOf: Record<string, SortKey> = { '#': 'rank', 'Mean score ± 95%': 'rank', 'High score': 'best', Survival: 'survival', Latency: 'latency', 'Backup moves': 'backup', 'Cost / game': 'cost' };
  let current: { key: SortKey; reversed: boolean } = { key: 'rank', reversed: false };
  let draw = () => {};
  // Another column sorts best first; the same one again turns round.
  const pick = (key: SortKey, turn: boolean) => {
    current = { key, reversed: turn && current.key === key ? !current.reversed : false };
    draw();
  };
  for (const [label, cls] of [['#', ''], ['Model', ''], ['Mean score ± 95%', 'hide-n'], ['High score', 'r hide-n'], ['Survival', 'r hide-m'], ['Latency', 'r hide-n'], ['Backup moves', 'r hide-n'], ['Cost / game', 'r hide-n'], ['Run by', 'hide-m']]) {
    const th = el('th', undefined, cls || undefined);
    const key = sortOf[label];
    if (key) {
      const b = tag(el('button', label, 'sort'), 'click_leaderboard_sort', { source: 'leaderboard', sort: key });
      b.type = 'button';
      // Every sortable name keeps room for the arrow, shown only on the sorted one, so no column moves on a click.
      if (label !== '#') {
        const arrow = el('span', '↓', 'arr');
        arrow.setAttribute('aria-hidden', 'true');
        b.append(arrow);
      }
      b.addEventListener('click', () => pick(key, true));
      th.append(b);
    } else th.textContent = label;
    hr.append(th);
  }
  head.append(hr);

  const row = (e: LeaderboardEntry, opts: { tie: boolean; by?: string; url?: string; kind: ModelKind }) => {
    const self = opts.by !== undefined;
    const ref = opts.kind !== 'decision';
    const tr = el('tr', undefined, [opts.tie ? 'tie' : '', self ? 'self' : '', ref ? 'ref' : ''].filter(Boolean).join(' ') || undefined);
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
    const rk = el('td', undefined, 'rk');
    rk.append(ref ? kindTag(opts.kind) : rankOf(e));
    tr.append(
      rk,
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
  table.replaceChildren(head, body);

  // Phones: rank, model, maker (or Community) and mean score per row; a tap opens the rest, one row at a time.
  const setOpen = (item: HTMLElement, open: boolean) => {
    item.classList.toggle('open', open);
    item.querySelector('.lbl-toggle')!.setAttribute('aria-expanded', String(open));
    item.querySelector<HTMLElement>('.lbl-d')!.hidden = !open;
  };
  const listItem = (e: LeaderboardEntry, i: number, key: SortKey, opts: { tie: boolean; by?: string; url?: string; kind: ModelKind }) => {
    const self = opts.by !== undefined;
    const ref = opts.kind !== 'decision';
    const item = el('div', undefined, ['lbl-row', opts.tie ? 'tie' : '', ref ? 'ref' : ''].filter(Boolean).join(' '));
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
    const rk = el('span', undefined, 'rk');
    rk.append(ref ? kindTag(opts.kind) : rankOf(e));
    head.append(rk, markOf(e, name), who, el('span', SHOWN[key](e), 'n'), toggle);
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
  // Phones have no column names to click: the number column's name is a menu of the sorts.
  const cols = el('div', undefined, 'lbl-cols');
  const menu = el('select');
  menu.setAttribute('aria-label', 'Sort by');
  for (const s of SORTS) menu.append(Object.assign(el('option', s.head), { value: s.key }));
  menu.addEventListener('change', () => {
    track('click_leaderboard_sort', { source: 'leaderboard_mobile', sort: menu.value });
    pick(menu.value as SortKey, false);
  });
  const menuWrap = el('span', undefined, 'lbl-sort');
  menuWrap.append(menu);
  cols.append(el('span', '#', 'rk'), el('span', 'Model', 'grow'), menuWrap);

  draw = () => {
    const { key, reversed } = current;
    const rows = sortRows(all, key, reversed);
    const sort = SORTS.find((s) => s.key === key)!;
    const col = SORTS.indexOf(sort) + 2; // after # and Model
    const dir = reversed ? (sort.best === 'descending' ? 'ascending' : 'descending') : sort.best;
    [...hr.cells].forEach((th, i) => {
      const on = i === col;
      th.classList.toggle('sorted', on);
      if (on) th.setAttribute('aria-sort', dir);
      else th.removeAttribute('aria-sort');
      const arrow = th.querySelector('.arr');
      if (arrow && on) arrow.textContent = dir === 'descending' ? '↓' : '↑';
    });
    body.replaceChildren(...rows.map(({ e, by, url, kind }) => row(e, { tie: tied.has(e), by, url, kind })));
    for (const tr of body.rows) tr.cells[col]?.classList.add('sorted');
    menu.value = key;
    list.replaceChildren(cols, ...rows.map(({ e, by, url, kind }, i) => listItem(e, i, key, { tie: tied.has(e), by, url, kind })));
  };
  draw();
}
