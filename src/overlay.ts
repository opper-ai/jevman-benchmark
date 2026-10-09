import type { Leaderboard } from '../shared/leaderboard';
import { boardOf } from '../shared/lineups';
import { boardLabel, type BoardEntry, type Boards } from './highscores';
import { modelName } from '../shared/models';
import { logoFor } from './logos';
import type { GameSummary } from './stats';
import { GHOST_IDS, type GhostId } from './types';
import { versus } from './versus';

/** Which model plays each ghost. */
export type Lineup = Record<GhostId, string>;

export const GHOST_NAMES: Record<GhostId, string> = { blinky: 'Blinky', pinky: 'Pinky', inky: 'Inky', clyde: 'Clyde' };
const GHOST_FILL: Record<GhostId, string> = { blinky: '#e53935', pinky: '#f48fb1', inky: '#26c6da', clyde: '#ffa726' };
/** The arcade's own ghost colours, for the picker's attract-screen roster. */
export const ARCADE_FILL: Record<GhostId, string> = { blinky: '#ff0000', pinky: '#ffb8ff', inky: '#00ffff', clyde: '#ffb852' };

/** The mixed lineup: a different AI behind each ghost, like the arcade original where every ghost had its own mind. */
const MIXED: Lineup = { blinky: 'opper/clef', pinky: 'typesafe/jev-1.13.0', inky: 'opper/kev-4b', clyde: 'openai/gpt-6-luna-decisions' };
const SOLO = ['typesafe/jev-1.13.0', 'opper/clef', 'opper/kev-4b', 'openai/gpt-6-luna-decisions'];

const allOf = (model: string): Lineup => Object.fromEntries(GHOST_IDS.map((g) => [g, model])) as Lineup;
const sameLineup = (a: Lineup, b: Lineup) => GHOST_IDS.every((g) => a[g] === b[g]);
const short = (model: string) => modelName(model).replace(/ 1\.13$/, '').replace(/ 4B$/, '');

/** The presets the picker offers, limited to the models this key can use. */
export function presets(offered: string[]): { key: string; label: string; lineup: Lineup }[] {
  const has = (m: string) => offered.includes(m);
  const out: { key: string; label: string; lineup: Lineup }[] = [];
  if (GHOST_IDS.every((g) => has(MIXED[g]))) out.push({ key: 'mixed', label: 'Mixed', lineup: MIXED });
  for (const m of SOLO) if (has(m)) out.push({ key: m, label: `All ${short(m)}`, lineup: allOf(m) });
  return out;
}

/** The lineup a new visitor starts with: mixed when every model in it is offered, else everyone on the first model. */
export const defaultLineup = (offered: string[]): Lineup => presets(offered)[0]?.lineup ?? allOf(offered[0]);

/** Tapping a ghost moves it to the next model on the list. */
export const nextModel = (current: string, offered: string[]): string => offered[(offered.indexOf(current) + 1) % offered.length];

/** "Clef, jev, Kev and GPT-6 Luna": the distinct models of a lineup, in ghost order. */
export function lineupNames(lineup: Lineup): string {
  const names = [...new Set(GHOST_IDS.map((g) => short(lineup[g])))];
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

/** A ghost in its arcade colour, for the picker, the game-over card and the activity log. */
export function ghostIcon(id: GhostId, fill = GHOST_FILL[id]): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('aria-hidden', 'true');
  const shape = (tag: string, attrs: Record<string, string>) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.append(e);
  };
  shape('path', { d: 'M1 13.2V6.4a6 6 0 0 1 12 0v6.8l-2-1.6-2 1.6-2-1.6-2 1.6-2-1.6Z', fill });
  for (const [cx, px] of [[4.9, 5.4], [9.3, 9.8]]) {
    shape('circle', { cx: String(cx), cy: '6.2', r: '1.7', fill: '#fff' });
    shape('circle', { cx: String(px), cy: '6.5', r: '0.85', fill: '#1f3fd8' });
  }
  return svg;
}

function show(root: HTMLElement, card: HTMLElement, focus?: HTMLElement): void {
  root.replaceChildren(card);
  root.hidden = false;
  focus?.focus({ preventScroll: true });
}

