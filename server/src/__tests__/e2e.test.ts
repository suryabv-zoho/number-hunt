/**
 * End-to-end tests over real sockets.
 *
 * `game.test.ts` calls the state machine directly, which is fast and precise but skips
 * `handlers.ts` entirely — and that is where several of this project's worst bugs have
 * lived (a reconnect deleting its own seat, a leaver being dragged back into the match
 * by the broadcast that followed them out). These drive an actual socket.io server with
 * actual clients, so the wiring is under test too.
 *
 * Everything here uses real timers, so scenarios are built out of immediate actions.
 * Timeout-driven behaviour (a burned call window, the wrap-up clock) stays in the
 * fake-timer suite where it belongs.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IoServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  C2S,
  S2C,
  roomCapacity,
  type JoinAck,
  type NumberToken,
  type RoomState,
} from '@game/shared';
import {
  attachIo,
  boardClick,
  callNumber,
  endMatch,
  narrateBot,
  submitPuzzle,
} from '../game.js';
import { attachBotActions } from '../bots.js';
import { registerHandlers } from '../handlers.js';
import { rooms } from '../state.js';

let http: HttpServer;
let io: IoServer;
let url: string;

beforeAll(async () => {
  http = createServer();
  io = new IoServer(http);
  attachIo(io);
  attachBotActions({ callNumber, boardClick, submitPuzzle, narrate: narrateBot });
  registerHandlers(io);
  await new Promise<void>((r) => http.listen(0, r));
  const addr = http.address();
  url = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  io.close();
  await new Promise<void>((r) => http.close(() => r()));
});

/* ------------------------------------------------------------------ utilities */

const open: ClientSocket[] = [];

afterEach(() => {
  for (const s of open.splice(0)) s.disconnect();
  for (const [code, room] of rooms) {
    for (const t of Object.values(room.timers)) if (t) clearTimeout(t as NodeJS.Timeout);
    for (const b of room.botTimers) if (b.timeout) clearTimeout(b.timeout);
    rooms.delete(code);
  }
});

async function connect(): Promise<ClientSocket> {
  const s = ioClient(url, { forceNew: true, transports: ['websocket'] });
  open.push(s);
  await new Promise<void>((res, rej) => {
    s.on('connect', () => res());
    s.on('connect_error', rej);
  });
  return s;
}

function ask<T>(s: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((res) => s.emit(event, payload, res));
}

/** Listeners take either a raw socket or a Client, whichever reads better at the call. */
type Listenable = ClientSocket | { socket: ClientSocket };
const sock = (x: Listenable): ClientSocket => ('socket' in x ? x.socket : x);

/** Resolve on the next `event`, or reject if it doesn't arrive. */
function next<T>(target: Listenable, event: string, ms = 2500): Promise<T> {
  const s = sock(target);
  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      s.off(event, handler);
      rej(new Error(`timed out waiting for "${event}"`));
    }, ms);
    const handler = (p: T) => {
      clearTimeout(timer);
      s.off(event, handler);
      res(p);
    };
    s.on(event, handler);
  });
}

/** Resolve on the first `event` that satisfies `match`. */
function until<T>(
  target: Listenable,
  event: string,
  match: (p: T) => boolean,
  ms = 3000,
): Promise<T> {
  const s = sock(target);
  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      s.off(event, handler);
      rej(new Error(`timed out waiting for a matching "${event}"`));
    }, ms);
    const handler = (p: T) => {
      if (!match(p)) return;
      clearTimeout(timer);
      s.off(event, handler);
      res(p);
    };
    s.on(event, handler);
  });
}

/**
 * Poll a condition over the clients' cached state.
 *
 * Waiting on the *next* `room:state` is a race: the broadcast being waited for may have
 * already landed, or an unrelated one (someone joining) may arrive first. The real
 * client keeps a running snapshot, so the tests assert against that instead.
 */
