import { ActivityLog, type Subject } from './activity';
import { accountNotice, fetchMe, POOL_EMPTY_NOTICE, poolAmount, renderAccount, renderDrawerAccount, signIn, takeAuthError, updatePoolAmount, walletNotice, type AccountView } from './auth';
import { initialChoice, modelOptions, requestModel, type ModelChoice } from './choice';
import { DemoPlayer, loadRecording } from './demo';
import { greedyChoice, optionFeatures } from './features';
import { logoFor } from './logos';
import { boardLabel, enterScore, fetchBoards, placeFor, type Boards } from './highscores';
import { aiShareText, defaultLineup, GHOST_NAMES, hideOverlay, lineupNames, showGameOver, showHighScores, showPicker, type BoardEntryOption, type Lineup, type Picker } from './overlay';
import { appPath, SHARE_URL } from './paths';
import { drawGame, FRUIT_EMOJI, TILE } from './render';
import { renderLeaderboard } from './results';
import { Scheduler } from './scheduler';
import { createGame, fruitForLevel, jevActors, step, type Controls, type GameState } from './sim';
import { cuesBetween, snapshot, Sound } from './sound';
import { RECORDINGS, TOP_RECORDED_SCORE, watchName } from './recordings';
import { CLIPS } from './clips';
import { checkPlayerGame } from './player-check';
import { Recorder, roundDt, type Recording } from './replay';
import { GameStats } from './stats';
import { Thinking } from './thinking';
import { attachTouch } from './touch';
import { tag, track, trackClicks } from './track';
import { createHttpTransport, warmUp, type TransportHooks } from './transport';
import { GHOST_IDS, type Dir } from './types';
import { shareText, versus } from './versus';
import { ModelWarming } from './warming';
import type { Community, Leaderboard } from '../shared/leaderboard';
import { BOARD_KEYS, boardOf, MIXED_LINEUP } from '../shared/lineups';
import { DEFAULT_MODEL, modelName } from '../shared/models';

trackClicks(appPath('/'));
/** A game's props for Plausible: AI ghosts (and which lineup) or the classic ghosts. */
const gameProps = (l: Lineup | null) => ({ game: 'jevman', mode: l ? 'ai_ghosts' : 'classic', lineup: l ? (boardOf(l) ?? 'custom') : 'classic' });
const scoreBand = (score: number) => (score < 1000 ? '0-999' : score < 3000 ? '1000-2999' : score < 6000 ? '3000-5999' : '6000+');

const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
};
/** Chip order under the board: the leaderboard's, ours and the community's together, once it loads (till then, the recordings'). */
let watchOrder = Object.keys(RECORDINGS);
const LINEUP_KEY = 'jevman.ghosts';
const BEST_KEY = 'jevman.best';
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// Watch plays recorded benchmark games, one per model, fetched the first time each is picked. jev's downloads
// alongside /api/me: it plays when the page opens, for everyone.
const recordingLoads = new Map<string, Promise<Recording | null>>();
const loadFor = (model: string): Promise<Recording | null> => {
  let p = recordingLoads.get(model);
  if (!p) {
    p = loadRecording(appPath(RECORDINGS[model]?.path ?? ''), 8000);
    recordingLoads.set(model, p);
    // A failed download can be tried again on the next click.
    void p.then((r) => r ?? recordingLoads.delete(model));
  }
  return p;
};
const firstLoad = loadFor(DEFAULT_MODEL);
const me = await fetchMe();
const authError = takeAuthError();
const rec = await firstLoad;
const loaded = new Map<string, Recording>(rec ? [[DEFAULT_MODEL, rec]] : []);

const canvas = $<HTMLCanvasElement>('#game');
let state: GameState = createGame();
canvas.width = state.maze.width * TILE;
canvas.height = state.maze.height * TILE;
const ctx = canvas.getContext('2d')!;
const boardEl = $('.board');
const overlayEl = $('#overlay');
const playCta = $<HTMLButtonElement>('#play-cta');
const playLabel = $('#play-label');
const plateLabel = $('#plate-label');
const scoreEl = $('#score');
const hiEl = $('#hi-score');
const hiTip = $('#hi-tip');
const ghostsEl = $('#ghosts-label');
const livesEl = $('#lives');
const fruitEl = $('#fruit');
const noticeEl = $('#notice');
const soundBtn = $<HTMLButtonElement>('#sound');
/** Arcade sounds, on unless the visitor muted them (remembered). Browsers keep them silent until the first click or key. */
const sound = new Sound();
const showSound = () => {
  soundBtn.classList.toggle('off', !sound.enabled);
  soundBtn.setAttribute('aria-pressed', String(sound.enabled));
  soundBtn.setAttribute('aria-label', sound.enabled ? 'Mute (M)' : 'Sound on (M)');
};
showSound();
const toggleSound = () => {
  sound.toggle();
  sound.unlock();
  showSound();
};
soundBtn.addEventListener('click', toggleSound);
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const) window.addEventListener(ev, () => sound.unlock(), { passive: true });
const swipePad = $('#swipe-pad');
const chipsEl = $('#watch-chips');
const thinking = new Thinking();
const LOG_KEY = 'jevman.log';
const tvEl = $('#tv');
const tvGameEl = $('.tv-game');
const logTab = $<HTMLButtonElement>('#log-tab');
/** The activity log is a drawer: its tab pulls it out beside the card (below it on narrower screens); remembered. */
const log = new ActivityLog($('#activity'), {
  onOpenChange: (open) => {
    tvEl.classList.toggle('log-open', open);
    logTab.setAttribute('aria-expanded', String(open));
    try {
      localStorage.setItem(LOG_KEY, open ? '1' : '0');
    } catch {
      // not remembered
    }
  },
});
logTab.addEventListener('click', () => log.setOpen(true));
try {
  if (localStorage.getItem(LOG_KEY) === '1') log.setOpen(true);
} catch {
  // folded, as for everyone new
}

