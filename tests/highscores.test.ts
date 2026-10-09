import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../server/auth';
import { BOARD_SIZE, cleanInitials, fileStore, HighScores, highScoresStore } from '../server/highscores';
import type { TextStore } from '../server/s3';
import { createJevMiddleware } from '../server/routes';
import { sealSession } from '../server/session';
import { boardOf, MIXED_LINEUP } from '../shared/lineups';
import { checkPlayerGame } from '../src/player-check';
import { playAndRecord, TEST_SECRET } from './support/player-game';

const SECRET = TEST_SECRET;
const entry = (initials: string, score: number) => ({ initials, score, at: '2026-10-08T00:00:00.000Z', who: 'x' });

/** A store in memory, versioned like S3: what it holds, and every text written to it. `write` is another writer. */
function memoryStore(initial: string | null): TextStore & { saved: string[]; write(t: string): void; current(): string | null } {
  let text = initial;
  let version = 0;
  const saved: string[] = [];
  return {
    where: 'memory',
    saved,
    write: (t) => {
      text = t;
      version += 1;
    },
    current: () => text,
    load: async () => (text === null ? null : { text, version: String(version) }),
    save: async (t, expected) => {
      if ((text === null ? null : String(version)) !== expected) return null;
      text = t;
      version += 1;
      saved.push(t);
      return String(version);
    },
  };
}

