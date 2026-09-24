import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LONELY_GRACE_MS,
  MISSED_CALL_CONSOLATION,
  MISSED_CALL_PENALTY,
  PICK_MS,
  COACH_MAX_PAUSE_MS,
  PRACTICE_CONFIG,
  PRACTICE_PICK_MS,
  WRAPUP_MS,
  WRONG_CLICK_PENALTY,
} from '@game/shared';
import {
  connectedHumans,
  createRoom,
  isNameTaken,
  newPlayer,
  rooms,
  type Room,
} from '../state.js';
import { addBots, attachBotActions, forgetBots } from '../bots.js';
import {
  boardClick,
  callNumber,
  currentTargetToken,
  handleDisconnect,
  leaderboard,
  leaveMatch,
  resendPrivate,
  setPaused,
  startMatch,
  stopTimers,
  submitPuzzle,
} from '../game.js';

function makeRoom(playerCount: number, config: Partial<Room['config']> = {}): Room {
  const room = createRoom('');
  for (let i = 0; i < playerCount; i++) {
    const p = newPlayer(`p${i}`, `P${i}`, `s${i}`);
    room.players.set(p.id, p);
    room.order.push(p.id);
  }
  room.hostId = 'p0';
  room.config = { ...room.config, numberCount: 25, matchMinutes: 5, ...config };
  return room;
}

const player = (room: Room, id: string) => room.players.get(id)!;

/** The caller picks a number off the board, which is what announces it. */
function call(room: Room, id: string, tokenIndex = 0) {
  const t = room.tokens[tokenIndex];
  boardClick(room, player(room, id), t.x, t.y);
}

/** Click dead centre of the number that's currently in play. */
function clickTarget(room: Room, id: string) {
  const t = currentTargetToken(room)!;
  boardClick(room, player(room, id), t.x, t.y);
}

/** Click a number that is definitely not the one being hunted. */
function clickWrong(room: Room, id: string) {
  const t = currentTargetToken(room)!;
  const other = room.tokens.find((tk) => tk.id !== t.id)!;
  boardClick(room, player(room, id), other.x, other.y);
}

/** Solve whatever puzzle a player currently has open. */
function solve(room: Room, id: string) {
  const pz = room.puzzles.get(id)!;
  const order = pz.target.split('').map((ch) => pz.tiles.find((t) => t.ch === ch)!.id);
  submitPuzzle(room, player(room, id), pz.id, order);
}

let room: Room;

beforeEach(() => {
  vi.useFakeTimers();
  room = makeRoom(3);
});

afterEach(() => {
  stopTimers(room);
  rooms.delete(room.code);
  vi.useRealTimers();
});

describe('names', () => {
  it('spots a name already sitting in the room, whatever the casing', () => {
    expect(isNameTaken(room, 'P1')).toBe(true);
    expect(isNameTaken(room, 'p1')).toBe(true);
    expect(isNameTaken(room, '  P1  ')).toBe(true);
    expect(isNameTaken(room, 'P9')).toBe(false);
  });

  it('lets a player keep their own name when they reconnect', () => {
    expect(isNameTaken(room, 'P1', 'p1')).toBe(false);
    // ...but not take someone else's on the way back in.
    expect(isNameTaken(room, 'P2', 'p1')).toBe(true);
  });
});

describe('match start', () => {
  it('refuses to start with fewer than two players', () => {
    const solo = makeRoom(1);
    expect(startMatch(solo)).toMatch(/at least 2/);
    stopTimers(solo);
    rooms.delete(solo.code);
  });

  it('deals a board and gives the first player the turn', () => {
    expect(startMatch(room)).toBeNull();
    expect(room.phase).toBe('await_call');
    expect(room.tokens).toHaveLength(25);
    expect(room.currentCallerId).toBe('p0');
    // The server does NOT choose the number — the caller does.
    expect(currentTargetToken(room)).toBeNull();
    expect(room.calledValue).toBeNull();
  });
});