// The phone menu: opper.ai's sheet from the bottom.
const drawer = $('#oc-drawer');
const menuButton = document.getElementById('oc-menu-button');
const setDrawer = (open: boolean) => {
  drawer.hidden = !open;
  menuButton?.setAttribute('aria-expanded', String(open));
};
menuButton?.addEventListener('click', () => setDrawer(drawer.hidden !== false));
// Its first row is the product you're on; the chevron beside it shows the family (Chat, Roundtable, jevman).
const famToggle = $<HTMLButtonElement>('#oc-fam-toggle');
famToggle.addEventListener('click', () => {
  const open = famToggle.getAttribute('aria-expanded') !== 'true';
  famToggle.setAttribute('aria-expanded', String(open));
  $('#oc-fam').hidden = !open;
});
drawer.addEventListener('click', (e) => {
  if ((e.target as Element).closest('[data-close], a')) setDrawer(false);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !drawer.hidden) setDrawer(false);
});

// ---------- the account, top right ----------
const accountEl = $('#account');
let account: AccountView = {
  kind: me.mode === 'player' ? 'player' : me.mode === 'pool' ? 'pool' : me.mode === 'dev' ? 'dev' : me.pool ? 'pool-empty' : 'signed-out',
  me,
};
const showAccount = (view: AccountView) => {
  account = view;
  renderAccount(accountEl, view);
  renderDrawerAccount($('#oc-drawer-account'), view);
};
showAccount({ ...account, notice: accountNotice(me, authError, false) });
// The free credits tick down while people play: refresh the amount now and then, while the page is in view.
if (me.mode === 'pool') {
  setInterval(() => {
    if (document.hidden || account.kind !== 'pool') return;
    void fetchMe().then((fresh) => {
      if (account.kind !== 'pool') return;
      if (fresh.mode === 'pool') {
        updatePoolAmount(accountEl, fresh.pool?.remainingUsd ?? null);
        updatePoolAmount($('#oc-drawer-account'), fresh.pool?.remainingUsd ?? null);
      }
      else if (fresh.mode === 'none' && fresh.pool && !fresh.unavailable) showAccount({ kind: 'pool-empty', me: fresh });
    });
  }, 60_000);
}

let noticeTimer = 0;
/** A note over the top of the board (so nothing below it moves), gone after a while. */
const notice = (text: string | null) => {
  noticeEl.textContent = text ?? '';
  noticeEl.hidden = !text;
  clearTimeout(noticeTimer);
  if (text) noticeTimer = window.setTimeout(() => (noticeEl.hidden = true), 10_000);
};

// ---------- models ----------
const offered = modelOptions(me).map((o) => o.id);
const defaultModel = me.defaultModel ?? DEFAULT_MODEL;
/** Whether live AI games can be paid for: the free credits, a signed-in player's wallet, or a local key. */
let canUseAI = me.mode !== 'none';
const base: ModelChoice = initialChoice(me, null);
let choice: ModelChoice = { ...base };

function loadLineup(): Lineup {
  try {
    const saved = JSON.parse(localStorage.getItem(LINEUP_KEY) ?? 'null') as Partial<Lineup> | null;
    if (saved && GHOST_IDS.every((g) => typeof saved[g] === 'string' && offered.includes(saved[g]!))) return saved as Lineup;
  } catch {
    // nothing stored, or blocked storage
  }
  return defaultLineup(offered);
}
let lineup: Lineup = loadLineup();
const saveLineup = (l: Lineup) => {
  try {
    localStorage.setItem(LINEUP_KEY, JSON.stringify(l));
  } catch {
    // not remembered
  }
};

// ---------- calls ----------
let poolNoticeShown = false;
const hooks: TransportHooks = {
  onPoolEmpty: () => {
    canUseAI = false;
    if (poolNoticeShown) return;
    poolNoticeShown = true;
    showAccount({ kind: 'pool-empty', me: { ...me, mode: 'none', pool: { open: false, remainingUsd: 0 } } });
    notice(`${POOL_EMPTY_NOTICE} Until you do, the AIs fall back to a simple rule.`);
  },
  onSignedOut: () => {
    canUseAI = me.mode === 'pool';
    showAccount({ kind: me.pool ? 'pool' : 'signed-out', me });
    notice('Your Opper sign-in has expired. Sign in again to keep playing on your account.');
  },
  onWalletEmpty: (url) => {
    showAccount({ ...account, ...walletNotice(url) });
    notice('Your Opper wallet is empty. Top it up to keep playing.');
  },
};
const transport = createHttpTransport(hooks);
const warmProblems = new Map<string, string>();
const warming = new ModelWarming({
  warmUp: async (m) => {
    const r = await warmUp(m === defaultModel ? undefined : m, hooks);
    if (r.ok) warmProblems.delete(m);
    else if (r.account) warmProblems.set(m, r.error);
    return r.ok;
  },
  now: () => Date.now(),
});
const problemOf = (models: string[]) => models.map((m) => warmProblems.get(m)).find((p) => p !== undefined);