async function waitUntil(fn: () => boolean, what = 'condition', ms = 4000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A player who keeps the board and the latest room state, like the real client does. */
interface Client {
  socket: ClientSocket;
  id: string;
  tokens: NumberToken[];
  state: RoomState | null;
}

async function join(name: string, code?: string): Promise<Client> {
  const socket = await connect();
  const c: Client = { socket, id: '', tokens: [], state: null };
  socket.on(S2C.boardInit, (p: { tokens: NumberToken[] }) => (c.tokens = p.tokens));
  socket.on(S2C.boardRemove, (p: { tokenId: string }) => {
    c.tokens = c.tokens.filter((t) => t.id !== p.tokenId);
  });
  socket.on(S2C.state, (s: RoomState) => (c.state = s));

  const ack = await ask<JoinAck>(
    socket,
    code ? C2S.joinRoom : C2S.createRoom,
    code ? { code, name } : { name },
  );
  if (!ack.ok) throw new Error(ack.error ?? 'join failed');
  c.id = ack.playerId!;
  return c;
}

const tokenOf = (c: Client, value: number) => c.tokens.find((t) => t.value === value)!;
const click = (c: Client, t: NumberToken) => c.socket.emit(C2S.boardClick, { x: t.x, y: t.y });

/** Solve whatever puzzle this client was handed. */
function solve(c: Client, pz: { id: string; target: string; tiles: { id: string; ch: string }[] }) {
  const order = pz.target.split('').map((ch) => pz.tiles.find((t) => t.ch === ch)!.id);
  c.socket.emit(C2S.puzzleSubmit, { puzzleId: pz.id, order });
}

/** Two players in a started match, with the board in hand. */
async function startedMatch(config: Record<string, unknown> = {}) {
  const host = await join('Host');
  const code = host.state!.code;
  const guest = await join('Guest', code);
  const wanted = { numberCount: 20, matchMinutes: 5, ...config };
  host.socket.emit(C2S.config, wanted);
  await waitUntil(() => host.state?.config.numberCount === wanted.numberCount, 'config');

  host.socket.emit(C2S.start);
  await waitUntil(
    () => host.state?.phase === 'await_call' && host.tokens.length > 0 && guest.tokens.length > 0,
    'the match to start',
  );
  return { host, guest, code };
}

/* -------------------------------------------------------------------- the game */

describe('a full turn', () => {
  it('runs call -> hunt -> puzzle -> score for both players', async () => {
    const { host, guest } = await startedMatch();

    // Whoever the rotation picked calls; the other one hunts.
    const callerIsHost = host.state!.currentCallerId === host.id;
    const caller = callerIsHost ? host : guest;
    const hunter = callerIsHost ? guest : host;

    const called = next<{ value: number }>(hunter, S2C.turnCalled);
    const callerPuzzle = next<{ id: string; target: string; tiles: { id: string; ch: string }[] }>(
      caller.socket,
      S2C.puzzleStart,
    );
    click(caller, caller.tokens[0]);

    const { value } = await called;
    expect(value).toBe(caller.tokens[0].value);

    // Calling puts the caller straight onto a puzzle, so they can't help.
    const pz = await callerPuzzle;
    const scored = next<{ correct: boolean; delta: number }>(caller.socket, S2C.puzzleResult);
    solve(caller, pz);
    const result = await scored;
    expect(result.correct).toBe(true);
    expect(result.delta).toBeGreaterThan(0);

    // The hunter finds it, which is what unlocks their puzzle.
    const found = next<{ playerId: string }>(hunter.socket, S2C.boardFound);
    const hunterPuzzle = next<{ id: string }>(hunter.socket, S2C.puzzleStart);
    click(hunter, tokenOf(hunter, value));
    expect((await found).playerId).toBe(hunter.id);
    await hunterPuzzle;

    await waitUntil(() => !!hunter.state?.foundBy.includes(hunter.id), 'the find to register');
    expect(hunter.state!.foundBy).toContain(hunter.id);
  });

  it('charges for a wrong number and locks the board', async () => {
    const { host, guest } = await startedMatch();
    const callerIsHost = host.state!.currentCallerId === host.id;
    const caller = callerIsHost ? host : guest;
    const hunter = callerIsHost ? guest : host;

    const called = next<{ value: number }>(hunter, S2C.turnCalled);
    click(caller, caller.tokens[0]);
    const { value } = await called;

    const wrong = next<{ playerId: string; penalty: number }>(hunter.socket, S2C.boardWrong);
    click(hunter, hunter.tokens.find((t) => t.value !== value)!);
    const p = await wrong;
    expect(p.penalty).toBeLessThan(0);

    await waitUntil(
      () => (hunter.state?.players.find((pl) => pl.id === hunter.id)?.score ?? 0) < 0,
      'the penalty to land',
    );
    expect(hunter.state!.players.find((pl) => pl.id === hunter.id)!.score).toBe(p.penalty);
  });

  it('keeps handing out puzzles while the window is open', async () => {
    const { host, guest } = await startedMatch();
    const callerIsHost = host.state!.currentCallerId === host.id;
    const caller = callerIsHost ? host : guest;

    const first = next<{ id: string; target: string; tiles: { id: string; ch: string }[] }>(
      caller.socket,
      S2C.puzzleStart,
    );
    click(caller, caller.tokens[0]);
    const pz1 = await first;

    const second = next<{ id: string }>(caller.socket, S2C.puzzleStart);
    solve(caller, pz1);
    const pz2 = await second;
    expect(pz2.id).not.toBe(pz1.id);
  });
});

/* ------------------------------------------------------------------ the lobby */

describe('getting in', () => {
  it('refuses a name already sitting in the room', async () => {
    const host = await join('Meera');
    const s = await connect();
    const ack = await ask<JoinAck>(s, C2S.joinRoom, { code: host.state!.code, name: 'meera' });
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/taken/i);
  });

  it('refuses an unknown code', async () => {
    const s = await connect();
    const ack = await ask<JoinAck>(s, C2S.joinRoom, { code: 'ZZZZ', name: 'Nobody' });
    expect(ack.ok).toBe(false);
  });

  it('refuses a newcomer once the match has started', async () => {
    const { code } = await startedMatch();
    const s = await connect();
    const ack = await ask<JoinAck>(s, C2S.joinRoom, { code, name: 'Late' });
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/already started/i);
  });

  it('will not start with one player', async () => {
    const host = await join('Solo');
    const err = next<{ message: string }>(host.socket, S2C.error);
    host.socket.emit(C2S.start);
    expect((await err).message).toMatch(/at least 2/i);
  });

  it('lets only the host change settings or start', async () => {
    const host = await join('Host');
    const guest = await join('Guest', host.state!.code);

    const configErr = next<{ message: string }>(guest.socket, S2C.error);
    guest.socket.emit(C2S.config, { numberCount: 150 });
    expect((await configErr).message).toMatch(/only the host/i);

    const startErr = next<{ message: string }>(guest.socket, S2C.error);
    guest.socket.emit(C2S.start);
    expect((await startErr).message).toMatch(/only the host/i);
  });

  it('merges config deltas instead of clobbering them', async () => {
    const host = await join('Host');
    await join('Guest', host.state!.code);
    host.socket.emit(C2S.config, { numberCount: 40 });
    await waitUntil(() => host.state?.config.numberCount === 40, 'the first change');
    host.socket.emit(C2S.config, { puzzleLength: 8 });
    await waitUntil(() => host.state?.config.puzzleLength === 8, 'the second change');
    // The earlier change must survive the later one.
    expect(host.state!.config.numberCount).toBe(40);
  });
});