export function hideOverlay(root: HTMLElement): void {
  root.hidden = true;
  root.replaceChildren();
}

export interface PickerOptions {
  lineup: () => Lineup;
  offered: string[];
  /** Whether a game against AI ghosts can start (the free credits, a sign-in or a local key pay for it). */
  canPlay: boolean;
  /** Who pays, in a line under Start (or why nobody can). */
  costNote: string;
  loginAvailable: boolean;
  onChange: (lineup: Lineup) => void;
  onStart: () => void;
  onClassic: () => void;
  onLogin: () => void;
  onBack: () => void;
  /** The players' high-score boards, if they loaded: the picker shows the chosen lineup's. */
  boards: () => Boards | null;
}

export interface Picker {
  /** "Waking up …" on Start while the models wake; null restores it. */
  busy: (note: string | null) => void;
  /** A line under Start (e.g. a model that would not wake), or null to clear it. */
  note: (text: string | null) => void;
  /** What Space/Enter does. */
  action: () => void;
}

/** A board as dotted lines, as the roster draws them: place, initials, score; the player's own line in yellow. */
function boardLines(entries: BoardEntry[], limit: number, mine: number | null = null): HTMLOListElement {
  const list = el('ol', undefined, 'dots board');
  entries.slice(0, limit).forEach((e, i) => {
    const li = el('li', undefined, i + 1 === mine ? 'you' : undefined);
    li.style.setProperty('--gc', i + 1 === mine ? '#ffd800' : '#ffffff');
    const name = el('span', undefined, 'nm');
    name.append(el('span', `${i + 1}`, 'rk'), e.initials);
    const lead = el('span', undefined, 'lead');
    lead.setAttribute('aria-hidden', 'true');
    li.append(name, lead, el('span', e.score.toLocaleString('en-US'), 'num'));
    list.append(li);
  });
  return list;
}

/** Three letters, as on the cabinet: typed (A to Z), then ENTER. `submit` answers with an error, or null once it is in. */
function initialsForm(submit: (initials: string) => Promise<string | null>): HTMLFormElement {
  const form = el('form', undefined, 'initials');
  const input = el('input');
  input.type = 'text';
  input.maxLength = 3;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'characters');
  input.setAttribute('aria-label', 'Your initials, three letters');
  input.placeholder = '___';
  input.addEventListener('input', () => (input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)));
  const go = el('button', undefined, 'press');
  go.type = 'submit';
  const tri = el('span', undefined, 'tri');
  tri.setAttribute('aria-hidden', 'true');
  go.append(tri, el('span', 'Enter'));
  const status = el('p', undefined, 'tap');
  status.setAttribute('aria-live', 'polite');
  form.append(input, go, status);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!/^[A-Z]{3}$/.test(input.value)) {
      status.textContent = 'Three letters, A to Z';
      return input.focus();
    }
    go.disabled = true;
    status.textContent = 'Checking your game…';
    void submit(input.value).then((err) => {
      go.disabled = false;
      status.textContent = err ?? '';
    });
  });
  queueMicrotask(() => input.focus({ preventScroll: true }));
  return form;
}

/** What game over says about the boards, if the game was against a lineup's AIs. */
export type BoardEntryOption =
  | { kind: 'enter'; board: string; place: number; submit: (initials: string) => Promise<{ error: string } | { place: number | null; entries: BoardEntry[] }> }
  | { kind: 'custom' }
  | { kind: 'note'; text: string };

/** The "you made the board" block: the place, then the initials form. */
function boardBlock(o: BoardEntryOption): HTMLElement {
  const box = el('div', undefined, 'made');
  if (o.kind === 'custom' || o.kind === 'note') {
    box.append(el('p', o.kind === 'note' ? o.text : 'Only the preset lineups have a high-score board, so pick one to compete.', 'tap'));
    return box;
  }
  const label = boardLabel(o.board);
  box.append(el('p', o.place === 1 ? 'New high score!' : `You made the board · #${o.place}`, o.place === 1 ? 'made-title top' : 'made-title'), el('p', `vs ${label}`, 'made-board'));
  box.append(
    initialsForm(async (initials) => {
      const r = await o.submit(initials);
      if ('error' in r) return r.error;
      box.replaceChildren(el('p', r.place === null ? 'Just missed the board' : `#${r.place} on the ${label} board`, 'made-title'), boardLines(r.entries, 5, r.place));
      return null;
    }),
  );
  return box;
}