// ---------- what is on the board ----------
type Mode = { kind: 'recording'; model: string } | { kind: 'play'; lineup: Lineup | null };
let mode: Mode = { kind: 'recording', model: DEFAULT_MODEL };
let demo: DemoPlayer | null = null;
/** Whether a live game runs (anything but a recording). */
let live = false;
let paused = false;
/** The game on the board waits while the ghost picker is open, and carries on when it closes. */
let held = false;
let gameId = 0;
let gameOverShown = false;
/** Seconds of play in the live game, and in the recording on the board (each recording keeps its place, below). */
let playT = 0;
let recordingT = 0;
let clockMs = 0;
let last = performance.now();
let picker: Picker | null = null;
/** What Space/Enter does while a card is open. */
let overlayAction: (() => void) | null = null;

let stats = new GameStats();
const slots = { inFlight: 0 };
const newScheduler = (gameStats: GameStats) =>
  new Scheduler({
    transport,
    slots,
    // Four ghosts on four different models are four requests at once.
    maxInFlight: 4,
    // A player's game: a question queued behind slow requests falls back in time too, so no ghost waits long.
    timeoutFrom: 'queue',
    actors: jevActors,
    modelFor: (actor) => requestModel(choice, actor, defaultModel),
    now: () => clockMs,
    onEvent: (e) => {
      if (gameStats !== stats) return; // an answer for a game that has ended
      if (e.type === 'call' && e.model) warming.touch(e.model === 'jev-1.13.0' ? DEFAULT_MODEL : e.model);
      log.handle(e, playT);
      if (e.type === 'decision') thinking.add(e.decision, performance.now());
      stats.onSchedulerEvent(e);
    },
  });
let scheduler = newScheduler(stats);
// The characters no AI plays follow the classic rules.
/** Your game against AI ghosts, recorded as it is played (steering, steps, the ghosts' answers) for the high-score check. */
let recorder: Recorder | null = null;
let recFrame = 0;
/** A recorded game's steps so far, and the time not yet stepped (it steps at FIXED_STEP). */
let recSteps = 0;
let stepAcc = 0;
const FIXED_STEP = roundDt(1 / 60);
const controls: Controls = {
  decide: (point, s) => (jevActors(s).includes(point.actor) ? scheduler.decide(point, s) : greedyChoice(s, point, optionFeatures(s, point))),
};
/** The controls a step uses: through the recorder in your own game against AI ghosts, so their answers are kept. */
const recorded: Controls = { decide: (point, st) => (recorder ? recorderControls.decide(point, st) : controls.decide(point, st)) };
const recorderControls: Controls = {
  decide: (point, st) => {
    const choice = controls.decide(point, st);
    if (choice !== null && recorder) {
      // Where the move came from: the server's signature on a model's answer, else the backup rule ("f").
      const d = scheduler.lastDecision;
      const signed = d && d.key === point.key && d.source !== 'fallback' && d.sig && d.signedAs;
      recorder.decisions.push([recFrame, point.key, choice, signed ? `${d.signedAs}~${d.sig}` : 'f']);
    }
    return choice;
  },
};

const short = (model: string) => modelName(model).replace(/ 1\.13$/, '').replace(/^Microsoft /, '');
/** The top strip, as on the cabinet: who plays Pac-Man over the score (or a status line), and the ghosts where 2UP is. */
function setPlate(label: string | null = null): void {
  if (label !== null) {
    plateLabel.textContent = label;
    return;
  }
  plateLabel.textContent = mode.kind === 'recording' ? watchName(mode.model) : 'You';
  const lineup = mode.kind === 'play' ? mode.lineup : null;
  const models = lineup ? [...new Set(GHOST_IDS.map((g) => lineup[g]))] : [];
  ghostsEl.textContent = !lineup ? 'Classic' : models.length === 1 ? short(models[0]!) : 'Mixed AIs';
}

function renderChips(): void {
  const current = mode.kind === 'recording' ? mode.model : null;
  chipsEl.replaceChildren(
    ...watchOrder.filter((m) => RECORDINGS[m] !== undefined).map((m) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(m === current));
      const logo = logoFor(m);
      if (logo) chip.append(logo);
      chip.append(watchName(m));
      chip.title = `${watchName(m)}'s recorded benchmark game`;
      tag(chip, 'click_watch', { source: 'chips', model: m });
      chip.addEventListener('click', () => watch(m));
      return m === current && CLIPS[m] ? withDownload(m, chip) : chip;
    }),
  );
  syncSave();
}