describe('calling', () => {
  beforeEach(() => {
    startMatch(room);
  });

  it('lets the caller pick any number off the board', () => {
    const chosen = room.tokens[3];
    call(room, 'p0', 3);
    expect(room.phase).toBe('hunting');
    expect(room.calledValue).toBe(chosen.value);
    expect(currentTargetToken(room)!.id).toBe(chosen.id);
  });

  it('ignores a pick from anyone but the caller', () => {
    call(room, 'p1');
    expect(room.phase).toBe('await_call');
    expect(room.calledValue).toBeNull();
  });

  it('gives the caller their own puzzle so they stay busy', () => {
    call(room, 'p0');
    expect(room.puzzles.has('p0')).toBe(true);
  });

  it('burns the turn when the caller never picks', () => {
    for (const id of ['p0', 'p1', 'p2']) player(room, id).score = 10;

    vi.advanceTimersByTime(PICK_MS + 10);

    expect(player(room, 'p0').score).toBe(10 + MISSED_CALL_PENALTY);
    expect(player(room, 'p1').score).toBe(10 + MISSED_CALL_CONSOLATION);
    expect(player(room, 'p2').score).toBe(10 + MISSED_CALL_CONSOLATION);
    // Turn moves on, and no number left the board.
    expect(room.currentCallerId).toBe('p1');
    expect(room.phase).toBe('await_call');
    expect(room.tokens).toHaveLength(25);
  });

  it('takes a player below zero rather than letting the penalty go free', () => {
    vi.advanceTimersByTime(PICK_MS + 10);
    expect(player(room, 'p0').score).toBe(MISSED_CALL_PENALTY);
  });
});

describe('hunting', () => {
  beforeEach(() => {
    startMatch(room);
    call(room, 'p0');
  });

  it('opens a puzzle for each player who finds the number', () => {
    clickTarget(room, 'p1');
    expect(room.foundBy.has('p1')).toBe(true);
    expect(room.puzzles.has('p1')).toBe(true);

    clickTarget(room, 'p2');
    expect(room.puzzles.has('p2')).toBe(true);
  });

  it('finding the number is worth nothing by itself', () => {
    clickTarget(room, 'p1');
    expect(player(room, 'p1').score).toBe(0);
  });

  it('penalises a wrong number and locks the player out briefly', () => {
    player(room, 'p1').score = 10;
    clickWrong(room, 'p1');
    expect(player(room, 'p1').score).toBe(10 + WRONG_CLICK_PENALTY);
    expect(player(room, 'p1').lockedUntil).toBeGreaterThan(Date.now());

    // A second click inside the lockout is ignored entirely.
    clickWrong(room, 'p1');
    expect(player(room, 'p1').score).toBe(8);
  });

  it('ignores clicks from the caller', () => {
    clickTarget(room, 'p0');
    expect(room.foundBy.has('p0')).toBe(false);
  });

  it('removes the number from the board when the round resolves', () => {
    const target = currentTargetToken(room)!;
    vi.advanceTimersByTime(room.config.findSeconds * 1000 + 10);
    expect(room.tokens.find((t) => t.id === target.id)).toBeUndefined();
    expect(room.tokens).toHaveLength(24);
    expect(room.lastReveal).toEqual({ value: target.value, x: target.x, y: target.y });
  });

  it('passes the turn round-robin', () => {
    vi.advanceTimersByTime(room.config.findSeconds * 1000 + 10);
    expect(room.currentCallerId).toBe('p1');
    call(room, 'p1');
    vi.advanceTimersByTime(room.config.findSeconds * 1000 + 10);
    expect(room.currentCallerId).toBe('p2');
  });
});