/**
 * The players' high-score boards, opened from HIGH SCORE: a tab per lineup, the AI's best game pinned above as the
 * one to beat (a different game, so it is pinned rather than ranked), the top ten, and a way to play for a place.
 */
export function showHighScores(root: HTMLElement, o: { boards: () => Boards | null; boardKeys: readonly string[]; initial: string; toBeat: { name: string; score: number } | null; onPlay: (board: string) => void; onClose: () => void }): { refresh: () => void } {
  const card = el('div', undefined, 'card arc over hsc');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'High scores');
  const close = el('button', 'X', 'x');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', o.onClose);
  const tabs = el('div', undefined, 'opts');
  tabs.setAttribute('role', 'tablist');
  const body = el('div', undefined, 'hs-body');
  let current = o.boardKeys.includes(o.initial) ? o.initial : o.boardKeys[0]!;
  const render = () => {
    tabs.replaceChildren(
      ...o.boardKeys.map((k) => {
        const b = el('button', boardLabel(k));
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(k === current));
        b.setAttribute('aria-pressed', String(k === current)); // the arcade options' marker style keys off this
        b.addEventListener('click', () => {
          current = k;
          render();
        });
        return b;
      }),
    );
    const boards = o.boards();
    const entries = boards?.[current] ?? [];
    const parts: HTMLElement[] = [];
    if (o.toBeat) {
      const beat = el('p', undefined, 'tobeat');
      beat.append(el('span', 'To beat'), el('span', `${o.toBeat.name} · ${o.toBeat.score.toLocaleString('en-US')}`));
      parts.push(beat);
    }
    if (entries.length) parts.push(boardLines(entries, 10));
    else parts.push(el('p', boards ? 'No scores yet. Be the first!' : 'High scores are loading…', 'tap'));
    const play = el('button', undefined, 'press');
    play.type = 'button';
    const tri = el('span', undefined, 'tri');
    tri.setAttribute('aria-hidden', 'true');
    play.append(tri, el('span', `Play vs ${boardLabel(current).replace(/^All /, '')}`));
    play.addEventListener('click', () => o.onPlay(current));
    parts.push(play);
    body.replaceChildren(...parts);
  };
  render();
  card.append(close, el('p', 'High scores', 'over-title hs-title'), el('p', 'Each lineup has its own board for players against the AI ghosts.', 'tap'), tabs, body);
  show(root, card, close);
  return { refresh: render };
}

/** A model's name on the arcade roster: short, and GPT-6 Luna as just Luna (its logo says OpenAI). */
const rosterName = (model: string) => short(model).replace(/^GPT-6 /, '');

/**
 * "Who plays the ghosts?", as the arcade's attract screen: one line per ghost in its colour, dotted across to its
 * model (a tap switches it), the lineups as arcade options, PRESS START, the cost, and the way back.
 */
