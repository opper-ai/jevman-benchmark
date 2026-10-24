import type { Decision } from './brain';
import { ARCADE_FILL, GHOST_NAMES, ghostIcon, type Lineup } from './overlay';
import type { SchedulerEvent } from './scheduler';
import { fruitForLevel, type GameState, type Status } from './sim';
import { FRUIT_EMOJI } from './render';
import type { Dir, GhostId } from './types';
import { modelName, shortName } from '../shared/models';

const ARROW: Record<Dir, string> = { up: '↑', left: '←', down: '↓', right: '→' };
const DIR_NAME: Record<Dir, string> = { up: 'Up', left: 'Left', down: 'Down', right: 'Right' };
const GHOST_POINTS = new Set(['200', '400', '800', '1600']);
const MAX_ENTRIES = 120;

type Entry =
  | { kind: 'move'; t: number; actor: Decision['actor']; dir: Dir; p: number; alts: [Dir, number][]; ms: number | null }
  | { kind: 'backup'; t: number; actor: Decision['actor']; dir: Dir; reason: string }
  | { kind: 'death'; t: number; ghost: GhostId | null; lives: number }
  | { kind: 'gain'; t: number; k: 'ghost' | 'fruit' | 'level' | 'over'; icon: string; text: string; meta: string }
  | { kind: 'sep'; text: string };

/** Whose moves the log follows: an AI playing Pac-Man, or the AIs playing the ghosts against you. */
export interface Subject {
  /** pacman: an AI plays Pac-Man; ghosts: AIs play the ghosts against you; classic: you against the classic ghosts. */
  kind: 'pacman' | 'ghosts' | 'classic';
  /** The model playing Pac-Man, or the ghosts' models. */
  model?: string;
  /** The Pac-Man model's name, when it isn't one of ours (a community model's own). */
  name?: string;
  lineup?: Lineup;
  recorded?: boolean;
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

/**
 * The activity log: every decision the AI makes, with its odds, and the moments that matter (deaths, ghosts eaten,
 * fruit). Folded under the board by default: while playing, the arrows on the board are enough; it is the detail to
 * review afterwards.
 */
export class ActivityLog {
  private entries: Entry[] = [];
  private open = false;
  private filter: 'all' | 'key' = 'all';
  private subject: Subject = { kind: 'pacman' };
  private over = false;
  private totals = { moves: 0, backup: 0, calls: 0, latency: 0, cost: 0, dropped: 0 };
  private lastStatus: Status | null = null;
  private seenPopups = new Set<object>();
  private list: HTMLOListElement | null = null;
  private totalsEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private subEl: HTMLElement | null = null;
  private droppedEl: HTMLElement | null = null;