describe('the puzzle window', () => {
  beforeEach(() => {
    startMatch(room);
    call(room, 'p0');
  });

  it('scores only on a solve, and faster solves are worth more', () => {
    clickTarget(room, 'p1');
    solve(room, 'p1');
    expect(player(room, 'p1').score).toBe(16);

    // p2 dawdles for 12s before solving: two bonus points gone.
    clickTarget(room, 'p2');
    vi.advanceTimersByTime(12_000);
    solve(room, 'p2');
    expect(player(room, 'p2').score).toBe(14);
  });

  it('hands out a fresh puzzle the moment one is solved', () => {
    clickTarget(room, 'p1');
    const first = room.puzzles.get('p1')!.id;
    solve(room, 'p1');

    const next = room.puzzles.get('p1');
    expect(next).toBeDefined();
    expect(next!.id).not.toBe(first);

    // ...and they can keep banking them for as long as the window is open.
    solve(room, 'p1');
    solve(room, 'p1');
    expect(player(room, 'p1').stats.puzzlesSolved).toBe(3);
    expect(player(room, 'p1').score).toBe(48);
  });

  it('runs the find window to the end even when everyone has found it', () => {
    clickTarget(room, 'p1');
    clickTarget(room, 'p2');
    // Cutting the round short here would rob the fast finders of puzzle time.
    expect(room.phase).toBe('hunting');
    vi.advanceTimersByTime(room.config.findSeconds * 1000 + 10);
    expect(room.phase).toBe('await_call');
  });

  it('rejects a wrong arrangement without penalty', () => {
    clickTarget(room, 'p1');
    const pz = room.puzzles.get('p1')!;
    // The tiles arrive scrambled, so submitting them as-is is wrong.
    submitPuzzle(room, player(room, 'p1'), pz.id, pz.tiles.map((t) => t.id));
    expect(player(room, 'p1').score).toBe(0);
    expect(room.puzzles.has('p1')).toBe(true);
  });

  it('stays open after the find window, right up until the next call', () => {
    clickTarget(room, 'p2');

    // Find window expires — the round resolves but p2's puzzle survives.
    vi.advanceTimersByTime(room.config.findSeconds * 1000 + 10);
    expect(room.phase).toBe('await_call');
    expect(room.puzzles.has('p2')).toBe(true);

    // Still solvable during the next caller's thinking time.
    solve(room, 'p2');
    expect(player(room, 'p2').score).toBeGreaterThan(0);
  });

  it('closes only the incoming caller\'s puzzle, so they can pick a number', () => {
    clickTarget(room, 'p1');
    clickTarget(room, 'p2');
    vi.advanceTimersByTime(room.config.findSeconds * 1000 + 10);

    // The turn has passed to p1, so p1 goes back to the board...
    expect(room.currentCallerId).toBe('p1');
    expect(room.puzzles.has('p1')).toBe(false);
    // ...while everybody else carries on solving.
    expect(room.puzzles.has('p2')).toBe(true);
    expect(room.puzzles.has('p0')).toBe(true);
  });

  it('closes every open puzzle the moment the next number is called', () => {
    clickTarget(room, 'p1');
    vi.advanceTimersByTime(room.config.findSeconds * 1000 + 10);
    expect(room.puzzles.size).toBeGreaterThan(0);

    call(room, 'p1');
    // Only the new caller's fresh puzzle remains.
    expect([...room.puzzles.keys()]).toEqual(['p1']);
  });

  it('works for a two-player room: the finder solves for the rest of the window', () => {
    const duo = makeRoom(2);
    startMatch(duo);
    call(duo, 'p0');
    clickTarget(duo, 'p1');

    // The round does not end early, so p1 banks puzzles for the remaining window.
    expect(duo.phase).toBe('hunting');
    solve(duo, 'p1');
    vi.advanceTimersByTime(8_000);
    solve(duo, 'p1');
    expect(player(duo, 'p1').stats.puzzlesSolved).toBe(2);
    expect(player(duo, 'p1').score).toBe(16 + 15);

    // Then the turn comes round to them and the board is back.
    vi.advanceTimersByTime(duo.config.findSeconds * 1000);
    expect(duo.currentCallerId).toBe('p1');
    expect(duo.puzzles.has('p1')).toBe(false);
    stopTimers(duo);
    rooms.delete(duo.code);
  });
});