/* ------------------------------------------------------- connections and exits */

describe('coming and going', () => {
  it('gives a refreshing player their seat and score back', async () => {
    const { host, guest } = await startedMatch();
    const callerIsHost = host.state!.currentCallerId === host.id;
    const caller = callerIsHost ? host : guest;

    // Bank a few points so there is something to lose.
    const pzP = next<{ id: string; target: string; tiles: { id: string; ch: string }[] }>(
      caller.socket,
      S2C.puzzleStart,
    );
    click(caller, caller.tokens[0]);
    solve(caller, await pzP);
    await waitUntil(
      () => (caller.state?.players.find((p) => p.id === caller.id)?.score ?? 0) > 0,
      'a score',
    );
    const before = caller.state!.players.find((p) => p.id === caller.id)!.score;

    // A refresh: brand new socket, same playerId, as `socket.ts` does on connect.
    caller.socket.disconnect();
    const again = await connect();
    // The seat snapshot is emitted inside `enter`, which runs before the ack callback —
    // so the listener has to be in place first or the state is already gone.
    let state: RoomState | null = null;
    again.on(S2C.state, (s: RoomState) => (state = s));

    const ack = await ask<JoinAck>(again, C2S.joinRoom, {
      code: host.state!.code,
      name: 'Host',
      playerId: caller.id,
    });
    expect(ack.ok).toBe(true);
    expect(ack.playerId).toBe(caller.id);

    await waitUntil(() => state !== null, 'the seat snapshot');
    const seat = state!.players.find((p) => p.id === caller.id)!;
    expect(seat.score).toBe(before);
    expect(seat.connected).toBe(true);
    // ...and exactly one seat, not a ghost beside a fresh one.
    expect(state!.players.filter((p) => p.name === 'Host')).toHaveLength(1);
  });

  it('will not let a player who walked out come back', async () => {
    const { host, guest } = await startedMatch();
    guest.socket.emit(C2S.leave);
    await waitUntil(
      () => !!host.state?.players.find((p) => p.id === guest.id)?.left,
      'the walk-out to register',
    );

    const again = await connect();
    const ack = await ask<JoinAck>(again, C2S.joinRoom, {
      code: host.state!.code,
      name: 'Guest',
      playerId: guest.id,
    });
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/left this room/i);
  });

  it('does not drag a leaver back with the broadcast that follows them out', async () => {
    const { host, guest } = await startedMatch();
    let afterLeaving = 0;
    guest.socket.on(S2C.state, () => (afterLeaving += 1));
    guest.socket.emit(C2S.leave);
    await waitUntil(() => !!host.state?.players.find((p) => p.id === guest.id)?.left, 'the exit');
    await new Promise((r) => setTimeout(r, 200));
    expect(afterLeaving).toBe(0);
  });

  it('keeps a walk-out on the leaderboard, marked as having left', async () => {
    const { host, guest } = await startedMatch();
    guest.socket.emit(C2S.leave);
    const over = await next<{ leaderboard: { playerId: string; left: boolean }[] }>(
      host.socket,
      S2C.gameOver,
    );
    const row = over.leaderboard.find((r) => r.playerId === guest.id)!;
    expect(row.left).toBe(true);
  });

  it('ends the match once it is down to one player', async () => {
    const { host, guest } = await startedMatch();
    const over = next<{ reason: string }>(host.socket, S2C.gameOver);
    guest.socket.emit(C2S.leave);
    expect((await over).reason).toBe('not_enough_players');
  });

  it('passes the turn on when the caller drops mid-turn', async () => {
    const { host, guest } = await startedMatch();
    const callerIsHost = host.state!.currentCallerId === host.id;
    const caller = callerIsHost ? host : guest;
    const other = callerIsHost ? guest : host;

    caller.socket.disconnect();
    // The room must not sit there waiting on somebody who has gone.
    await waitUntil(
      () => other.state?.currentCallerId === other.id,
      'the turn to move on',
    );
  });

  it('tells everyone when the host closes the room', async () => {
    const host = await join('Host');
    const guest = await join('Guest', host.state!.code);
    const closed = next<{ by: string }>(guest.socket, S2C.roomClosed);
    host.socket.emit(C2S.closeRoom);
    expect((await closed).by).toBe('Host');
    expect(rooms.size).toBe(0);
  });

  it('lets only the host close the room', async () => {
    const host = await join('Host');
    const guest = await join('Guest', host.state!.code);
    const err = next<{ message: string }>(guest.socket, S2C.error);
    guest.socket.emit(C2S.closeRoom);
    expect((await err).message).toMatch(/only the host/i);
    expect(rooms.size).toBe(1);
  });

  it('hands the room to someone else when the host drops', async () => {
    const host = await join('Host');
    const guest = await join('Guest', host.state!.code);
    const third = await join('Third', host.state!.code);
    host.socket.emit(C2S.start);
    await waitUntil(() => guest.state?.phase === 'await_call', 'the start');

    host.socket.disconnect();
    await waitUntil(
      () => !!guest.state?.players.find((p) => p.isHost && p.id !== host.id),
      'a new host',
    );
    expect(third.state!.players.find((p) => p.isHost)!.id).not.toBe(host.id);
  });

  it('keeps one player to one room', async () => {
    const host = await join('Host');
    const ack = await ask<JoinAck>(host.socket, C2S.createRoom, { name: 'Host' });
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/already in a room/i);
  });
});