describe('HighScores', () => {
  it('keeps the ten best per board, best first, and never shows who', () => {
    const h = new HighScores(null);
    for (let i = 1; i <= 12; i++) h.add('mixed', { ...entry('AAA', i * 100), who: `p${i}` });
    const board = h.view().mixed!;
    expect(board).toHaveLength(BOARD_SIZE);
    expect(board[0]!.score).toBe(1200);
    expect(board.at(-1)!.score).toBe(300);
    expect(board[0]).not.toHaveProperty('who');
    expect(h.placeFor('mixed', 250)).toBeNull();
    expect(h.placeFor('mixed', 1250)).toBe(1);
  });

  it('keeps one line per account per board: its best', () => {
    const h = new HighScores(null);
    expect(h.add('mixed', { ...entry('AAA', 500), who: 'same' })).toBe(1);
    expect(h.add('mixed', { ...entry('AAA', 300), who: 'same' })).toBe(1);
    expect(h.add('mixed', { ...entry('AAA', 900), who: 'same' })).toBe(1);
    expect(h.view().mixed).toEqual([{ initials: 'AAA', score: 900, at: '2026-10-08T00:00:00.000Z' }]);
  });

  it('survives a restart through its file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-hs-'));
    const file = join(dir, 'scores.json');
    const first = new HighScores(fileStore(file));
    await first.ready();
    first.add('opper/clef', entry('BOB', 4200));
    expect(await first.flush()).toBe(true);
    const second = new HighScores(fileStore(file));
    await second.ready();
    expect(second.view()['opper/clef']).toEqual([{ initials: 'BOB', score: 4200, at: '2026-10-08T00:00:00.000Z' }]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty when nothing is stored yet', async () => {
    const h = new HighScores(memoryStore(null));
    await h.ready();
    expect(h.view().mixed).toEqual([]);
  });

  it('never writes over boards it could not read', async () => {
    const store = { ...memoryStore('{"mixed":[]}'), load: vi.fn(async () => Promise.reject(new Error('HTTP 403 AccessDenied'))) };
    const warn = vi.fn();
    const h = new HighScores(store, warn);
    await expect(h.ready()).rejects.toThrow('AccessDenied');
    expect(() => h.add('mixed', entry('AAA', 100))).toThrow(/not been read/);
    expect(await h.flush()).toBe(true);
    expect(store.saved).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not read memory'));
  });

  it('reads the boards again after a failed read', async () => {
    vi.useFakeTimers();
    try {
      let fail = true;
      const store = { ...memoryStore(JSON.stringify({ mixed: [entry('BOB', 900)] })) };
      const load = store.load;
      store.load = async () => (fail ? Promise.reject(new Error('timeout')) : load());
      const h = new HighScores(store);
      await expect(h.ready()).rejects.toThrow('timeout');
      fail = false;
      await expect(h.ready()).rejects.toThrow(); // too soon: not asked again yet
      vi.advanceTimersByTime(6000);
      await h.ready();
      expect(h.view().mixed).toEqual([{ initials: 'BOB', score: 900, at: '2026-10-08T00:00:00.000Z' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes the latest boards, in order, and tries a failed write again', async () => {
    vi.useFakeTimers();
    try {
      const store = memoryStore(null);
      let down = true;
      const save = store.save;
      store.save = async (text, expected) => (down ? Promise.reject(new Error('HTTP 503')) : save(text, expected));
      const h = new HighScores(store, vi.fn());
      await h.ready();
      h.add('mixed', { ...entry('AAA', 100), who: 'a' });
      expect(await h.flush()).toBe(false);
      down = false;
      h.add('mixed', { ...entry('BBB', 200), who: 'b' });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(JSON.parse(store.saved.at(-1)!).mixed.map((e: { initials: string }) => e.initials)).toEqual(['BBB', 'AAA']);
    } finally {
      vi.useRealTimers();
    }
  });

  it("merges in another task's entries instead of writing over them (old and new tasks overlap in a deploy)", async () => {
    const store = memoryStore(null);
    const a = new HighScores(store);
    const b = new HighScores(store);
    await a.ready();
    await b.ready();
    a.add('mixed', { ...entry('AAA', 300), who: 'a' });
    expect(await a.flush()).toBe(true);
    b.add('mixed', { ...entry('BBB', 500), who: 'b' });
    b.add('mixed', { ...entry('AAA', 100), who: 'a' }); // the same account's worse game, from the other task
    expect(await b.flush()).toBe(true);
    expect(JSON.parse(store.current()!).mixed.map((e: { initials: string; score: number }) => `${e.initials} ${e.score}`)).toEqual(['BBB 500', 'AAA 300']);
    expect(b.view().mixed!.map((e) => e.score)).toEqual([500, 300]);
    expect(b.placeOf('mixed', 'a')).toBe(2);
    expect(b.placeOf('mixed', 'nobody')).toBeNull();
  });

  it('gives up on a write it keeps losing, and tries again later', async () => {
    const store = memoryStore(null);
    const h = new HighScores(store, vi.fn());
    await h.ready();
    const save = store.save;
    store.save = async (t, expected) => {
      store.write('{"mixed":[]}'); // someone else writes every time, just before us
      return save(t, expected);
    };
    h.add('mixed', { ...entry('AAA', 300), who: 'a' });
    expect(await h.flush()).toBe(false);
  });

  it('keeps the boards in S3 when JEV_HIGHSCORES_BUCKET is set, else in a file', () => {
    expect(highScoresStore({ JEV_HIGHSCORES_BUCKET: 'opper-jevman-benchmark-highscores-eu-north', AWS_REGION: 'eu-north-1' }).where).toBe('s3://opper-jevman-benchmark-highscores-eu-north/highscores.json');
    expect(highScoresStore({ JEV_HIGHSCORES_BUCKET: 'b', JEV_HIGHSCORES_KEY: 'k.json' }).where).toBe('s3://b/k.json');
    expect(highScoresStore({ JEV_HIGHSCORES_FILE: '/tmp/x.json' }).where).toBe('/tmp/x.json');
  });

  it('takes three letters only', () => {
    expect(cleanInitials('abc')).toBe('ABC');
    expect(cleanInitials('AB')).toBeNull();
    expect(cleanInitials('A1C')).toBeNull();
  });

  it('puts the presets on boards and leaves custom mixes off', () => {
    expect(boardOf(MIXED_LINEUP)).toBe('mixed');
    expect(boardOf({ blinky: 'opper/clef', pinky: 'opper/clef', inky: 'opper/clef', clyde: 'opper/clef' })).toBe('opper/clef');
    expect(boardOf({ blinky: 'opper/clef', pinky: 'opper/clef', inky: 'opper/kev-4b', clyde: 'opper/clef' })).toBeNull();
  });
});

describe('/api/highscores', () => {
  const mount = (highScores = new HighScores(null)) => {
    const handler = createJevMiddleware({ SESSION_SECRET: SECRET, OPPER_BASE_URL: 'https://api.opper.ai' }, { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, { quiet: true, highScores, loadPlayerCheck: async () => checkPlayerGame });
    return { handler, highScores };
  };
  const call = async (handler: ReturnType<typeof mount>['handler'], method: string, headers: Record<string, string>, payload?: unknown, ip = '203.0.113.7') => {
    const res = { statusCode: 200, headersSent: false, headers: {} as Record<string, unknown>, setHeader(k: string, v: unknown) { this.headers[k] = v; }, end: vi.fn() };
    const req = Object.assign(new EventEmitter(), { method, url: '/api/highscores', headers, socket: { remoteAddress: ip } });
    handler(req as never, res as never, vi.fn());
    if (payload !== undefined) {
      req.emit('data', JSON.stringify(payload));
      req.emit('end');
    }
    await vi.waitFor(() => expect(res.end).toHaveBeenCalled());
    return { status: res.statusCode, body: JSON.parse(res.end.mock.calls[0]![0] as string) };
  };
  const signedIn = { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${sealSession({ v: 1, apiKey: 'k', user: { email: 'player@example.com' }, issuedAt: Date.now() }, SECRET)}` };
  const { state, recording } = playAndRecord(42, 20000);

  it('lists the boards to anyone', async () => {
    const { handler } = mount();
    const r = await call(handler, 'GET', {});
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.boards)).toContain('mixed');
  });

  const signedOut = { 'content-type': 'application/json' };

  it("puts a signed-out player's checked game on the board: one line per address and initials", async () => {
    const { handler, highScores } = mount();
    const r = await call(handler, 'POST', signedOut, { board: 'mixed', initials: 'ann', recording });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ place: 1, score: state.score });
    // Someone else at the same address (a phone network, an office) gets a line of their own; the same player doesn't.
    expect((await call(handler, 'POST', signedOut, { board: 'mixed', initials: 'bob', recording })).body).toMatchObject({ place: 2 });
    expect((await call(handler, 'POST', signedOut, { board: 'mixed', initials: 'ann', recording })).body).toMatchObject({ place: 1 });
    expect(highScores.view().mixed!.map((e) => e.initials)).toEqual(['ANN', 'BOB']);
  });

  it('counts signed-out entries per address', async () => {
    const { handler } = mount();
    const bad = { board: 'mixed', initials: '!', recording: null };
    for (let i = 0; i < 20; i++) expect((await call(handler, 'POST', signedOut, bad)).status).toBe(400);
    expect((await call(handler, 'POST', signedOut, bad)).status).toBe(429);
    expect((await call(handler, 'POST', signedOut, bad, '198.51.100.9')).status).toBe(400);
  });

  it("puts a signed-in player's checked game on the board, with the replay's score", async () => {
    const { handler, highScores } = mount();
    const r = await call(handler, 'POST', signedIn, { board: 'mixed', initials: 'jev', recording });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ place: 1, score: state.score });
    expect(highScores.view().mixed![0]).toMatchObject({ initials: 'JEV', score: state.score });
  });

  it('refuses a game that does not check out, and bad initials or boards', async () => {
    const { handler, highScores } = mount();
    expect((await call(handler, 'POST', signedIn, { board: 'mixed', initials: 'ABC', recording: { ...recording, final: { ...recording.final, score: 99_999 } } })).status).toBe(422);
    expect((await call(handler, 'POST', signedIn, { board: 'mixed', initials: 'A!', recording })).status).toBe(400);
    expect((await call(handler, 'POST', signedIn, { board: 'nope', initials: 'ABC', recording })).status).toBe(400);
    // played against Mixed, entered for All Clef
    expect((await call(handler, 'POST', signedIn, { board: 'opper/clef', initials: 'ABC', recording })).status).toBe(422);
    expect(highScores.view().mixed).toEqual([]);
  });

  it('saves an entry before answering, so a restart keeps it', async () => {
    const store = memoryStore(null);
    const { handler } = mount(new HighScores(store));
    expect((await call(handler, 'POST', signedIn, { board: 'mixed', initials: 'jev', recording })).status).toBe(200);
    expect(JSON.parse(store.saved.at(-1)!).mixed[0]).toMatchObject({ initials: 'JEV', score: state.score });
    const restarted = mount(new HighScores(store));
    expect((await call(restarted.handler, 'GET', {})).body.boards.mixed[0]).toMatchObject({ initials: 'JEV', score: state.score });
  });

  it("doesn't say an entry was taken while it isn't stored, and stores it when the player tries again", async () => {
    const store = memoryStore(null);
    const save = store.save;
    let down = true;
    store.save = async (t, expected) => (down ? Promise.reject(new Error('HTTP 403 AccessDenied')) : save(t, expected));
    const { handler } = mount(new HighScores(store, vi.fn()));
    const failed = await call(handler, 'POST', signedIn, { board: 'mixed', initials: 'jev', recording });
    expect(failed.status).toBe(503);
    expect(failed.body.error).toMatch(/could not be saved/);
    down = false;
    const retried = await call(handler, 'POST', signedIn, { board: 'mixed', initials: 'jev', recording });
    expect(retried.status).toBe(200);
    expect(JSON.parse(store.current()!).mixed[0]).toMatchObject({ initials: 'JEV', score: state.score });
  });

  it('says the boards are unavailable while they cannot be read, and takes no entries', async () => {
    const store = { ...memoryStore(null), load: async () => Promise.reject(new Error('HTTP 403 AccessDenied')) };
    const { handler } = mount(new HighScores(store, vi.fn()));
    expect((await call(handler, 'GET', {})).status).toBe(503);
    expect((await call(handler, 'POST', signedIn, { board: 'mixed', initials: 'ABC', recording })).status).toBe(503);
    expect(store.saved).toEqual([]);
  });
});