describe('leaving', () => {
  beforeEach(() => {
    startMatch(room);
  });

  it('keeps a walked-out player on the leaderboard, flagged', () => {
    call(room, 'p0');
    clickTarget(room, 'p1');
    solve(room, 'p1');
    const banked = player(room, 'p1').score;

    leaveMatch(room, player(room, 'p1'));

    const row = leaderboard(room).find((r) => r.playerId === 'p1')!;
    expect(row.left).toBe(true);
    expect(row.score).toBe(banked);
  });

  it('drops a leaver out of the rotation entirely', () => {
    leaveMatch(room, player(room, 'p1'));
    call(room, 'p0');
    vi.advanceTimersByTime(room.config.findSeconds * 1000 + 10);
    // p1 is skipped, not just delayed.
    expect(room.currentCallerId).toBe('p2');
  });

  it('moves the turn on immediately when the caller walks out', () => {
    expect(room.currentCallerId).toBe('p0');
    leaveMatch(room, player(room, 'p0'));
    expect(room.currentCallerId).toBe('p1');
    expect(room.phase).toBe('await_call');
  });

  it('ends the match when it drops below two players', () => {
    call(room, 'p0');
    leaveMatch(room, player(room, 'p2'));
    expect(room.phase).toBe('hunting');

    leaveMatch(room, player(room, 'p1'));
    expect(['wrapup', 'ended']).toContain(room.phase);
    expect(room.endReason).toBe('not_enough_players');
  });

  it('ignores board clicks from someone who left', () => {
    call(room, 'p0');
    leaveMatch(room, player(room, 'p1'));
    clickWrong(room, 'p1');
    expect(player(room, 'p1').score).toBe(0);
    expect(player(room, 'p1').stats.wrongClicks).toBe(0);
  });

  it('leaves a missed-call consolation to the players still in', () => {
    leaveMatch(room, player(room, 'p2'));
    vi.advanceTimersByTime(PICK_MS + 10);
    expect(player(room, 'p1').score).toBe(MISSED_CALL_CONSOLATION);
    expect(player(room, 'p2').score).toBe(0);
  });
});

describe('dropped connections', () => {
  beforeEach(() => {
    startMatch(room);
    call(room, 'p0');
  });

  it('keeps an open puzzle so a wifi blip costs nothing', () => {
    clickTarget(room, 'p1');
    const pz = room.puzzles.get('p1')!.id;

    handleDisconnect(room, player(room, 'p1'));
    // The puzzle is still theirs; resendPrivate hands it back on return.
    expect(room.puzzles.get('p1')?.id).toBe(pz);

    player(room, 'p1').connected = true;
    player(room, 'p1').socketId = 's1';
    solve(room, 'p1');
    expect(player(room, 'p1').score).toBeGreaterThan(0);
  });

  it('ends the match if a room is left with one player for too long', () => {
    handleDisconnect(room, player(room, 'p1'));
    handleDisconnect(room, player(room, 'p2'));
    // Still running: they might just be refreshing.
    expect(room.phase).toBe('hunting');

    vi.advanceTimersByTime(LONELY_GRACE_MS + 100);
    expect(['wrapup', 'ended']).toContain(room.phase);
    expect(room.endReason).toBe('not_enough_players');
  });

  it('stops fining the last player standing', () => {
    vi.advanceTimersByTime(room.config.findSeconds * 1000 + 10);
    handleDisconnect(room, player(room, 'p0'));
    handleDisconnect(room, player(room, 'p2'));
    const before = player(room, 'p1').score;

    // p1 is alone and holds the turn; letting it lapse shouldn't cost them anything.
    vi.advanceTimersByTime(PICK_MS + 10);
    expect(player(room, 'p1').score).toBe(before);
  });

  it('calls off the grace clock when somebody comes back', () => {
    handleDisconnect(room, player(room, 'p1'));
    handleDisconnect(room, player(room, 'p2'));

    player(room, 'p1').connected = true;
    player(room, 'p1').socketId = 's1';
    resendPrivate(room, player(room, 'p1'));

    vi.advanceTimersByTime(LONELY_GRACE_MS + 100);
    expect(room.endReason).toBeNull();
  });
});

