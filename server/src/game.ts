import type { Server } from 'socket.io';
import {
  COACH_MAX_PAUSE_MS,
  LONELY_GRACE_MS,
  MISSED_CALL_CONSOLATION,
  MISSED_CALL_PENALTY,
  PICK_MS,
  PRACTICE_PICK_MS,
  S2C,
  WRAPUP_MS,
  WRONG_CLICK_LOCKOUT_MS,
  WRONG_CLICK_PENALTY,
  PUZZLE_SOFT_SECONDS,
  applyDelta,
  generateBoard,
  generatePuzzle,
  hitTest,
  scorePuzzle,
} from '@game/shared';
import type {
  BotActivityPayload,
  EndReason,
  GameOverPayload,
  LeaderboardRow,
  NumberToken,
  PuzzleView,
} from '@game/shared';
import {
  activePlayers,
  connectedHumans,
  connectedPlayers,
  makeId,
  publicState,
  type PlayerInternal,
  type PuzzleInternal,
  type Room,
} from './state.js';
import {
  clearBotTimers,
  onAwaitCall,
  onBotSolved,
  onCalled,
  onPuzzleOpened,
  pauseBotTimers,
  resumeBotTimers,
} from './bots.js';

let io: Server | null = null;
export function attachIo(server: Server) {
  io = server;
}

/* ------------------------------------------------------------------ emitting */

function toRoom(room: Room, event: string, payload?: unknown) {
  io?.to(room.code).emit(event, payload);
}

function toPlayer(player: PlayerInternal, event: string, payload?: unknown) {
  if (player.socketId) io?.to(player.socketId).emit(event, payload);
}

export function broadcastState(room: Room) {
  toRoom(room, S2C.state, publicState(room));
}

/** Practice narration. Nobody else is in the room, so a plain broadcast is fine. */
export function narrateBot(room: Room, payload: BotActivityPayload) {
  toRoom(room, S2C.botActivity, payload);
}

/**
 * A practice room lives and dies with its one human — bots report as connected forever,
 * so every liveness question has to be asked about the people instead.
 */
function enoughToPlay(room: Room): boolean {
  return room.practice
    ? connectedHumans(room).length >= 1
    : connectedPlayers(room).length >= 2;
}

function puzzleView(p: PuzzleInternal): PuzzleView {
  return {
    id: p.id,
    target: p.target,
    tiles: p.tiles,
    startedAt: p.startedAt,
    softSeconds: PUZZLE_SOFT_SECONDS,
  };
}

/* -------------------------------------------------------------------- timers */

function clearPhaseTimer(room: Room) {
  if (room.timers.phase) {
    clearTimeout(room.timers.phase);
    room.timers.phase = null;
  }
}

/**
 * The clock everything with a deadline is measured against.
 *
 * While the coach is holding the clocks this is the moment they stopped, not the real
 * time — the player can still act behind an open card, and a phase started then has to
 * begin where the clocks are, or resuming would shift it by the whole pause on top of
 * the time it had already been given.
 */
function nowIn(room: Room): number {
  return room.pausedAt ?? Date.now();
}

/**
 * Start a phase, never promising more time than the match itself has left.
 *
 * Without this the phase clock can count down from longer than the match clock — a
 * 2 minute call window with 90s left on the match reads as "MATCH 1:30 / CALLING 2:00",
 * which is nonsense, and the phase clock is the one players actually act on.
 */
function beginPhase(room: Room, ms: number, fn: () => void) {
  const endsAt = Math.min(
    nowIn(room) + Math.max(0, ms),
    room.matchEndsAt ?? Number.MAX_SAFE_INTEGER,
  );
  room.phaseEndsAt = endsAt;
  return () => setPhaseTimer(room, endsAt - nowIn(room), fn);
}

function setPhaseTimer(room: Room, ms: number, fn: () => void) {
  clearPhaseTimer(room);
  // Remembered so a pause can cancel this timer and re-arm the same outcome later.
  room.phaseFn = fn;
  if (room.pausedAt !== null) return;
  room.timers.phase = setTimeout(() => {
    room.timers.phase = null;
    try {
      fn();
    } catch (err) {
      console.error(`[room ${room.code}] phase timer failed`, err);
    }
  }, Math.max(0, ms));
}