// ---------- the watched game's highlight, to save ----------
// Two ways to the same two files: the ↓ beside Sound on the board, and the ↓ on the chip being watched.
const saveBtn = $<HTMLButtonElement>('#save');
const saveMenu = $('#save-menu');
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
const make = <K extends keyof HTMLElementTagNameMap>(tagName: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tagName);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
function downloadIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ width: '15', height: '15', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const path = document.createElementNS(ns, 'path');
  for (const [k, v] of Object.entries({ d: 'M8 2.5V10M5 7.2l3 3 3-3M3 13h10', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(k, v);
  svg.append(path);
  return svg;
}
/** A link that downloads the model's highlight (the 18 s MP4 or the 10 s GIF), counted as click_download. */
function clipLink(model: string, format: 'mp4' | 'gif', source: string): HTMLAnchorElement {
  const clip = CLIPS[model]!;
  const a = make('a');
  a.href = appPath(`/clips/${clip.file}.${format}`);
  a.download = `jevman-${clip.file}-highlight.${format}`;
  return tag(a, 'click_download', { source, model, format });
}

/** The board's ↓ shows while a recording with a highlight plays; a new game or another model closes its menu. */
function syncSave(): void {
  const watching = mode.kind === 'recording' && CLIPS[mode.model] ? mode.model : null;
  saveBtn.hidden = watching === null;
  if (watching) saveBtn.setAttribute('aria-label', `Save ${watchName(watching)}'s highlight`);
  closeSave();
}
function closeSave(): void {
  saveMenu.hidden = true;
  saveBtn.setAttribute('aria-expanded', 'false');
}
function openSave(): void {
  if (mode.kind !== 'recording' || !CLIPS[mode.model]) return;
  const model = mode.model;
  const fmts = make('div', undefined, 'fmts');
  fmts.append(Object.assign(clipLink(model, 'mp4', 'board'), { textContent: 'MP4' }), Object.assign(clipLink(model, 'gif', 'board'), { textContent: 'GIF' }));
  saveMenu.replaceChildren(make('p', 'Save this game', 't'), make('p', 'Its best 18 seconds', 's'), fmts);
  saveMenu.setAttribute('aria-label', `Save ${watchName(model)}'s highlight`);
  saveMenu.hidden = false;
  saveBtn.setAttribute('aria-expanded', 'true');
}
saveBtn.addEventListener('click', () => (saveMenu.hidden ? openSave() : closeSave()));
// Picking a file starts its download and closes the menu.
saveMenu.addEventListener('click', (e) => {
  if ((e.target as Element).closest('a')) setTimeout(closeSave);
});

/** The chip being watched, with a ↓ behind it that opens the same two files in the page's own look. */
function withDownload(model: string, chip: HTMLButtonElement): HTMLElement {
  const name = watchName(model);
  const clip = CLIPS[model]!;
  const pick = make('span', undefined, 'chip-pick');
  const dl = make('button', undefined, 'chip-dl');
  dl.type = 'button';
  dl.setAttribute('aria-label', `Save ${name}'s highlight`);
  dl.setAttribute('aria-haspopup', 'true');
  dl.setAttribute('aria-expanded', 'false');
  dl.setAttribute('aria-controls', 'chip-menu');
  dl.append(downloadIcon());
  const menu = make('div', undefined, 'chip-menu');
  menu.id = 'chip-menu';
  menu.hidden = true;
  const item = (format: 'mp4' | 'gif', label: string, meta: string) => {
    const a = clipLink(model, format, 'chips');
    a.append(downloadIcon(), make('b', label), make('small', meta));
    return a;
  };
  menu.append(make('p', `${name}'s best 18 seconds`, 't'), item('mp4', 'Video', `MP4 · ${mb(clip.mp4)}`), item('gif', 'GIF', `10 s · ${mb(clip.gif)}`));
  dl.addEventListener('click', () => setChipMenu(menu.hidden !== false));
  menu.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) setTimeout(() => setChipMenu(false));
  });
  pick.append(chip, dl, menu);
  return pick;
}
/** Opens or closes the watched chip's menu, kept inside the window on a narrow screen. */
function setChipMenu(open: boolean): void {
  const menu = chipsEl.querySelector<HTMLElement>('.chip-menu');
  const dl = chipsEl.querySelector<HTMLElement>('.chip-dl');
  if (!menu || !dl) return;
  menu.hidden = !open;
  dl.setAttribute('aria-expanded', String(open));
  if (!open) return;
  menu.style.left = '0px';
  const over = menu.getBoundingClientRect().right - (document.documentElement.clientWidth - 12);
  if (over > 0) menu.style.left = `${-over}px`;
}
const chipMenuOpen = () => chipsEl.querySelector('.chip-menu:not([hidden])') !== null;

const setPaused = (p: boolean) => {
  paused = p;
  syncPlayCta();
};
/** The button under the board: "Play vs AI" while watching; "New game" while your own game is paused; else out of the way. */
function syncPlayCta(): void {
  const midGame = mode.kind === 'play' && live && !gameOverShown;
  playCta.hidden = picker !== null || scoresOpen || (mode.kind === 'play' && !(midGame && paused));
  playLabel.textContent = midGame ? 'New game' : 'Play vs AI';
}
const dim = (on: boolean) => boardEl.classList.toggle('dim', on);

/** Ends whatever was running: answers still in flight reach the old scheduler and are ignored. */
function retire(): void {
  gameId += 1;
  scheduler.reset();
  stats = new GameStats();
  scheduler = newScheduler(stats);
  thinking.clear();
  live = false;
}

/** One player per recording, so coming back to a model picks its game up where it was instead of starting over. */
const players = new Map<string, { player: DemoPlayer; t: number }>();
/** Before the board changes: the recording on it keeps its place. */
function leaveRecording(): void {
  if (mode.kind === 'recording') {
    const p = players.get(mode.model);
    if (p) p.t = recordingT;
  }
}

/** A model's recorded benchmark game (jev's when the page opens). Costs nothing: no model is called. */
function showRecording(model: string = mode.kind === 'recording' ? mode.model : DEFAULT_MODEL): void {
  const r = loaded.get(model) ?? loaded.get(DEFAULT_MODEL);
  if (r && !loaded.has(model)) model = DEFAULT_MODEL;
  leaveRecording();
  retire();
  watchToken += 1;
  held = false;
  picker = null;
  overlayAction = null;
  hideOverlay(overlayEl);
  dim(false);
  mode = { kind: 'recording', model };
  setPaused(false);
  const subject: Subject = { kind: 'pacman', model, recorded: true, name: RECORDINGS[model]?.name };
  if (r) {
    let entry = players.get(model);
    if (!entry) {
      const fresh: { player: DemoPlayer; t: number } = {
        t: 0,
        player: new DemoPlayer(r, {
          onLoop: () => {
            recordingT = 0;
            thinking.clear();
            log.begin(subject);
            sound.play('start');
          },
        }),
      };
      entry = fresh;
      players.set(model, entry);
    }
    demo = entry.player;
    recordingT = entry.t;
    state = demo.state;
    log.begin(subject);
  } else {
    demo = null;
    state = createGame();
  }
  setPlate();
  renderChips();
}