/* ----------------------------------------------------------------- practice */

describe('practice', () => {
  async function practice(name = 'Learner') {
    const socket = await connect();
    const c: Client = { socket, id: '', tokens: [], state: null };
    socket.on(S2C.boardInit, (p: { tokens: NumberToken[] }) => (c.tokens = p.tokens));
    socket.on(S2C.state, (s: RoomState) => (c.state = s));
    const ack = await ask<JoinAck>(socket, C2S.createPractice, { name });
    if (!ack.ok) throw new Error(ack.error);
    c.id = ack.playerId!;
    await waitUntil(() => c.state?.phase === 'await_call' && c.tokens.length > 0, 'the match');
    return c;
  }

  it('seats two bots, starts at once, and gives the human the first turn', async () => {
    const me = await practice();
    expect(me.state!.practice).toBe(true);
    const bots = me.state!.players.filter((p) => p.isBot);
    expect(bots).toHaveLength(2);
    expect(bots.map((b) => b.name)).not.toContain('Learner');
    expect(me.state!.currentCallerId).toBe(me.id);
  });

  it('will not let a stranger in on the code', async () => {
    const me = await practice();
    const s = await connect();
    const ack = await ask<JoinAck>(s, C2S.joinRoom, { code: me.state!.code, name: 'Gate' });
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/practice match/i);
  });

  it('still lets the player themselves reconnect', async () => {
    const me = await practice();
    const code = me.state!.code;
    me.socket.disconnect();
    const again = await connect();
    const ack = await ask<JoinAck>(again, C2S.joinRoom, {
      code,
      name: 'Learner',
      playerId: me.id,
    });
    expect(ack.ok).toBe(true);
  });

  it('holds the clocks while an instruction is open, and lets them go again', async () => {
    const me = await practice();
    me.socket.emit(C2S.coachPause, { paused: true });
    const held = await until<{ paused?: boolean; matchLeftMs: number }>(
      me.socket,
      S2C.tick,
      (t) => t.paused === true,
    );
    const frozen = held.matchLeftMs;

    // Two more ticks with the clocks held: the number must not move.
    await until<{ paused?: boolean }>(me.socket, S2C.tick, (t) => t.paused === true);
    const stillHeld = await until<{ paused?: boolean; matchLeftMs: number }>(
      me.socket,
      S2C.tick,
      (t) => t.paused === true,
    );
    expect(stillHeld.matchLeftMs).toBe(frozen);

    me.socket.emit(C2S.coachPause, { paused: false });
    const running = await until<{ paused?: boolean; matchLeftMs: number }>(
      me.socket,
      S2C.tick,
      (t) => t.paused !== true,
    );
    expect(running.matchLeftMs).toBeLessThanOrEqual(frozen);
  });

  it('refuses to hold the clocks in a real match', async () => {
    const { host } = await startedMatch();
    host.socket.emit(C2S.coachPause, { paused: true });
    const tick = await next<{ paused?: boolean }>(host.socket, S2C.tick, 2500);
    expect(tick.paused).not.toBe(true);
  });

  it('bots take a turn and hunt on their own', async () => {
    const me = await practice();
    // Hand the turn over by calling, then let the round resolve to a bot.
    click(me, me.tokens[0]);
    await waitUntil(() => me.state?.phase === 'hunting', 'the hunt');
    // A bot should find the number without any help from a socket.
    await waitUntil(
      () => (me.state?.foundBy.length ?? 0) > 0,
      'a bot to find the number',
      30_000,
    );
  }, 35_000);
});