function startTicking(room: Room) {
  if (room.timers.tick) clearInterval(room.timers.tick);
  room.timers.tick = setInterval(() => {
    const now = Date.now();
    // While the clocks are held, every deadline is read against the moment they stopped,
    // so both counters sit still instead of draining behind a coach card.
    const shown = room.pausedAt ?? now;

    toRoom(room, S2C.tick, {
      matchLeftMs: room.matchEndsAt ? Math.max(0, room.matchEndsAt - shown) : null,
      phaseLeftMs: room.phaseEndsAt ? Math.max(0, room.phaseEndsAt - shown) : null,
      paused: room.pausedAt !== null,
    });

    if (room.pausedAt !== null) {
      // Somebody walked away with a card open. Don't leave the room frozen for ever.
      if (now - room.pausedAt > COACH_MAX_PAUSE_MS) setPaused(room, false);
      return;
    }

    if (
      room.matchEndsAt &&
      now >= room.matchEndsAt &&
      (room.phase === 'await_call' || room.phase === 'hunting')
    ) {
      endMatch(room, 'time_up');
    }
  }, 1000);
}

/**
 * Hold (or release) the clocks while the player reads a coach instruction.
 *
 * Practice only, and deliberately so: letting one player stop the clock would be a way
 * to freeze everybody else's match. Nothing is cancelled — every deadline, and every
 * bot action, is shifted forward by exactly how long the pause lasted, so the match
 * resumes in the state it was left in rather than lurching.
 */
export function setPaused(room: Room, paused: boolean) {
  if (!room.practice) return;
  const running =
    room.phase === 'await_call' || room.phase === 'hunting' || room.phase === 'wrapup';
  if (!running) return;

  if (paused) {
    if (room.pausedAt !== null) return;
    room.pausedAt = Date.now();
    clearPhaseTimer(room);
    pauseBotTimers(room);
    return;
  }

  if (room.pausedAt === null) return;
  const held = Date.now() - room.pausedAt;
  room.pausedAt = null;

  if (room.matchEndsAt) room.matchEndsAt += held;
  if (room.phaseEndsAt) room.phaseEndsAt += held;
  // Open puzzles too, or reading a step would quietly eat the player's speed bonus.
  for (const pz of room.puzzles.values()) pz.startedAt += held;
  resumeBotTimers(room, held);

  if (room.phaseFn && room.phaseEndsAt) {
    setPhaseTimer(room, room.phaseEndsAt - Date.now(), room.phaseFn);
  }
}

export function stopTimers(room: Room) {
  clearPhaseTimer(room);
  clearBotTimers(room);
  room.phaseFn = null;
  room.pausedAt = null;
  if (room.timers.tick) {
    clearInterval(room.timers.tick);
    room.timers.tick = null;
  }
  if (room.timers.lonely) {
    clearTimeout(room.timers.lonely);
    room.timers.lonely = null;
  }
}

/* ---------------------------------------------------------------- match flow */

export function startMatch(room: Room): string | null {
  if (room.phase !== 'lobby' && room.phase !== 'ended') return 'Match already running';
  if (connectedPlayers(room).length < 2) return 'Need at least 2 players to start';

  // A rematch reuses the room, so anything a bot still had planned for the last match
  // must not fire into this one.
  clearBotTimers(room);

  room.seed = Math.floor(Math.random() * 2 ** 31);
  room.tokens = generateBoard(room.config.numberCount, room.seed);
  room.callerIdx = -1;
  room.roundNumber = 0;
  room.foundBy.clear();
  room.puzzles.clear();
  room.calledValue = null;
  room.target = null;
  room.lastReveal = null;
  room.endReason = null;
  room.puzzleSeq = 0;
  room.readyForNext.clear();
  room.matchEndsAt = Date.now() + room.config.matchMinutes * 60_000;

  for (const p of room.players.values()) {
    p.score = 0;
    p.lockedUntil = 0;
    p.stats = { puzzlesSolved: 0, numbersFound: 0, wrongClicks: 0 };
  }

  startTicking(room);
  // The board goes out once here, then only as `board:remove` deltas.
  toRoom(room, S2C.boardInit, { tokens: room.tokens });
  beginAwaitCall(room);
  return null;
}