/** A live game: an AI playing Pac-Man (watch), or you against AI ghosts or the classic ghosts (play). */
function startGame(next: Exclude<Mode, { kind: 'recording' }>): void {
  leaveRecording();
  retire();
  watchToken += 1;
  held = false;
  demo = null;
  picker = null;
  overlayAction = null;
  mode = next;
  track('game_start', gameProps(next.lineup));
  choice = next.lineup ? { ...base, ...next.lineup } : { ...base };
  state = createGame({ pacmanControl: 'keyboard', ghostsByAI: next.lineup !== null });
  recorder = next.lineup ? new Recorder() : null;
  recFrame = 0;
  recSteps = 0;
  stepAcc = 0;
  log.begin(next.lineup ? { kind: 'ghosts', lineup: next.lineup } : { kind: 'classic' });
  hideOverlay(overlayEl);
  dim(false);
  gameOverShown = false;
  playT = 0;
  live = true;
  setPaused(document.hidden);
  sound.play('start');
  setPlate();
  renderChips();
}

/** Bumped whenever the board changes, so a recording that finishes downloading late doesn't take over. */
let watchToken = 0;
/** The high-score boards are open over the board (from HIGH SCORE). */
let scoresOpen = false;

/**
 * A chip under the board: that model's recorded benchmark game. The chip already
 * showing does nothing; in the middle of your own game it asks first.
 */
function watch(model: string, confirmed = false): void {
  if (scoresOpen) closeScores();
  if (mode.kind === 'recording' && mode.model === model) return;
  if (!confirmed && mode.kind === 'play' && live && !gameOverShown) return askToLeave(model);
  notice(null);
  if (loaded.has(model)) return showRecording(model);
  const token = ++watchToken;
  setPlate(`Loading ${watchName(model)}'s game…`);
  void loadFor(model).then((r) => {
    if (token !== watchToken) return; // something else went on the board meanwhile
    setPlate();
    if (!r) return notice(`${watchName(model)}'s recorded game didn't load. Try again in a moment.`);
    loaded.set(model, r);
    showRecording(model);
  });
}

/** Watching another model would throw your game away: pause, and ask. */
function askToLeave(model: string): void {
  setPaused(true);
  const end = Object.assign(document.createElement('button'), { type: 'button', textContent: 'End game' });
  const keep = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Keep playing' });
  end.addEventListener('click', () => watch(model, true));
  keep.addEventListener('click', () => {
    notice(null);
    setPaused(false);
  });
  notice(null);
  noticeEl.append(`End your game and watch ${watchName(model)}? `, end, ' · ', keep);
  noticeEl.hidden = false;
}

const costNote = (): string => {
  if (!canUseAI) return `${account.kind === 'pool-empty' ? 'The free credits are used up. ' : ''}Sign in to play on your own Opper account, at about 2¢ a game.`;
  if (account.kind === 'player') return 'This plays on your Opper account, at about 2¢ a game.';
  if (account.kind === 'dev') return 'On the local key from .env.';
  const left = poolAmount(account.me.pool?.remainingUsd ?? null);
  return `Free while the shared credits last${left ? ` (${left} left)` : ''}, at about 2¢ a game.`;
};

/** "▶ Play against the AIs": who plays the ghosts, then Start. */
function openPicker(): void {
  if (picker || scoresOpen) return;
  watchToken += 1; // a recording still loading must not replace the picker when it arrives
  setPlate();
  held = true;
  notice(null);
  dim(true);
  const ghostModels = () => [...new Set(GHOST_IDS.map((g) => lineup[g]))];
  const p = showPicker(overlayEl, {
    lineup: () => lineup,
    offered,
    canPlay: canUseAI,
    costNote: costNote(),
    loginAvailable: me.loginAvailable,
    onChange: (l) => {
      lineup = l;
      saveLineup(l);
      // Wake them while the player is still choosing: one tiny call each.
      if (canUseAI) for (const m of ghostModels()) void warming.warm(m);
    },
    onStart: () => {
      const l = { ...lineup };
      const models = ghostModels();
      const id = gameId;
      // The button says it short; the line under it names who is waking.
      void warming.warmAll(() => models, (cold) => { p.busy('Waking up…'); p.note(`Waking up ${cold.map(short).join(' and ')}`); }).then((failed) => {
        if (id !== gameId || picker !== p) return; // closed or replaced meanwhile
        const awake = models.filter((m) => !failed.includes(m));
        if (!awake.length) {
          p.busy(null);
          return p.note(problemOf(failed) ?? `${failed.map(modelName).join(' and ')} didn't wake up in time. Try again in a moment.`);
        }
        // One sleepy model shouldn't hold up the game: an awake one plays its ghosts this time.
        const stand = awake.includes(defaultModel) ? defaultModel : awake[0];
        const played = Object.fromEntries(GHOST_IDS.map((g) => [g, failed.includes(l[g]) ? stand : l[g]])) as Lineup;
        startGame({ kind: 'play', lineup: played });
        const stood = GHOST_IDS.filter((g) => played[g] !== l[g]).map((g) => GHOST_NAMES[g]);
        if (stood.length) notice(`${failed.map(modelName).join(' and ')} didn't wake up in time, so ${modelName(stand)} plays ${stood.join(' and ')} this game.`);
      });
    },
    onClassic: () => startGame({ kind: 'play', lineup: null }),
    onLogin: () => {
      track('click_login', { source: 'picker' });
      signIn();
    },
    onBack: closePicker,
    boards: () => boards,
  });
  picker = p;
  overlayAction = p.action;
  syncPlayCta();
  if (canUseAI) for (const m of ghostModels()) void warming.warm(m);
}
function closePicker(): void {
  held = false;
  picker = null;
  overlayAction = null;
  hideOverlay(overlayEl);
  dim(false);
  syncPlayCta();
}