export function showPicker(root: HTMLElement, o: PickerOptions): Picker {
  const card = el('div', undefined, 'card arc');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Who plays the ghosts?');
  const close = el('button', 'X', 'x');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', o.onBack);
  const head = el('div', undefined, 'colh');
  head.append(el('span', 'Ghost'), el('span', 'AI model'));
  card.append(close, el('p', 'Who plays the ghosts?', 'ttl'), head);
  const roster = el('ol', undefined, 'roster');
  const opts = el('div', undefined, 'opts');
  opts.setAttribute('role', 'group');
  opts.setAttribute('aria-label', 'Lineups');
  const all = presets(o.offered);
  const render = () => {
    const lineup = o.lineup();
    roster.replaceChildren(
      ...GHOST_IDS.map((g) => {
        const li = el('li');
        const b = el('button');
        b.type = 'button';
        b.style.setProperty('--gc', ARCADE_FILL[g]);
        b.setAttribute('aria-label', `${GHOST_NAMES[g]}: ${modelName(lineup[g])}. Switch model`);
        const md = el('span', undefined, 'md');
        const logo = logoFor(lineup[g]);
        if (logo) md.append(logo);
        md.append(rosterName(lineup[g]));
        const lead = el('span', undefined, 'lead');
        lead.setAttribute('aria-hidden', 'true');
        b.append(ghostIcon(g, ARCADE_FILL[g]), el('span', GHOST_NAMES[g], 'gn'), lead, md);
        b.addEventListener('click', () => {
          o.onChange({ ...lineup, [g]: nextModel(lineup[g], o.offered) });
          renderAll();
        });
        li.append(b);
        return li;
      }),
    );
    opts.replaceChildren(
      ...all.map((p) => {
        const b = el('button', p.label.replace(/GPT-6 /, ''));
        b.type = 'button';
        b.setAttribute('aria-pressed', String(sameLineup(p.lineup, lineup)));
        b.addEventListener('click', () => {
          o.onChange({ ...p.lineup });
          renderAll();
        });
        return b;
      }),
    );
  };
  const hs = el('div', undefined, 'hs');
  const renderBoard = () => {
    const key = boardOf(o.lineup());
    const boards = o.boards();
    if (!key) return hs.replaceChildren(el('p', 'High scores', 'colh'), el('p', 'Only the preset lineups have a board', 'tap'));
    const entries = boards?.[key] ?? [];
    hs.replaceChildren(el('p', `High scores · ${boardLabel(key)}`, 'colh'), entries.length ? boardLines(entries, 5) : el('p', boards ? 'No scores yet. Be the first!' : 'High scores are loading…', 'tap'));
  };
  const renderAll = () => {
    render();
    renderBoard();
  };
  renderAll();
  card.append(roster, el('p', 'Tap a ghost to switch its AI', 'tap'), opts, hs);
  const status = el('p', undefined, 'tap');
  status.setAttribute('aria-live', 'polite');
  // The marker blinks, the words stay: a button that blinks out entirely reads as broken.
  const press = (label: string) => {
    const b = el('button', undefined, 'press');
    b.type = 'button';
    const tri = el('span', '▶', 'tri');
    tri.setAttribute('aria-hidden', 'true');
    b.append(tri, el('span', label, 'lbl'));
    return b;
  };
  let start: HTMLButtonElement;
  if (o.canPlay) {
    start = press('Press start');
    start.addEventListener('click', o.onStart);
    card.append(start, el('p', o.costNote, 'cost'));
  } else {
    start = press('Sign in to play');
    start.disabled = !o.loginAvailable;
    start.addEventListener('click', o.onLogin);
    const classic = el('button', 'Play the classic ghosts instead (free)', 'back');
    classic.type = 'button';
    classic.addEventListener('click', o.onClassic);
    card.append(start, el('p', o.costNote, 'cost warn'), classic);
  }
  const back = el('button', 'Back to watching', 'back');
  back.type = 'button';
  back.addEventListener('click', o.onBack);
  card.append(status, back);
  show(root, card, start);
  const startLabel = start.querySelector<HTMLElement>('.lbl')!;
  return {
    busy: (note) => {
      if (!o.canPlay) return;
      start.toggleAttribute('aria-disabled', note !== null);
      startLabel.textContent = note ?? 'Press start';
    },
    note: (text) => {
      status.textContent = text ?? '';
    },
    action: () => start.click(),
  };
}

export interface GameOverOptions {
  summary: GameSummary;
  /** The ghosts' models in a game against AI ghosts; null for the classic ghosts. */
  lineup: Lineup | null;
  board: Leaderboard | null;
  newBest?: boolean;
  onPlayAgain: () => void;
  onShare: () => Promise<'shared' | 'copied' | 'failed' | 'cancelled'>;
  onReview: (() => void) | null;
  onBack: () => void;
  /** The players' boards: made one (enter initials), or a custom lineup's note. */
  entry?: BoardEntryOption | null;
}

/**
 * The game-over card, in the arcade's look like the picker: GAME OVER, the score, then who caught you (AI ghosts) or
 * where you'd rank among the models (classic ghosts), Play again and Share, and the way back.
 */