/**
 * Pass the turn to the next player. They pick a number off the board themselves — the
 * server never chooses it for them. Puzzles opened in the previous round stay open right
 * through this phase; they only close when the next number is actually called.
 */
export function beginAwaitCall(room: Room) {
  if (room.tokens.length === 0) {
    endMatch(room, 'board_cleared');
    return;
  }

  const caller = nextCaller(room);
  if (!caller) {
    // Everyone dropped. Park here; a reconnect resumes the round.
    room.phase = 'await_call';
    room.currentCallerId = null;
    room.target = null;
    room.calledValue = null;
    room.phaseEndsAt = null;
    clearPhaseTimer(room);
    broadcastState(room);
    return;
  }

  // Everyone else keeps solving; the new caller's puzzle closes so they can see the
  // board and choose a number.
  closePuzzle(room, caller.id, 'your_turn');

  room.phase = 'await_call';
  room.roundNumber += 1;
  room.currentCallerId = caller.id;
  room.target = null;
  room.calledValue = null;
  room.foundBy.clear();

  // A practice human gets a long window to read the coach and work out what "call a
  // number" even means. Bots are on the normal clock; they act within a few seconds.
  const pickMs = room.practice && !caller.isBot ? PRACTICE_PICK_MS : PICK_MS;
  const armPick = beginPhase(room, pickMs, () => missCall(room));

  broadcastState(room);
  armPick();
  onAwaitCall(room);
}

/**
 * The caller sat on their turn. They pay for it, everyone who was waiting gets a little
 * something for the wasted time, and the turn moves on. No number leaves the board.
 */
function missCall(room: Room) {
  if (room.phase !== 'await_call' || !room.currentCallerId) return;

  const caller = room.players.get(room.currentCallerId);
  // With nobody else connected there is no turn to waste and nobody kept waiting, so
  // the last player standing isn't fined while the room winds down. Practice never
  // fines anybody — it exists to be got wrong.
  const scoring = connectedPlayers(room).length >= 2 && !room.practice;

  if (scoring) {
    if (caller) caller.score = applyDelta(caller.score, MISSED_CALL_PENALTY);
    for (const p of activePlayers(room)) {
      if (p.id === room.currentCallerId) continue;
      p.score = applyDelta(p.score, MISSED_CALL_CONSOLATION);
    }
    toRoom(room, S2C.turnMissed, {
      callerId: room.currentCallerId,
      name: caller?.name ?? 'Someone',
      penalty: MISSED_CALL_PENALTY,
      consolation: MISSED_CALL_CONSOLATION,
    });
  }

  if (room.matchEndsAt && Date.now() >= room.matchEndsAt) {
    endMatch(room, 'time_up');
    return;
  }
  beginAwaitCall(room);
}

/** Advance the round-robin pointer to the next connected player. */
function nextCaller(room: Room): PlayerInternal | null {
  if (room.order.length === 0) return null;
  for (let step = 1; step <= room.order.length; step++) {
    const idx = (room.callerIdx + step) % room.order.length;
    const p = room.players.get(room.order[idx]);
    if (p?.connected && !p.left) {
      room.callerIdx = idx;
      return p;
    }
  }
  return null;
}

/** The caller has chosen `token` off the board: announce it and start the hunt. */
export function callNumber(room: Room, token: NumberToken) {
  if (room.phase !== 'await_call' || !room.currentCallerId) return;

  room.target = token;
  clearPhaseTimer(room);

  // The previous round's puzzle window closes exactly here — this is what gives players
  // time to keep solving after the find window, right up until the next call.
  closeAllPuzzles(room);

  room.phase = 'hunting';
  room.calledValue = room.target.value;
  room.foundBy.clear();
  room.lastReveal = null;
  const armFind = beginPhase(room, room.config.findSeconds * 1000, () =>
    resolveRound(room),
  );

  // The caller is busy with their own puzzle so they can't help (or gloat).
  const caller = room.players.get(room.currentCallerId!);
  if (caller) openPuzzle(room, caller);

  toRoom(room, S2C.turnCalled, {
    value: room.calledValue,
    callerId: room.currentCallerId,
  });
  broadcastState(room);

  armFind();
  onCalled(room);
}