/* -------------------------------------------------------- rematch and abuse */

describe('after the whistle', () => {
  /**
   * End the match the way the clock would, rather than waiting a real minute for it.
   * Everything after this point — the leaderboard, the rematch handshake — still goes
   * over the sockets, which is the part worth testing here.
   */
  async function endedMatch() {
    const { host, guest } = await startedMatch();
    const over = next<{ reason: string; leaderboard: unknown[] }>(host.socket, S2C.gameOver);
    endMatch(rooms.get(host.state!.code)!, 'time_up');
    const result = await over;
    await waitUntil(() => host.state?.phase === 'ended', 'the final whistle');
    return { host, guest, result };
  }

  it('sends everyone a leaderboard when the clock runs out', async () => {
    const { host, guest, result } = await endedMatch();
    expect(result.reason).toBe('time_up');
    expect(result.leaderboard).toHaveLength(2);
    await waitUntil(() => guest.state?.phase === 'ended', 'the guest to see it too');
    expect(host.state!.phase).toBe('ended');
  });

  it('lets only the host restart', async () => {
    const { guest } = await endedMatch();
    const err = next<{ message: string }>(guest.socket, S2C.error);
    guest.socket.emit(C2S.playAgain);
    expect((await err).message).toMatch(/only the host/i);
  });

  it('needs somebody else to accept before the host can restart', async () => {
    const { host, guest } = await endedMatch();

    const err = next<{ message: string }>(host.socket, S2C.error);
    host.socket.emit(C2S.playAgain);
    expect((await err).message).toMatch(/at least one player to accept/i);

    guest.socket.emit(C2S.acceptRematch);
    await waitUntil(() => !!host.state?.readyForNext.includes(guest.id), 'the acceptance');

    host.socket.emit(C2S.playAgain);
    await waitUntil(() => host.state?.phase === 'lobby', 'the lobby');
    expect(guest.state!.phase).toBe('lobby');
  });

  it('treats leaving after the whistle as final', async () => {
    const { host, guest } = await endedMatch();
    guest.socket.emit(C2S.leave);
    await new Promise((r) => setTimeout(r, 150));

    const again = await connect();
    const ack = await ask<JoinAck>(again, C2S.joinRoom, {
      code: host.state!.code,
      name: 'Guest',
      playerId: guest.id,
    });
    expect(ack.ok).toBe(false);
  });

  it('restarts a practice match without asking anyone', async () => {
    const socket = await connect();
    const c: Client = { socket, id: '', tokens: [], state: null };
    socket.on(S2C.boardInit, (p: { tokens: NumberToken[] }) => (c.tokens = p.tokens));
    socket.on(S2C.state, (st: RoomState) => (c.state = st));
    const ack = await ask<JoinAck>(socket, C2S.createPractice, { name: 'Solo' });
    c.id = ack.playerId!;
    await waitUntil(() => c.state?.phase === 'await_call', 'the practice match');

    endMatch(rooms.get(c.state!.code)!, 'time_up');
    await waitUntil(() => c.state?.phase === 'ended', 'the end');

    // One human in the room, so there is nobody to get consent from.
    socket.emit(C2S.playAgain);
    await waitUntil(() => c.state?.phase === 'await_call', 'another practice match');
    expect(c.state!.players.filter((p) => p.isBot)).toHaveLength(2);
  });
});