describe('ending', () => {
  it('runs a wrapup grace period so open puzzles can be banked', () => {
    startMatch(room);
    call(room, 'p0');
    clickTarget(room, 'p1');

    // Match clock runs out while p1 is still mid-puzzle.
    room.matchEndsAt = Date.now() + 1500;
    vi.advanceTimersByTime(2100);
    expect(room.phase).toBe('wrapup');

    solve(room, 'p1');
    expect(player(room, 'p1').score).toBeGreaterThan(0);
    // No replacement puzzle during wrapup — the stream is over.
    expect(room.puzzles.has('p1')).toBe(false);
    // p0 (the caller) still has a puzzle open, so the grace period holds.
    expect(room.phase).toBe('wrapup');

    // Once the last outstanding puzzle is in, there's nothing left to wait for.
    solve(room, 'p0');
    expect(room.phase).toBe('ended');
  });

  it('finalises when the grace period expires with puzzles unsolved', () => {
    startMatch(room);
    call(room, 'p0');
    clickTarget(room, 'p1');
    room.matchEndsAt = Date.now() + 1500;
    vi.advanceTimersByTime(2100);
    expect(room.phase).toBe('wrapup');

    vi.advanceTimersByTime(WRAPUP_MS + 100);
    expect(room.phase).toBe('ended');
    expect(player(room, 'p1').score).toBe(0);
  });

  it('ends as soon as the board is cleared', () => {
    const quick = makeRoom(2, { numberCount: 20 });
    startMatch(quick);
    quick.tokens = quick.tokens.slice(0, 1);
    call(quick, 'p0');
    vi.advanceTimersByTime(quick.config.findSeconds * 1000 + 10);
    // Board is empty now; the only thing left is the callers' puzzles.
    expect(['wrapup', 'ended']).toContain(quick.phase);
    expect(quick.endReason).toBe('board_cleared');
    stopTimers(quick);
    rooms.delete(quick.code);
  });

  it('skips a caller who drops out mid-turn', () => {
    startMatch(room);
    expect(room.currentCallerId).toBe('p0');
    handleDisconnect(room, player(room, 'p0'));
    expect(room.currentCallerId).toBe('p1');
    expect(room.phase).toBe('await_call');
  });

  it('ranks ties by puzzles solved, then by fewer wrong clicks', () => {
    startMatch(room);
    player(room, 'p1').score = 20;
    player(room, 'p1').stats.puzzlesSolved = 2;
    player(room, 'p2').score = 20;
    player(room, 'p2').stats.puzzlesSolved = 1;
    const rows = leaderboard(room);
    expect(rows[0].playerId).toBe('p1');
    expect(rows[1].playerId).toBe('p2');
  });
});

describe('pausing', () => {
  it('refuses to hold the clocks in a real match', () => {
    startMatch(room);
    const matchEnd = room.matchEndsAt!;
    // One player must never be able to freeze everybody else's game.
    setPaused(room, true);
    expect(room.pausedAt).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(room.matchEndsAt!).toBe(matchEnd);
  });
});