/**
 * Every board click comes through here. Which job it does depends on the phase: during
 * `await_call` the caller is choosing a number, during `hunting` everyone else is looking
 * for it.
 */
export function boardClick(room: Room, player: PlayerInternal, x: number, y: number) {
  if (player.left) return;

  if (room.phase === 'await_call') {
    if (player.id !== room.currentCallerId) return;
    const pick = hitTest(room.tokens, x, y);
    if (pick) callNumber(room, pick);
    return;
  }

  if (room.phase !== 'hunting' || !room.target) return;
  if (player.id === room.currentCallerId) return;
  if (room.foundBy.has(player.id)) return;
  if (Date.now() < player.lockedUntil) return;

  const hit = hitTest(room.tokens, x, y);
  if (!hit) return; // Clicking empty space is free — only wrong numbers cost you.

  if (hit.id === room.target.id) {
    room.foundBy.add(player.id);
    player.stats.numbersFound += 1;
    toRoom(room, S2C.boardFound, { playerId: player.id, name: player.name });
    openPuzzle(room, player);
    broadcastState(room);
    return;
  }

  player.score = applyDelta(player.score, WRONG_CLICK_PENALTY);
  player.stats.wrongClicks += 1;
  player.lockedUntil = Date.now() + WRONG_CLICK_LOCKOUT_MS;
  toRoom(room, S2C.boardWrong, {
    playerId: player.id,
    penalty: WRONG_CLICK_PENALTY,
    lockedUntilMs: WRONG_CLICK_LOCKOUT_MS,
  });
  broadcastState(room);
}

function resolveRound(room: Room) {
  if (room.phase !== 'hunting' || !room.target) return;
  clearPhaseTimer(room);

  const target = room.target;
  room.tokens = room.tokens.filter((t) => t.id !== target.id);
  toRoom(room, S2C.boardRemove, { tokenId: target.id });
  room.lastReveal = { value: target.value, x: target.x, y: target.y };
  room.target = null;
  room.calledValue = null;
  room.phaseEndsAt = null;

  if (room.matchEndsAt && Date.now() >= room.matchEndsAt) {
    endMatch(room, 'time_up');
    return;
  }
  beginAwaitCall(room);
}

/* ------------------------------------------------------------------- puzzles */

function openPuzzle(room: Room, player: PlayerInternal) {
  const seed = (room.seed ^ (room.puzzleSeq++ * 2654435761)) >>> 0;
  const { target, tiles } = generatePuzzle(
    room.config.puzzleLength,
    room.config.puzzleCharset,
    seed,
  );
  const puzzle: PuzzleInternal = {
    id: makeId('pz'),
    playerId: player.id,
    target,
    tiles,
    // Frozen clock, for the same reason as a phase: a puzzle opened behind a coach card
    // must not be shifted forward by a pause it was never part of.
    startedAt: nowIn(room),
    roundNumber: room.roundNumber,
  };
  room.puzzles.set(player.id, puzzle);
  toPlayer(player, S2C.puzzleStart, puzzleView(puzzle));
  onPuzzleOpened(room, player, puzzle);
}

function closePuzzle(room: Room, playerId: string, reason: string) {
  const puzzle = room.puzzles.get(playerId);
  if (!puzzle) return;
  room.puzzles.delete(playerId);
  const p = room.players.get(playerId);
  if (p) toPlayer(p, S2C.puzzleEnd, { puzzleId: puzzle.id, reason });
}

function closeAllPuzzles(room: Room) {
  for (const [playerId, puzzle] of room.puzzles) {
    const p = room.players.get(playerId);
    if (p) toPlayer(p, S2C.puzzleEnd, { puzzleId: puzzle.id, reason: 'window_closed' });
  }
  room.puzzles.clear();
}