  /** `onOpenChange` lays the page out (the panel opens beside the board); the log only says when. */
  constructor(
    private readonly root: HTMLElement,
    private readonly opts: { onOpenChange?: (open: boolean) => void } = {},
  ) {
    this.render();
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** A new game (or a new loop of the recording): starts the log over. */
  begin(subject: Subject): void {
    this.subject = subject;
    this.entries = [{ kind: 'sep', text: subject.recorded ? 'Recorded benchmark game' : 'New game' }];
    this.totals = { moves: 0, backup: 0, calls: 0, latency: 0, cost: 0, dropped: 0 };
    this.lastStatus = null;
    this.seenPopups = new Set();
    this.over = false;
    this.render();
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.opts.onOpenChange?.(open);
  }

  /** The scheduler's events (or a recording's): calls for the totals, decisions for the list. */
  handle(e: SchedulerEvent, t: number): void {
    if (e.type === 'call') {
      this.totals.calls += 1;
      if (Number.isFinite(e.latencyMs)) this.totals.latency += e.latencyMs;
      if (e.costUsd !== null && Number.isFinite(e.costUsd)) this.totals.cost += e.costUsd;
      return this.renderTotals();
    }
    if (e.type === 'stale' || e.type === 'superseded') {
      this.totals.dropped += 1;
      return this.renderTotals();
    }
    if (e.type !== 'decision') return;
    const d = e.decision;
    if (d.source === 'fallback') {
      this.totals.backup += 1;
      return this.push({ kind: 'backup', t, actor: d.actor, dir: d.choice, reason: d.reason ?? 'no answer' });
    }
    this.totals.moves += 1;
    const p = d.probabilities[d.choice];
    const alts = d.options
      .filter((o) => o !== d.choice)
      .map((o): [Dir, number] => [o, Math.round((d.probabilities[o] ?? 0) * 100)])
      .sort((a, b) => b[1] - a[1]);
    this.push({ kind: 'move', t, actor: d.actor, dir: d.choice, p: p === undefined ? 100 : Math.round(p * 100), alts, ms: e.latencyMs });
  }

  /** The game's own moments, read off its state each frame: deaths, points from ghosts and fruit, levels, the end. */
  observe(state: GameState, t: number): void {
    for (const pop of state.popups) {
      if (this.seenPopups.has(pop)) continue;
      this.seenPopups.add(pop);
      // The icon: a frightened (blue) ghost for a ghost eaten, the level's own fruit for the fruit.
      this.push(GHOST_POINTS.has(pop.text) ? { kind: 'gain', t, k: 'ghost', icon: '', text: 'Ate a ghost', meta: `+${pop.text}` } : { kind: 'gain', t, k: 'fruit', icon: FRUIT_EMOJI[fruitForLevel(state.level).kind] ?? '+', text: 'Ate the fruit', meta: `+${pop.text}` });
    }
    if (state.popups.length === 0 && this.seenPopups.size > 50) this.seenPopups.clear();
    if (state.status === this.lastStatus) return;
    this.lastStatus = state.status;
    if (state.status === 'dying') this.push({ kind: 'death', t, ghost: state.caughtBy, lives: state.lives });
    if (state.status === 'levelclear') this.push({ kind: 'gain', t, k: 'level', icon: '★', text: `Cleared level ${state.level}`, meta: state.score.toLocaleString('en-US') });
    if (state.status === 'gameover') {
      this.push({ kind: 'gain', t, k: 'over', icon: '■', text: 'Game over', meta: `${state.score.toLocaleString('en-US')} points` });
      this.over = true;
      this.renderHead();
    }
  }

  private push(e: Entry): void {
    this.entries.unshift(e);
    if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES;
    if (this.list && this.visible(e)) {
      this.list.querySelector('.empty')?.remove();
      this.list.prepend(this.row(e, true));
      while (this.list.childElementCount > MAX_ENTRIES) this.list.lastElementChild!.remove();
    }
    this.renderTotals();
  }

  private visible(e: Entry): boolean {
    return this.filter === 'all' || (e.kind !== 'move' && e.kind !== 'backup');
  }

  private whoText(actor: Decision['actor']): string {
    if (actor === 'pacman') return '';
    const model = this.subject.lineup?.[actor];
    return `${GHOST_NAMES[actor]}${model ? ` · ${shortName(model)}` : ''}`;
  }

  private row(e: Entry, fresh = false): HTMLLIElement {
    if (e.kind === 'sep') return el('li', e.text, 'ev sep');
    const li = el('li', undefined, `ev ${e.kind}${e.kind === 'death' || e.kind === 'gain' ? ' key' : ''}${fresh ? ' new' : ''}`);
    const ic = el('span', undefined, 'ic');
    const tx = el('span', undefined, 'tx');
    let meta = '';
    if (e.kind === 'move' || e.kind === 'backup') {
      if (e.actor === 'pacman') ic.textContent = ARROW[e.dir];
      else ic.append(ghostIcon(e.actor, ARCADE_FILL[e.actor]));
      const who = this.whoText(e.actor);
      if (who) tx.append(el('span', who, 'who'));
      if (e.kind === 'move') {
        tx.append(el('b', `${e.actor === 'pacman' ? '' : `${ARROW[e.dir]} `}${DIR_NAME[e.dir]}`), el('span', `${e.p}%`, 'p'));
        if (e.alts.length) tx.append(el('span', e.alts.map(([d, p]) => `${d} ${p}%`).join(' · '), 'alt'));
        meta = e.ms === null ? '' : `${e.ms} ms`;
      } else {
        tx.append(`Backup rule went ${e.dir}`);
        meta = e.reason;
      }
    } else if (e.kind === 'death') {
      if (e.ghost) {
        ic.append(ghostIcon(e.ghost, ARCADE_FILL[e.ghost]));
        li.style.setProperty('--gc', ARCADE_FILL[e.ghost]); // the banner in the colour of the ghost that caught Pac-Man
      }
      const model = e.ghost ? this.subject.lineup?.[e.ghost] : undefined;
      tx.textContent = e.ghost ? `Caught by ${GHOST_NAMES[e.ghost]}${model ? ` (${shortName(model)})` : ''}` : 'Caught';
      // The life is taken when the dying animation ends, so `lives` still counts this one.
      meta = e.lives > 2 ? `${e.lives - 1} lives left` : e.lives === 2 ? '1 life left' : '';
    } else {
      li.dataset.k = e.k;
      if (e.k === 'ghost') ic.append(ghostIcon('inky', '#2121ff'));
      else ic.textContent = e.icon;
      tx.textContent = e.text;
      meta = e.meta;
    }
    li.append(el('span', 't' in e ? clock(e.t) : '', 'tm'), ic, tx, el('span', meta, 'mt'));
    return li;
  }

  private heading(): { title: string; sub: string } {
    if (this.subject.kind === 'ghosts') return { title: this.over ? 'Their moves' : 'AI moves', sub: 'What the AIs playing the ghosts decided at each junction. The arrows on the board show the same odds.' };
    if (this.subject.kind === 'classic') return { title: 'Your game', sub: 'The classic ghosts: no AI here, just the key moments.' };
    const name = this.subject.name ?? (this.subject.model ? modelName(this.subject.model) : 'The AI');
    return { title: 'Activity', sub: `What ${name} decides at each junction, with its odds. The arrows on the board show the same odds.` };
  }

  private renderHead(): void {
    if (!this.titleEl || !this.subEl) return;
    const { title, sub } = this.heading();
    this.titleEl.textContent = title;
    this.subEl.textContent = sub;
  }

  private renderTotals(): void {
    if (!this.totalsEl) return;
    const t = this.totals;
    const cells: [string, string][] = [
      ['Moves', t.moves.toLocaleString('en-US')],
      ['Backup', t.backup.toLocaleString('en-US')],
      ['Thinks in', t.calls ? `${Math.round(t.latency / t.calls)} ms` : '–'],
      ['Cost', `$${t.cost.toFixed(4)}`],
    ];
    // The same label-over-value cells as the game's score line, which they sit level with.
    this.totalsEl.replaceChildren(
      ...cells.map(([k, v]) => {
        const d = el('span');
        d.append(el('small', k), el('b', v));
        return d;
      }),
    );
    if (this.droppedEl) this.droppedEl.textContent = t.dropped ? `${t.dropped} late ${t.dropped === 1 ? 'answer' : 'answers'} skipped.` : '';
  }

  private fillList(): void {
    if (!this.list) return;
    const rows = this.entries.filter((e) => this.visible(e));
    this.list.replaceChildren(...rows.map((e) => this.row(e)));
    if (this.filter === 'key' && !rows.some((e) => e.kind !== 'sep')) this.list.append(el('li', 'No key moments yet. Deaths, ghosts eaten and fruit show up here.', 'ev sep empty'));
  }

  /**
   * The log beside the board, built once (games and filters only refill it, so opening it never jumps). Three rows
   * that line up with the game's: the title with the filter, the totals, and the moves, which end where the board ends.
   */
  private render(): void {
    if (!this.list) {
      const head = el('div', undefined, 'lg lg-head');
      this.titleEl = el('h3', undefined, 'lg-title');
      const close = el('button', 'X', 'close');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close the activity log');
      close.addEventListener('click', () => this.setOpen(false));
      const seg = el('div', undefined, 'seg');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Show');
      for (const [key, label] of [['all', 'Every move'], ['key', 'Key moments']] as const) {
        const b = el('button', label);
        b.type = 'button';
        b.dataset.filter = key;
        b.addEventListener('click', () => {
          this.filter = key;
          for (const x of seg.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x.dataset.filter === key));
          this.fillList();
        });
        seg.append(b);
      }
      head.append(this.titleEl, seg, close);
      const totals = el('div', undefined, 'lg lg-totals');
      this.totalsEl = el('div', undefined, 'hud');
      this.totalsEl.setAttribute('aria-label', 'Activity totals');
      totals.append(this.totalsEl);
      const listRow = el('div', undefined, 'lg lg-list');
      const inner = el('div', undefined, 'in');
      this.list = el('ol', undefined, 'log');
      const foot = el('p', undefined, 'lg-foot');
      this.subEl = el('span');
      this.droppedEl = el('span', undefined, 'dropped');
      foot.append(this.subEl, ' ', this.droppedEl);
      inner.append(this.list, foot);
      listRow.append(inner);
      this.root.replaceChildren(head, totals, listRow);
      for (const x of seg.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x.dataset.filter === this.filter));
    }
    this.renderHead();
    this.renderTotals();
    this.fillList();
  }
}