describe('practice matches', () => {
  /** A practice room as `room:practice` builds one: one human, then two bots. */
  function makePractice(): Room {
    const r = createRoom('', true);
    const human = newPlayer('h0', 'Human', 's0');
    r.players.set(human.id, human);
    r.order.push(human.id);
    r.hostId = human.id;
    r.config = { ...PRACTICE_CONFIG, numberCount: 25 };
    addBots(r, 2);
    return r;
  }

  let practice: Room;

  beforeEach(() => {
    // Production wires this up in index.ts. Bots reach the game through the same entry
    // points a socket does, so the tests drive the real ones rather than stubs.
    attachBotActions({
      callNumber,
      boardClick,
      submitPuzzle,
      narrate: () => {},
    });
    practice = makePractice();
  });

  afterEach(() => {
    stopTimers(practice);
    forgetBots(practice);
    rooms.delete(practice.code);
  });

  it('seats two bots and avoids reusing the human\'s name', () => {
    const bots = [...practice.players.values()].filter((p) => p.isBot);
    expect(bots).toHaveLength(2);
    expect(bots.map((b) => b.name)).not.toContain('Human');
    expect(new Set(bots.map((b) => b.name)).size).toBe(2);
  });

  it('gives the human the first turn, so the tutorial opens on a call', () => {
    expect(startMatch(practice)).toBeNull();
    expect(practice.currentCallerId).toBe('h0');
    expect(practice.phase).toBe('await_call');
  });

  it('gives the human a long pick window, but keeps bots on the normal clock', () => {
    startMatch(practice);
    // The human is calling: they get the reading-time window, not the 25s one.
    expect(practice.phaseEndsAt! - Date.now()).toBeGreaterThan(PICK_MS * 2);

    // Their turn over, the next caller is a bot and the clock goes back to normal.
    call(practice, 'h0');
    vi.advanceTimersByTime(practice.config.findSeconds * 1000);
    expect(practice.players.get(practice.currentCallerId!)!.isBot).toBe(true);
    expect(practice.phaseEndsAt! - Date.now()).toBeLessThanOrEqual(PICK_MS);
  });

  it('keeps the practice call window inside the practice match', () => {
    startMatch(practice);
    // The bug this guards: a pick window longer than the match it sits in, which showed
    // the player "MATCH 5:20 / CALLING 9:20".
    expect(PRACTICE_PICK_MS).toBeLessThan(PRACTICE_CONFIG.matchMinutes * 60_000);
    expect(practice.phaseEndsAt!).toBeLessThanOrEqual(practice.matchEndsAt!);
  });

  it('never lets a phase clock outlast the match clock', () => {
    startMatch(practice);
    // Squeeze the match down to less than one find window.
    practice.matchEndsAt = Date.now() + 20_000;

    call(practice, 'h0');
    expect(practice.phase).toBe('hunting');
    expect(practice.phaseEndsAt!).toBe(practice.matchEndsAt!);

    // ...and the same for a call window opened near the end.
    handleDisconnect(practice, player(practice, 'h0'));
    expect(practice.phaseEndsAt!).toBeLessThanOrEqual(practice.matchEndsAt!);
  });

  it('holds the clocks while a coach instruction is open, then puts them back', () => {
    startMatch(practice);
    const matchEnd = practice.matchEndsAt!;
    const phaseEnd = practice.phaseEndsAt!;

    setPaused(practice, true);
    vi.advanceTimersByTime(30_000);
    // Nothing expired behind the card: both deadlines moved with the pause.
    expect(practice.phase).toBe('await_call');

    setPaused(practice, false);
    expect(practice.matchEndsAt!).toBe(matchEnd + 30_000);
    expect(practice.phaseEndsAt!).toBe(phaseEnd + 30_000);
  });

  it('does not let reading time eat the puzzle speed bonus', () => {
    startMatch(practice);
    call(practice, 'h0');
    const startedAt = practice.puzzles.get('h0')!.startedAt;

    setPaused(practice, true);
    vi.advanceTimersByTime(20_000);
    setPaused(practice, false);

    expect(practice.puzzles.get('h0')!.startedAt).toBe(startedAt + 20_000);
  });

  it('gives a full find window to a number called from behind an open card', () => {
    startMatch(practice);
    setPaused(practice, true);
    vi.advanceTimersByTime(40_000); // reading, at length

    call(practice, 'h0'); // acted on while the clocks were still held
    setPaused(practice, false);

    // Not 75s + the 40s spent reading.
    const left = practice.phaseEndsAt! - Date.now();
    expect(left).toBeGreaterThan(74_000);
    expect(left).toBeLessThanOrEqual(75_000);
  });

  it('starts the clocks again if a card is left open for too long', () => {
    startMatch(practice);
    setPaused(practice, true);
    vi.advanceTimersByTime(COACH_MAX_PAUSE_MS + 2000);
    // The tick gives up on a room nobody is reading and lets it run again.
    expect(practice.pausedAt).toBeNull();
  });

  it('never penalises a missed call', () => {
    startMatch(practice);
    // Sit on the turn until it expires.
    vi.advanceTimersByTime(PRACTICE_PICK_MS + 10);
    for (const p of practice.players.values()) expect(p.score).toBe(0);
  });

  it('bots take their turn and hunt without a socket', () => {
    startMatch(practice);
    call(practice, 'h0');
    vi.advanceTimersByTime(practice.config.findSeconds * 1000);

    // A bot is now calling; let its thinking time elapse.
    expect(practice.phase).toBe('await_call');
    vi.advanceTimersByTime(6000);
    expect(practice.phase).toBe('hunting');
    expect(practice.calledValue).not.toBeNull();
  });

  it('ends the moment its one human walks out, rather than playing on with bots', () => {
    startMatch(practice);
    expect(practice.phase).toBe('await_call');
    leaveMatch(practice, player(practice, 'h0'));
    // Two bots are still "connected", so only a human-aware check ends this.
    expect(practice.phase).toBe('ended');
  });

  it('keeps bots out of the leaderboard\'s host and name checks', () => {
    // A bot name must still block a human from taking it, so the board stays readable.
    const bot = [...practice.players.values()].find((p) => p.isBot)!;
    expect(isNameTaken(practice, bot.name)).toBe(true);
    expect(connectedHumans(practice)).toHaveLength(1);
  });
});