export function submitPuzzle(
  room: Room,
  player: PlayerInternal,
  puzzleId: string,
  order: string[],
) {
  const puzzle = room.puzzles.get(player.id);
  if (!puzzle || puzzle.id !== puzzleId) return;

  const byId = new Map(puzzle.tiles.map((t) => [t.id, t.ch]));
  if (order.length !== puzzle.tiles.length || new Set(order).size !== order.length) return;

  let attempt = '';
  for (const id of order) {
    const ch = byId.get(id);
    if (ch === undefined) return;
    attempt += ch;
  }

  if (attempt !== puzzle.target) {
    toPlayer(player, S2C.puzzleResult, {
      puzzleId,
      correct: false,
      delta: 0,
      total: player.score,
    });
    return;
  }

  const delta = scorePuzzle(Date.now() - puzzle.startedAt);
  player.score = applyDelta(player.score, delta);
  player.stats.puzzlesSolved += 1;
  room.puzzles.delete(player.id);
  if (player.isBot) onBotSolved(room, player, delta);

  toPlayer(player, S2C.puzzleResult, {
    puzzleId,
    correct: true,
    delta,
    total: player.score,
  });

  // Solving buys you another one. The stream runs until the turn moves on, so the
  // reward for finding the number fast is more time to keep banking puzzles.
  if (room.phase === 'hunting' || room.phase === 'await_call') {
    openPuzzle(room, player);
  } else {
    // Match is wrapping up, so there is no replacement coming. Say so, or the client
    // would sit staring at the puzzle it just solved.
    toPlayer(player, S2C.puzzleEnd, { puzzleId, reason: 'match_over' });
  }
  broadcastState(room);

  // In wrapup we're only waiting on open puzzles; once they're all in, finish.
  if (room.phase === 'wrapup' && room.puzzles.size === 0) {
    finalize(room, room.endReason ?? 'time_up');
  }
}

/* ------------------------------------------------------------------ match end */

export function endMatch(room: Room, reason: EndReason) {
  if (room.phase === 'ended' || room.phase === 'wrapup') return;
  clearPhaseTimer(room);
  room.endReason = reason;
  room.calledValue = null;
  room.target = null;
  room.currentCallerId = null;

  // Give anyone mid-puzzle a moment to bank it rather than snatching the board away.
  if (room.puzzles.size > 0) {
    room.phase = 'wrapup';
    room.phaseEndsAt = Date.now() + WRAPUP_MS;
    broadcastState(room);
    setPhaseTimer(room, WRAPUP_MS, () => finalize(room, reason));
    return;
  }
  finalize(room, reason);
}

function finalize(room: Room, reason: EndReason) {
  stopTimers(room);
  closeAllPuzzles(room);
  room.phase = 'ended';
  room.phaseEndsAt = null;
  room.matchEndsAt = null;
  room.endReason = reason;

  const payload: GameOverPayload = { reason, leaderboard: leaderboard(room) };
  broadcastState(room);
  toRoom(room, S2C.gameOver, payload);
}

export function leaderboard(room: Room): LeaderboardRow[] {
  const rows = room.order
    .map((id) => room.players.get(id))
    .filter((p): p is PlayerInternal => !!p)
    .map((p) => ({
      playerId: p.id,
      name: p.name,
      score: p.score,
      puzzlesSolved: p.stats.puzzlesSolved,
      numbersFound: p.stats.numbersFound,
      wrongClicks: p.stats.wrongClicks,
      rank: 0,
      left: p.left,
    }));

  rows.sort(
    (a, b) =>
      // Anyone who walked out ranks below everyone who saw it through, whatever the
      // scores. The rule that a quitter isn't crowned already existed, but it only
      // applied to the winner line — so the banner could congratulate someone on -15
      // while the table above it showed a departed player 1st on 9. One sort, and the
      // banner, the medal and the table finally agree.
      Number(a.left) - Number(b.left) ||
      b.score - a.score ||
      b.puzzlesSolved - a.puzzlesSolved ||
      a.wrongClicks - b.wrongClicks ||
      a.name.localeCompare(b.name),
  );

  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    // A leaver never shares a rank with someone who stayed, even on the same score.
    const tied = prev && prev.score === row.score && prev.left === row.left;
    row.rank = tied ? prev.rank : i + 1;
  });
  return rows;
}

/* --------------------------------------------------- connection side-effects */

/**
 * A match needs two people. Once it's down to one — or nobody — there's no game left
 * to play, so we close it out and show the leaderboard rather than leaving someone
 * staring at a board on their own.
 *
 * Walking out counts immediately: that player said they were done.
 */