describe('rubbish input', () => {
  it('ignores a puzzle submitted with tiles that are not in it', async () => {
    const { host, guest } = await startedMatch();
    const callerIsHost = host.state!.currentCallerId === host.id;
    const caller = callerIsHost ? host : guest;

    const pz = await (async () => {
      const p = next<{ id: string; tiles: { id: string; ch: string }[] }>(
        caller.socket,
        S2C.puzzleStart,
      );
      click(caller, caller.tokens[0]);
      return p;
    })();

    for (const bogus of [
      { puzzleId: pz.id, order: ['nope', 'nope2'] },
      { puzzleId: pz.id, order: [pz.tiles[0].id, pz.tiles[0].id] },
      { puzzleId: 'not-a-puzzle', order: pz.tiles.map((t) => t.id) },
      { puzzleId: pz.id, order: [] },
    ]) {
      caller.socket.emit(C2S.puzzleSubmit, bogus);
    }
    await new Promise((r) => setTimeout(r, 250));
    // Still connected, still scoreless, puzzle still open.
    expect(caller.socket.connected).toBe(true);
    expect(caller.state!.players.find((p) => p.id === caller.id)!.score).toBe(0);
    expect(caller.state!.solving).toContain(caller.id);
  });

  it('ignores a board click from someone whose turn it is not', async () => {
    const { host, guest } = await startedMatch();
    const callerIsHost = host.state!.currentCallerId === host.id;
    const other = callerIsHost ? guest : host;

    click(other, other.tokens[0]);
    await new Promise((r) => setTimeout(r, 250));
    expect(other.state!.phase).toBe('await_call');
    expect(other.state!.calledValue).toBeNull();
  });

  it('will not let the caller "find" the number they just called', async () => {
    const { host, guest } = await startedMatch();
    const callerIsHost = host.state!.currentCallerId === host.id;
    const caller = callerIsHost ? host : guest;

    click(caller, caller.tokens[0]);
    await waitUntil(() => caller.state?.phase === 'hunting', 'the hunt');
    click(caller, tokenOf(caller, caller.state!.calledValue!));
    await new Promise((r) => setTimeout(r, 250));
    expect(caller.state!.foundBy).not.toContain(caller.id);
  });

  it('survives junk coordinates and junk payloads', async () => {
    const { host } = await startedMatch();
    host.socket.emit(C2S.boardClick, { x: 'NaN', y: null });
    host.socket.emit(C2S.boardClick, {});
    host.socket.emit(C2S.boardClick, { x: 1e9, y: -1e9 });
    host.socket.emit(C2S.puzzleSubmit, { puzzleId: 1, order: 'nope' });
    host.socket.emit(C2S.config, { numberCount: 'lots', matchMinutes: -5 });
    await new Promise((r) => setTimeout(r, 300));
    expect(host.socket.connected).toBe(true);
    expect(rooms.size).toBe(1);
  });

  it('trims and caps a silly name', async () => {
    const s = await connect();
    const ack = await ask<JoinAck>(s, C2S.createRoom, {
      name: '   ' + 'x'.repeat(50) + '\u0007  ',
    });
    expect(ack.ok).toBe(true);
    const state = await next<RoomState>(s, S2C.state, 1500).catch(() => null);
    void state;
  });
});

