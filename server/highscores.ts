import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BOARD_KEYS } from '../shared/lineups.ts';
import { credentialsFromEnv, s3Store, type TextStore } from './s3.ts';

/** One line on a board: three initials, the score, when, and a hash of the account (to trace abuse, never shown). */
export interface ScoreEntry {
  initials: string;
  score: number;
  at: string;
  who: string;
}
/** A board as the page sees it. */
export type PublicEntry = Omit<ScoreEntry, 'who'>;

export const BOARD_SIZE = 10;

/** Three letters A to Z, upper-cased, or null. */
export function cleanInitials(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

/** A signed-in player's account as a short hash: enough to find their entries, without storing who they are. */
export function accountHash(user: { email?: string; name?: string } | undefined, secret: string): string {
  return createHash('sha256').update(`${secret}:${user?.email ?? user?.name ?? 'unknown'}`).digest('hex').slice(0, 16);
}

/**
 * A signed-out player as a short hash: their address (counted as the free credits count visitors) and their initials,
 * so players who share an address (a phone network, an office) each keep their own line.
 */
export function visitorHash(visitor: string, initials: string, secret: string): string {
  return createHash('sha256').update(`${secret}:visitor:${visitor}:${initials}`).digest('hex').slice(0, 16);
}

/** A failed save is tried again after this long (the next entry also saves). */
const SAVE_RETRY_MS = 30_000;
/** A failed load is not tried again sooner than this. */
const LOAD_RETRY_MS = 5_000;
/** Writes that lose the race to another writer are merged and tried again this many times. */
const SAVE_ATTEMPTS = 5;

/**
 * The player high-score boards, one per lineup, top ten each. Kept in memory and saved whole to a store after each
 * entry: in production an S3 object, so they survive deploys and restarts. A save only replaces the version it read;
 * if another server wrote in between (old and new tasks overlap during a deploy), its boards are read and merged in
 * first. Nothing is shown or entered until the store has been read, and a store that can't be read is never
 * written: empty boards must not replace saved ones.
 */
export class HighScores {
  private readonly boards: Record<string, ScoreEntry[]> = {};
  private readonly store: TextStore | null;
  private readonly warn: (msg: string) => void;
  private loaded = false;
  /** The stored version the boards were last read from or written as (null: nothing stored yet). */
  private version: string | null = null;
  private loading: Promise<void> | null = null;
  private loadFailedAt = Number.NEGATIVE_INFINITY;
  private saving: Promise<boolean> = Promise.resolve(true);
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(store: TextStore | null, warn: (msg: string) => void = () => {}) {
    this.store = store;
    this.warn = warn;
    for (const k of BOARD_KEYS) this.boards[k] = [];
    if (!store) this.loaded = true;
  }

  /** Resolves once the boards have been read from the store; rejects if it can't be read (a later call tries again). */
  ready(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loading) return this.loading;
    if (Date.now() - this.loadFailedAt < LOAD_RETRY_MS) return Promise.reject(new Error('the high scores could not be read'));
    this.loading = this.store!.load()
      .then((stored) => {
        if (stored) this.merge(stored.text);
        this.version = stored?.version ?? null;
        this.loaded = true;
      })
      .catch((err: unknown) => {
        this.loadFailedAt = Date.now();
        this.warn(`[highscores] could not read ${this.store!.where}: ${(err as Error)?.message ?? String(err)}`);
        throw err;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  /** Every board, best first, without the account hashes. */
  view(): Record<string, PublicEntry[]> {
    return Object.fromEntries(BOARD_KEYS.map((k) => [k, this.boards[k]!.map(({ initials, score, at }) => ({ initials, score, at }))]));
  }

  /** The place a score would take on a board (1 to 10), or null if it would not make it. */
  placeFor(board: string, score: number): number | null {
    const list = this.boards[board];
    if (!list || score <= 0) return null;
    const place = list.filter((e) => e.score >= score).length + 1;
    return place <= BOARD_SIZE ? place : null;
  }

  /**
   * Puts a score on its board; its place, or null if it didn't make the top ten. One line per account per board: a
   * better score replaces the account's line, a worse one changes nothing (the account's place is returned).
   */
  add(board: string, entry: ScoreEntry): number | null {
    if (!this.loaded) throw new Error('the high scores have not been read yet');
    const list = this.boards[board];
    if (!list) return null;
    const mine = list.findIndex((e) => e.who === entry.who);
    if (mine !== -1) {
      if (list[mine]!.score >= entry.score) return mine + 1;
      list.splice(mine, 1);
    }
    const place = this.placeFor(board, entry.score);
    if (place === null) return null;
    list.splice(place - 1, 0, entry);
    list.length = Math.min(list.length, BOARD_SIZE);
    return place;
  }

  /** The account's place on a board now (1 to 10), or null if it has no line there. */
  placeOf(board: string, who: string): number | null {
    const i = this.boards[board]?.findIndex((e) => e.who === who) ?? -1;
    return i === -1 ? null : i + 1;
  }

  /**
   * Writes the boards to the store, after any write already under way (so the last one holds the latest boards),
   * merging in another writer's boards first when it got there in between. False if it failed: the boards stay in
   * memory, and the write is tried again shortly.
   */
  flush(): Promise<boolean> {
    if (!this.store || !this.loaded) return Promise.resolve(true);
    const store = this.store;
    const write = async () => {
      for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
        const next = await store.save(JSON.stringify(this.boards), this.version);
        if (next !== null) {
          this.version = next;
          return;
        }
        const theirs = await store.load();
        if (theirs) this.merge(theirs.text);
        this.version = theirs?.version ?? null;
      }
      throw new Error(`another writer kept changing it (${SAVE_ATTEMPTS} attempts)`);
    };
    this.saving = this.saving.then(() =>
      write().then(
        () => true,
        (err: unknown) => {
          this.warn(`[highscores] could not save ${store.where}: ${(err as Error)?.message ?? String(err)}`);
          this.retry ??= setTimeout(() => {
            this.retry = null;
            void this.flush();
          }, SAVE_RETRY_MS);
          this.retry.unref?.();
          return false;
        },
      ),
    );
    return this.saving;
  }

  /**
   * Adds stored boards to these: every entry from both, one line per account (its best), top ten. An entry deleted
   * from the store by hand comes back while a running server still holds it, so restart after editing the object.
   */
  private merge(text: string): void {
    const data = JSON.parse(text) as Record<string, unknown>;
    for (const k of BOARD_KEYS) {
      const stored = Array.isArray(data[k]) ? (data[k] as unknown[]) : [];
      const valid = stored.filter((e): e is ScoreEntry => !!e && typeof e === 'object' && cleanInitials((e as ScoreEntry).initials) !== null && Number.isInteger((e as ScoreEntry).score));
      const best = new Map<string, ScoreEntry>();
      for (const e of [...this.boards[k]!, ...valid]) {
        // Entries without an account (put in by hand) count as their own line.
        const id = e.who || `${e.initials}|${e.score}|${e.at}`;
        const had = best.get(id);
        if (!had || e.score > had.score) best.set(id, e);
      }
      this.boards[k] = [...best.values()].sort((a, b) => b.score - a.score).slice(0, BOARD_SIZE);
    }
  }
}

/** A file on the server's own disk as a store (local runs: a redeploy starts it afresh), versioned by its content's hash. */
export function fileStore(file: string): TextStore {
  const versionOf = (text: string) => createHash('sha256').update(text).digest('hex');
  const read = (): string | null => {
    try {
      return readFileSync(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw err;
    }
  };
  return {
    where: file,
    async load() {
      const text = read();
      return text === null ? null : { text, version: versionOf(text) };
    },
    async save(text, expected) {
      const now = read();
      if ((now === null ? null : versionOf(now)) !== expected) return null;
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, text);
      renameSync(tmp, file); // whole or not at all
      return versionOf(text);
    },
  };
}

/**
 * Where the boards are kept: the S3 object JEV_HIGHSCORES_BUCKET / JEV_HIGHSCORES_KEY (default highscores.json) in
 * AWS_REGION, with the task role's credentials; else the file JEV_HIGHSCORES_FILE, else one in the temp folder.
 */
export function highScoresStore(env: Record<string, string | undefined>): TextStore {
  const bucket = env.JEV_HIGHSCORES_BUCKET?.trim();
  if (bucket) {
    // AWS credentials and region may be outside the env the dev server passes (which keeps only its own prefixes).
    const aws = { ...process.env, ...env };
    return s3Store({
      bucket,
      key: env.JEV_HIGHSCORES_KEY?.trim() || 'highscores.json',
      region: aws.AWS_REGION || aws.AWS_DEFAULT_REGION || 'eu-north-1',
      credentials: credentialsFromEnv(aws),
    });
  }
  return fileStore(env.JEV_HIGHSCORES_FILE || join(tmpdir(), 'jevman-highscores.json'));
}