function endIfTooFewPlayers(room: Room): boolean {
  if (room.phase === 'lobby' || room.phase === 'ended') return false;
  if (room.practice) {
    // Bots would happily play on by themselves. Without the human there is no match.
    if (connectedHumans(room).some((p) => !p.left)) return false;
  } else if (activePlayers(room).length >= 2) {
    return false;
  }
  endMatch(room, 'not_enough_players');
  return true;
}

/**
 * Closing a tab looks exactly like a flaky connection, so we can't end the match the
 * instant someone goes quiet — a refresh would kill the game. Instead, when a room is
 * down to fewer than two people actually connected, we start a grace clock; if nobody
 * has come back by the time it fires, the match is over. Anyone reconnecting cancels it.
 */
function checkLonely(room: Room) {
  const running =
    room.phase === 'await_call' || room.phase === 'hunting' || room.phase === 'wrapup';

  if (!running || enoughToPlay(room)) {
    if (room.timers.lonely) {
      clearTimeout(room.timers.lonely);
      room.timers.lonely = null;
    }
    return;
  }
  if (room.timers.lonely) return;

  room.timers.lonely = setTimeout(() => {
    room.timers.lonely = null;
    if (enoughToPlay(room)) return;
    if (room.phase === 'wrapup') {
      // Nobody is left to finish those puzzles, so stop waiting on them.
      finalize(room, room.endReason ?? 'not_enough_players');
    } else if (room.phase === 'await_call' || room.phase === 'hunting') {
      endMatch(room, 'not_enough_players');
    }
  }, LONELY_GRACE_MS);
}

/**
 * A deliberate walk-out, as opposed to a dropped connection. The seat is kept so their
 * score still shows on the final board, but they are out of the rotation for good.
 */
export function leaveMatch(room: Room, player: PlayerInternal) {
  player.left = true;
  player.connected = false;
  player.socketId = null;
  room.puzzles.delete(player.id);
  room.foundBy.delete(player.id);
  room.readyForNext.delete(player.id);

  if (endIfTooFewPlayers(room)) return;

  if (room.phase === 'await_call' && room.currentCallerId === player.id) {
    clearPhaseTimer(room);
    beginAwaitCall(room);
    return;
  }
  if (room.phase === 'wrapup' && room.puzzles.size === 0) {
    finalize(room, room.endReason ?? 'time_up');
    return;
  }
  broadcastState(room);
}

export function handleDisconnect(room: Room, player: PlayerInternal) {
  // Whatever they were reading, they aren't any more.
  setPaused(room, false);
  player.connected = false;
  player.socketId = null;
  player.disconnectedAt = Date.now();
  // Their puzzle stays open on purpose: a few seconds of bad wifi shouldn't cost the
  // round, and `resendPrivate` hands it straight back when they return. The clock keeps
  // running on it, so there's no advantage in dropping out either.

  checkLonely(room);

  if (room.phase === 'await_call' && room.currentCallerId === player.id) {
    // Don't let the game hang on someone who left mid-turn.
    clearPhaseTimer(room);
    beginAwaitCall(room);
    return;
  }

  broadcastState(room);
}

/** Re-send everything a returning player needs: state, their puzzle, their turn. */
export function resendPrivate(room: Room, player: PlayerInternal) {
  // Somebody came back, so the room is no longer winding down.
  checkLonely(room);

  // They missed every delta while they were away, so hand them the board afresh.
  if (room.phase !== 'lobby') {
    toPlayer(player, S2C.boardInit, { tokens: room.tokens });
  }

  const puzzle = room.puzzles.get(player.id);
  if (puzzle) toPlayer(player, S2C.puzzleStart, puzzleView(puzzle));

  // The results screen is driven by this payload, so a refresh after the final whistle
  // needs it again — otherwise they'd be looking at an empty leaderboard.
  if (room.phase === 'ended' && room.endReason) {
    const payload: GameOverPayload = {
      reason: room.endReason,
      leaderboard: leaderboard(room),
    };
    toPlayer(player, S2C.gameOver, payload);
  }

  // The room stalled because everyone was gone — pick things back up.
  if (room.phase === 'await_call' && room.currentCallerId === null) {
    beginAwaitCall(room);
  }
}

export function currentTargetToken(room: Room): NumberToken | null {
  return room.target;
}