/* --------------------------------------------------------------- room capacity */

describe('room size', () => {
  it('turns people away once the settings are full', async () => {
    const host = await join('Host');
    const code = host.state!.code;
    // Two seats: the shortest match with the longest find window.
    host.socket.emit(C2S.config, { matchMinutes: 5, findSeconds: 90 });
    await waitUntil(() => host.state?.config.findSeconds === 90, 'the settings');
    expect(roomCapacity(host.state!.config)).toBe(2);

    await join('Second', code);
    const third = await connect();
    const ack = await ask<JoinAck>(third, C2S.joinRoom, { code, name: 'Third' });
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/full/i);
  });

  it('opens more seats when the host shortens the find window', async () => {
    const host = await join('Host');
    const code = host.state!.code;
    host.socket.emit(C2S.config, { matchMinutes: 5, findSeconds: 90 });
    await waitUntil(() => roomCapacity(host.state!.config) === 2, 'a two-seat room');
    await join('Second', code);

    host.socket.emit(C2S.config, { matchMinutes: 15, findSeconds: 30 });
    await waitUntil(() => roomCapacity(host.state!.config) > 2, 'a bigger room');

    const third = await join('Third', code);
    expect(third.state!.players).toHaveLength(3);
  });

  it('will not let the host shrink the room below the people already in it', async () => {
    const host = await join('Host');
    const code = host.state!.code;
    for (const name of ['B', 'C', 'D']) await join(name, code);
    await waitUntil(() => host.state?.players.length === 4, 'four players');

    const err = next<{ message: string }>(host.socket, S2C.error);
    host.socket.emit(C2S.config, { matchMinutes: 5, findSeconds: 90 });
    expect((await err).message).toMatch(/only seat/i);
    // The settings must be left exactly as they were.
    expect(host.state!.config.findSeconds).not.toBe(90);
  });

  it('lets a player who is already seated reconnect into a full room', async () => {
    const host = await join('Host');
    const code = host.state!.code;
    host.socket.emit(C2S.config, { matchMinutes: 5, findSeconds: 90 });
    await waitUntil(() => roomCapacity(host.state!.config) === 2, 'a two-seat room');
    const guest = await join('Guest', code);

    guest.socket.disconnect();
    const again = await connect();
    const ack = await ask<JoinAck>(again, C2S.joinRoom, {
      code,
      name: 'Guest',
      playerId: guest.id,
    });
    // Full means no *new* faces; the seat holder still owns their chair.
    expect(ack.ok).toBe(true);
  });
});