// ---------- game over ----------
let board: Leaderboard | null = null;
/** The players' high-score boards, once loaded (and after each entry). */
let boards: Boards | null = null;
void fetchBoards().then((b) => {
  if (b) boards = b;
});
/** The best game any model played (the leaderboard's high score), until the leaderboard loads the best recorded one. */
let topAiScore = TOP_RECORDED_SCORE;
const readBest = (): number => {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeBest = (score: number) => {
  knownBest = score;
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // not remembered
  }
};
/** Read once, then kept up to date: the high score shows it every frame. */
let knownBest = readBest();
const touchScreen = matchMedia('(pointer: coarse)').matches;
// The theme follows the system while the visitor hasn't picked one on opper.ai (index.html sets it before the first paint).
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  let picked: string | null = null;
  try {
    picked = localStorage.getItem('theme');
  } catch {
    // storage blocked: follow the system
  }
  if (picked !== 'dark' && picked !== 'light') document.documentElement.classList.toggle('dark', e.matches);
});
/** The system share sheet on phones (where people share from), else the clipboard. */
async function shareScore(text: string): Promise<'shared' | 'copied' | 'failed' | 'cancelled'> {
  if (navigator.share && touchScreen) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

function gameOver(): void {
  gameOverShown = true;
  dim(true);
  const summary = stats.summary(state);
  if (mode.kind !== 'play') return;
  const l = mode.lineup;
  track('game_over', { ...gameProps(l), score: scoreBand(summary.score) });
  let newBest = false;
  if (!l) {
    // The classic ghosts are the benchmark's own game: a personal best counts there.
    newBest = summary.score > readBest();
    if (newBest) writeBest(summary.score);
  }
  const again = () => startGame({ kind: 'play', lineup: l });
  overlayAction = again;
  showGameOver(overlayEl, {
    summary,
    lineup: l,
    board,
    newBest,
    entry: l ? boardEntry(l, summary.score) : null,
    onPlayAgain: again,
    onShare: async () => {
      const result = await shareScore(l ? aiShareText(summary, l, SHARE_URL) : board ? shareText(versus(board, summary.score), SHARE_URL) : `I scored ${summary.score} at JevMan 🟡 ${SHARE_URL}`);
      track('click_share', { source: 'game_over', result });
      return result;
    },
    onReview: l
      ? () => {
          log.setOpen(true); // the drawer slides out; the page stays where it is
        }
      : null,
    onBack: () => showRecording(),
  });
}

/**
 * The cabinet's HIGH SCORE and who holds it: the best single game a model played in the benchmark, a player's best
 * on a board, your own best against the classic ghosts, or the game you are playing once it passes them all.
 */
function highScore(): { score: number; who: string } {
  const best = board?.entries.reduce<{ score: number; name: string } | null>((b, e) => ((e.bestScore ?? 0) > (b?.score ?? 0) ? { score: e.bestScore!, name: e.name } : b), null);
  let hi = best && best.score >= TOP_RECORDED_SCORE ? { score: best.score, who: `Held by ${best.name}, its best benchmark game` } : { score: TOP_RECORDED_SCORE, who: 'Held by jev 1.13, a recorded benchmark game' };
  for (const [key, list] of Object.entries(boards ?? {})) {
    const top = list[0];
    if (top && top.score > hi.score) hi = { score: top.score, who: `Held by ${top.initials}, vs ${boardLabel(key)}` };
  }
  if (knownBest > hi.score) hi = { score: knownBest, who: 'Held by you, against the classic ghosts' };
  if (mode.kind === 'play' && live && state.score > hi.score) hi = { score: state.score, who: "That's you, this game!" };
  return hi;
}

/** HIGH SCORE, clicked: the players' boards over the board, opened on the lineup last picked; the game waits meanwhile. */
function openScores(): void {
  if (picker || scoresOpen || !overlayEl.hidden) return;
  watchToken += 1; // a recording still loading must not replace the boards when it arrives
  setPlate();
  scoresOpen = true;
  held = true;
  dim(true);
  tvEl.classList.add('scores-open');
  syncPlayCta();
  const best = board?.entries.reduce<{ score: number; name: string } | null>((b, e) => ((e.bestScore ?? 0) > (b?.score ?? 0) ? { score: e.bestScore!, name: e.name } : b), null);
  const view = showHighScores(overlayEl, {
    boards: () => boards,
    boardKeys: BOARD_KEYS,
    initial: boardOf(lineup) ?? 'mixed',
    toBeat: best ? { name: best.name, score: best.score } : { name: 'jev 1.13', score: TOP_RECORDED_SCORE },
    onPlay: (key) => {
      lineup = key === 'mixed' ? { ...MIXED_LINEUP } : (Object.fromEntries(GHOST_IDS.map((g) => [g, key])) as Lineup);
      saveLineup(lineup);
      closeScores();
      openPicker();
    },
    onClose: closeScores,
  });
  void fetchBoards().then((b) => {
    if (b && scoresOpen) {
      boards = b;
      view.refresh();
    }
  });
}
function closeScores(): void {
  if (!scoresOpen) return;
  scoresOpen = false;
  held = false;
  hideOverlay(overlayEl);
  dim(false);
  tvEl.classList.remove('scores-open');
  syncPlayCta();
}
const hiCell = $('.arcade-top .mid');
hiCell.addEventListener('click', openScores);
hiCell.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openScores();
  }
});