export function showGameOver(root: HTMLElement, o: GameOverOptions): void {
  const s = o.summary;
  const card = el('div', undefined, 'card arc over');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Game over');
  card.append(el('p', 'Game over', 'over-title'));
  if (o.newBest) card.append(el('p', 'New personal best', 'over-best'));
  card.append(el('p', s.score.toLocaleString('en-US'), 'over-score'));
  if (o.entry) card.append(boardBlock(o.entry));
  // A dotted line, as on the roster: name on the left, number on the right.
  const line = (left: (Node | string)[], right: string, color: string, cls = '') => {
    const li = el('li', undefined, cls || undefined);
    li.style.setProperty('--gc', color);
    const lead = el('span', undefined, 'lead');
    lead.setAttribute('aria-hidden', 'true');
    const name = el('span', undefined, 'nm');
    name.append(...left);
    li.append(name, lead, el('span', right, 'num'));
    return li;
  };
  if (o.lineup) {
    card.append(el('p', `You lasted ${clock(s.seconds)} against ${lineupNames(o.lineup)}`, 'tap'));
    const by = new Map<GhostId, number>();
    for (const d of s.deaths) if (d.ghost) by.set(d.ghost, (by.get(d.ghost) ?? 0) + 1);
    if (by.size) {
      const list = el('ul', undefined, 'dots');
      for (const [g, n] of [...by].sort((a, b) => b[1] - a[1])) list.append(line([ghostIcon(g, ARCADE_FILL[g]), `${GHOST_NAMES[g]} (${short(o.lineup[g])})`], `×${n}`, ARCADE_FILL[g]));
      card.append(el('p', 'Caught by', 'colh'), list);
    }
  } else if (o.board?.entries.length) {
    // The classic ghosts are the benchmark's own game: place the score among the models.
    const v = versus(o.board, s.score);
    card.append(el('p', v.beaten.length ? `You beat ${v.beaten.length} of ${v.total} AIs` : 'No AI beaten yet. Try again!', 'tap'));
    const rows = [...o.board.entries.map((e) => ({ name: e.name, model: e.model, score: e.meanScore })), { name: 'You', model: '', score: s.score }].sort((a, b) => b.score - a.score);
    const list = el('ol', undefined, 'dots');
    rows.forEach((r, i) => {
      const logo = r.model ? logoFor(r.model) : null;
      const left: (Node | string)[] = [el('span', `${i + 1}`, 'rk')];
      if (logo) left.push(logo);
      left.push(r.name);
      list.append(line(left, r.score.toLocaleString('en-US'), r.model ? (r.score < s.score ? '#ffffff' : '#6c7a96') : '#ffd800', r.model ? '' : 'you'));
    });
    card.append(list);
  }
  const btns = el('div', undefined, 'over-btns');
  const again = el('button', undefined, 'press');
  again.type = 'button';
  const tri = el('span', '▶', 'tri');
  tri.setAttribute('aria-hidden', 'true');
  again.append(tri, el('span', 'Play again'));
  again.addEventListener('click', o.onPlayAgain);
  const share = el('button', 'Share', 'press alt');
  share.type = 'button';
  share.addEventListener('click', () => {
    void o.onShare().then((r) => {
      if (r !== 'cancelled') share.textContent = r === 'copied' ? 'Copied!' : r === 'shared' ? 'Shared!' : 'Could not share';
    });
  });
  btns.append(again, share);
  card.append(btns);
  if (o.onReview) {
    const review = el('button', 'Review their moves', 'back');
    review.type = 'button';
    review.addEventListener('click', o.onReview);
    card.append(review);
  }
  const back = el('button', 'Back to watching', 'back');
  back.type = 'button';
  back.addEventListener('click', o.onBack);
  card.append(back);
  show(root, card, again);
}

/** What Share posts after a game against AI ghosts. */
export function aiShareText(s: GameSummary, lineup: Lineup, url: string): string {
  return `I lasted ${clock(s.seconds)} and scored ${s.score.toLocaleString('en-US')} at Pac-Man against ${lineupNames(lineup)} playing the ghosts 🟡\nCan you beat the AIs? ${url}`;
}