/** Game over against a lineup: on its board's top ten, enter initials (signed in or not); or a custom mix's note. */
function boardEntry(l: Lineup, score: number): BoardEntryOption | null {
  const key = boardOf(l);
  if (!key) return { kind: 'custom' };
  // Not loaded (the server couldn't read them): no entry this game, and try again for the next one.
  if (!boards) void fetchBoards().then((b) => {
    if (b) boards = b;
  });
  const place = placeFor(boards, key, score);
  const rec = recorder ? { ...recorder.finish(state, 'player', { pacmanControl: 'keyboard', ghostsByAI: true, lineup: l }), fixedStep: FIXED_STEP, steps: recSteps, final: { score: state.score, lives: state.lives, level: state.level, frames: recSteps } } : undefined;
  if (place === null || !rec) return null;
  // The server's check, run here first (all but the signatures, which only the server can verify): a game it would
  // refuse (the AIs answered too slowly too often) says so now, not after typing initials.
  const precheck = checkPlayerGame(rec, () => true);
  if (!precheck.ok) return { kind: 'note', text: "The AIs answered too slowly too often this game, so it can't go on the board. Try another one!" };
  return { kind: 'enter', board: key, place, submit: (initials) => submitScore(key, initials, rec) };
}

async function submitScore(key: string, initials: string, rec: Recording): Promise<{ error: string } | { place: number | null; entries: Boards[string] }> {
  const r = await enterScore(key, initials, rec);
  if (!r.ok) return { error: r.error };
  track('highscore_entered', { board: key, place: r.place === null ? 'none' : String(r.place) });
  boards = r.boards;
  return { place: r.place, entries: r.boards[key] ?? [] };
}

// ---------- controls ----------
function togglePause(): void {
  if (!overlayEl.hidden) return;
  if (paused && live) {
    // Models doze off during a long pause: wake them before the game goes on.
    const id = gameId;
    const models = [...new Set(jevActors(state).map((a) => choice[a]))];
    setPlate('Waking up…');
    void warming.warmAll(() => models, () => {}).then((failed) => {
      if (id !== gameId) return;
      setPlate();
      if (failed.length) return notice(problemOf(failed) ?? 'The AIs did not wake up, so the game stays paused. Click the board or press P to try again.');
      setPaused(false);
    });
    return;
  }
  setPaused(!paused);
}
// A click on the game pauses it, another resumes (not on its cards, the Play button, the sound or save buttons, the
// save menu or a note). With the save menu open, a click on the game only closes the menu.
boardEl.addEventListener('click', (e) => {
  const t = e.target as Element;
  // A target no longer in the page was a card's button that just started a game: not a click on the game itself.
  if (!t.isConnected || t.closest('.overlay, .play-cta, .board-notice, .sound-btn, .save-menu')) return;
  if (!saveMenu.hidden) return closeSave();
  togglePause();
});
tag(playCta, 'click_play', { source: 'board' });
playCta.addEventListener('click', openPicker);
// A click anywhere outside the picker's card closes it, on the board or the page. (It runs after the board's own
// handler, which leaves clicks on the overlay alone; a target no longer in the page was a card the picker replaced.)
document.addEventListener('click', (e) => {
  const t = e.target as Element;
  if (picker && t.isConnected && !t.closest('.overlay .card, #play-cta')) closePicker();
  if (scoresOpen && t.isConnected && !t.closest('.overlay .card, .arcade-top .mid')) closeScores();
  // The save menus close on a click anywhere else (the board's own handler closes its menu over the game).
  if (!saveMenu.hidden && t.isConnected && !t.closest('.board')) closeSave();
  if (chipMenuOpen() && t.isConnected && !t.closest('.chip-pick')) setChipMenu(false);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && live && !paused && overlayEl.hidden) setPaused(true);
});
const steer = (dir: Dir) => {
  if (live && state.pacmanControl === 'keyboard') state.keyDir = dir;
};
attachTouch(tvGameEl, steer, () => live && state.pacmanControl === 'keyboard' && overlayEl.hidden === true);

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || typeof e.key !== 'string') return;
  if (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const dir = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
  if (dir && live && state.pacmanControl === 'keyboard' && overlayEl.hidden === true) {
    steer(dir);
    e.preventDefault();
    return;
  }
  if (e.repeat) return;
  const onControl = e.target instanceof Element && e.target.closest('a, button, input, select, textarea, summary, [tabindex]') !== null;
  if ((e.key === ' ' || e.key === 'Enter') && !onControl) {
    if (overlayAction) {
      e.preventDefault();
      overlayAction();
    } else if (mode.kind !== 'play' && overlayEl.hidden) {
      e.preventDefault();
      openPicker();
    }
    return;
  }
  if (e.key === 'Escape' && (!saveMenu.hidden || chipMenuOpen())) {
    closeSave();
    return setChipMenu(false);
  }
  if (e.key === 'Escape' && picker) return closePicker();
  if (e.key === 'Escape' && scoresOpen) return closeScores();
  const k = e.key.toLowerCase();
  if (k === 'p') togglePause();
  else if (k === 'm') toggleSound();
});

// ---------- the leaderboard below ----------
const NO_SUBMISSIONS: Community = { generatedAt: '', benchVersion: 0, entries: [] };
void Promise.all([
  fetch(appPath('/leaderboard.json')).then((r) => (r.ok ? (r.json() as Promise<Leaderboard>) : null)),
  fetch(appPath('/community.json'))
    .then((r) => (r.ok ? (r.json() as Promise<Community>) : NO_SUBMISSIONS))
    .catch(() => NO_SUBMISSIONS),
])
  .then(([b, community]) => {
    if (!b) return;
    board = b;
    // The cabinet's HIGH SCORE: the best single game any model played in the benchmark.
    topAiScore = Math.max(TOP_RECORDED_SCORE, ...b.entries.map((e) => e.bestScore ?? 0));
    renderLeaderboard($<HTMLTableElement>('#leaderboard-table'), $('#leaderboard-list'), $('#leaderboard-sub'), b, community);
    // The chips in the leaderboard's order: by mean score, ours first on an equal one (as the table ranks them).
    const ranked = [...b.entries, ...community.entries].sort((x, y) => y.meanScore - x.meanScore).map((e) => e.model);
    watchOrder = [...ranked.filter((m) => RECORDINGS[m] !== undefined), ...Object.keys(RECORDINGS).filter((m) => !ranked.includes(m))];
    renderChips();
  })
  .catch(() => {
    $('#leaderboard-sub').textContent = 'The leaderboard could not be loaded. Try again in a moment.';
  });

// ---------- the frame loop ----------
function tick(dt: number): void {
  const heard = snapshot(state);
  if (demo) {
    for (const e of demo.advance(dt)) {
      log.handle(e, recordingT);
      if (e.type === 'decision') thinking.add(e.decision, performance.now());
    }
    state = demo.state;
    for (const cue of cuesBetween(heard, state)) sound.play(cue);
    if (state.status === 'playing') recordingT += dt;
    return;
  }
  if (!live || gameOverShown) return;
  clockMs += dt * 1000;
  scheduler.update(state);
  stats.beforeStep(state);
  if (recorder) {
    // A recorded game (yours against AI ghosts) steps at a fixed 60 a second, whatever the screen's refresh rate, so
    // the server's replay takes exactly the same steps and a long game on a fast screen is no bigger.
    stepAcc = Math.min(stepAcc + dt, FIXED_STEP * 4);
    while (stepAcc >= FIXED_STEP && state.status !== 'gameover') {
      stepAcc -= FIXED_STEP;
      recFrame = recSteps;
      recorder.key(recFrame, state.keyDir);
      step(state, FIXED_STEP, recorded);
      recorder.settle(state.keyDir);
      recSteps += 1;
      stats.afterStep(state, FIXED_STEP);
      if (state.status === 'playing') playT += FIXED_STEP;
      stats.beforeStep(state);
      scheduler.update(state);
    }
    for (const cue of cuesBetween(heard, state)) sound.play(cue);
    if (state.status === 'gameover') gameOver();
    return;
  }
  const stepDt = roundDt(dt);
  step(state, stepDt, recorded);
  stats.afterStep(state, stepDt);
  for (const cue of cuesBetween(heard, state)) sound.play(cue);
  if (state.status === 'playing') playT += dt;
  if (state.status === 'gameover') gameOver();
}

const setText = (el: HTMLElement, text: string) => {
  if (el.textContent !== text) el.textContent = text;
};
let shownLives = -1;
function frame(now: number): void {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  if (!paused && !held) tick(dt);
  drawGame(ctx, state, now / 1000, paused);
  if (state.status === 'playing' && !paused) thinking.draw(ctx, now);
  log.observe(state, demo ? recordingT : playT);
  setText(scoreEl, state.score.toLocaleString('en-US'));
  // The best game on this page, and who holds it (the tooltip over HIGH SCORE).
  const hi = highScore();
  setText(hiEl, hi.score.toLocaleString('en-US'));
  setText(hiTip, hi.who);
  // One fruit per level reached, the latest last, as along the cabinet's bottom edge (at most seven).
  const fruits = Array.from({ length: Math.min(state.level, 7) }, (_, i) => FRUIT_EMOJI[fruitForLevel(state.level - Math.min(state.level, 7) + 1 + i).kind] ?? '').join('');
  setText(fruitEl, fruits);
  if (state.lives !== shownLives) {
    shownLives = state.lives;
    livesEl.replaceChildren(...Array.from({ length: Math.max(0, state.lives) }, () => Object.assign(document.createElement('span'), { className: 'pac' })));
  }
  const steering = live && state.pacmanControl === 'keyboard' && overlayEl.hidden === true;
  if (swipePad.hidden === (touchScreen && steering)) swipePad.hidden = !(touchScreen && steering);
  // The pad shows your last swipe: where Pac-Man is heading, or the turn he takes at the next opening.
  const swiped = steering ? (state.keyDir ?? '') : '';
  if (swipePad.dataset.dir !== swiped) swipePad.dataset.dir = swiped;
  tvGameEl.classList.toggle('steering', steering);
  requestAnimationFrame(frame);
}

// From an old "Watch Clef play" link (?pacman=…): straight to that model.
const linked = new URLSearchParams(location.search).get('pacman');
showRecording();
if (linked && RECORDINGS[linked] !== undefined) watch(linked);
requestAnimationFrame(frame);
