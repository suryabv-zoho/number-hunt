import type { Server, Socket } from 'socket.io';
import {
  C2S,
  S2C,
  DEFAULT_CONFIG,
  LOBBY_SEAT_GRACE_MS,
  PRACTICE_CONFIG,
  roomCapacity,
} from '@game/shared';
import type {
  BoardClickReq,
  CreateRoomReq,
  JoinAck,
  JoinRoomReq,
  PuzzleSubmitReq,
  RoomConfig,
} from '@game/shared';
import { addBots, forgetBots } from './bots.js';
import {
  createRoom,
  humanPlayers,
  isNameTaken,
  makeId,
  newPlayer,
  publicState,
  rooms,
  type PlayerInternal,
  type Room,
} from './state.js';
import {
  boardClick,
  broadcastState,
  handleDisconnect,
  leaveMatch,
  resendPrivate,
  setPaused,
  startMatch,
  stopTimers,
  submitPuzzle,
} from './game.js';

interface SocketData {
  roomCode?: string;
  playerId?: string;
}

const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo;

function cleanName(raw: unknown): string {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 16);
  return s || 'Player';
}

function sanitizeConfig(raw: Partial<RoomConfig> | undefined): RoomConfig {
  const c = raw ?? {};
  return {
    numberCount: clamp(Number(c.numberCount ?? DEFAULT_CONFIG.numberCount), 20, 150),
    matchMinutes: clamp(Number(c.matchMinutes ?? DEFAULT_CONFIG.matchMinutes), 1, 30),
    findSeconds: clamp(Number(c.findSeconds ?? DEFAULT_CONFIG.findSeconds), 15, 120),
    puzzleLength: clamp(Number(c.puzzleLength ?? DEFAULT_CONFIG.puzzleLength), 4, 8),
    puzzleCharset: c.puzzleCharset === 'letters' ? 'letters' : 'alnum',
  };
}

function ctx(socket: Socket): { room: Room; player: PlayerInternal } | null {
  const data = socket.data as SocketData;
  if (!data.roomCode || !data.playerId) return null;
  const room = rooms.get(data.roomCode);
  const player = room?.players.get(data.playerId);
  if (!room || !player) return null;
  return { room, player };
}

function fail(socket: Socket, message: string) {
  socket.emit(S2C.error, { message });
}

/** Attach (or re-attach) a player to a room and this socket. */
/**
 * Everything that can stop somebody getting in, in one place — because it has to be
 * asked twice: once when they knock, and again when the host lets them in. The room can
 * fill up, or the match can start, while a request is sitting in the queue.
 */
function admissionError(
  room: Room,
  name: string,
  existing: PlayerInternal | undefined,
  wantedId?: string,
): string | null {
  // Walking out is final. Losing your wifi is not.
  if (existing?.left || (wantedId && room.banned.has(wantedId))) {
    return "You left this room — you can't rejoin it";
  }
  // Practice is one person against the computer. The seat holder can still reconnect
  // after a refresh — `existing` covers that — but nobody new sits down. The human
  // count is what makes this safe to apply here: at creation the room has no people in
  // it yet, so the player it was made for isn't turned away from their own room.
  if (room.practice && !existing && humanPlayers(room).length > 0) {
    return 'That code belongs to a practice match';
  }
  // A match is a closed table: reconnects only, no fresh faces mid-game.
  if (room.phase !== 'lobby' && !existing) {
    return 'That match has already started';
  }
  // Two people called "Meera" in one scoreboard helps nobody.
  if (isNameTaken(room, name, existing?.id)) {
    return `"${name}" is already taken in this room`;
  }
  // The room only seats as many as its settings can give a fair number of turns to.
  // Practice sets its own table (one human, two bots) and never takes visitors.
  if (!existing && !room.practice) {
    const seats = roomCapacity(room.config);
    if (room.players.size >= seats) {
      return `That room is full — these settings seat ${seats}`;
    }
  }
  return null;
}

/** Sit somebody down: a new player, or one coming back to a seat they already hold. */
function seat(socket: Socket, room: Room, name: string, existing?: PlayerInternal): JoinAck {
  let player: PlayerInternal;
  if (existing) {
    // Reconnect: keep their score and stats, swap in the new socket.
    //
    // Claim the seat BEFORE hanging up on the old socket. socket.io fires that socket's
    // 'disconnect' handler synchronously, and if the seat still pointed at it, the
    // handler would treat this as a genuine drop — in the lobby it would delete the
    // player out from under us and leave them a ghost in their own room.
    releaseLobbyTimer(room, existing.id);
    const stale = existing.socketId;
    existing.connected = true;
    existing.socketId = socket.id;
    existing.disconnectedAt = null;
    existing.name = name;
    if (stale && stale !== socket.id) {
      io?.sockets.sockets.get(stale)?.disconnect(true);
    }
    player = existing;
  } else {
    player = newPlayer(makeId('pl'), name, socket.id);
    room.players.set(player.id, player);
    // Append-only, so in-flight turn indices stay valid and late joiners simply
    // take their turn when the rotation reaches them.
    room.order.push(player.id);
    if (!room.hostId || !room.players.has(room.hostId)) room.hostId = player.id;
  }

  (socket.data as SocketData).roomCode = room.code;
  (socket.data as SocketData).playerId = player.id;
  socket.join(room.code);

  socket.emit(S2C.state, publicState(room));
  broadcastState(room);
  resendPrivate(room, player);

  return { ok: true, playerId: player.id, code: room.code };
}

/**
 * The host's own seat, and reconnects, skip the queue entirely: creating a room is not
 * a request to join it, and a refresh shouldn't need asking permission twice.
 */
function enter(socket: Socket, room: Room, name: string, wantedId?: string): JoinAck {
  const existing = wantedId ? room.players.get(wantedId) : undefined;
  const err = admissionError(room, name, existing, wantedId);
  if (err) return { ok: false, error: err };
  return seat(socket, room, name, existing);
}

/**
 * Somebody has gone quiet in the lobby. Hold their seat for a moment rather than
 * deleting it: losing a seat to a page refresh used to be survivable — you silently
 * got a new one — but a room that admits people by invitation has no way to give it
 * back, and a host who refreshed could be locked out of their own room.
 */
function holdLobbySeat(room: Room, player: PlayerInternal) {
  player.connected = false;
  player.socketId = null;
  player.disconnectedAt = Date.now();
  broadcastState(room);

  clearTimeout(room.lobbyTimers.get(player.id));
  room.lobbyTimers.set(
    player.id,
    setTimeout(() => {
      room.lobbyTimers.delete(player.id);
      const seat = room.players.get(player.id);
      // They came back, or the match started around them.
      if (!seat || seat.connected || room.phase !== 'lobby') return;
      leaveRoom(room, seat);
    }, LOBBY_SEAT_GRACE_MS),
  );
}

function releaseLobbyTimer(room: Room, playerId: string) {
  clearTimeout(room.lobbyTimers.get(playerId));
  room.lobbyTimers.delete(playerId);
}

/**
 * Turn away everyone still waiting. `by` names the host who did it; an empty name means
 * nobody did — the room went away underneath them.
 */
function clearPending(room: Room, by: string) {
  for (const req of room.pending.values()) {
    io?.to(req.socketId).emit(S2C.declined, { by });
  }
  room.pending.clear();
}

/**
 * A queue with nobody left to answer it is a set of people waiting on a door that will
 * never open. The janitor reclaims the empty room a minute later; they should not spend
 * that minute — or any longer — staring at a spinner.
 */
function clearPendingIfAbandoned(room: Room) {
  if (room.pending.size === 0) return;
  const anyoneToAnswer = [...room.players.values()].some((p) => !p.isBot && !p.left);
  if (!anyoneToAnswer) clearPending(room, '');
}

let io: Server | null = null;

export function registerHandlers(server: Server) {
  io = server;

  server.on('connection', (socket) => {
    socket.on(C2S.createRoom, (req: CreateRoomReq, ack?: (r: JoinAck) => void) => {
      // One room per player at a time — otherwise a stray tab leaves ghost rooms behind.
      if (ctx(socket)) {
        ack?.({ ok: false, error: "You're already in a room. Leave it first." });
        return;
      }
      const name = cleanName(req?.name);
      const room = createRoom('');
      ack?.(enter(socket, room, name, undefined));
    });

    /**
     * Practice: a private room with two bots, started immediately. There is no lobby to
     * wait in and no code to share, so the player lands straight on the board with the
     * coach running.
     */
    socket.on(C2S.createPractice, (req: CreateRoomReq, ack?: (r: JoinAck) => void) => {
      if (ctx(socket)) {
        ack?.({ ok: false, error: "You're already in a room. Leave it first." });
        return;
      }
      const room = createRoom('', true);
      room.config = { ...PRACTICE_CONFIG };
      const joined = enter(socket, room, cleanName(req?.name), undefined);
      if (!joined.ok) {
        rooms.delete(room.code);
        ack?.(joined);
        return;
      }

      // Seated after the human, so the round-robin reaches the player first — their
      // opening turn is a call, which is the clearest thing to teach first.
      addBots(room, 2);
      const err = startMatch(room);
      if (err) {
        // Nothing has been broadcast yet beyond the lobby state, so just report it.
        forgetBots(room);
        rooms.delete(room.code);
        ack?.({ ok: false, error: err });
        return;
      }
      ack?.(joined);
    });

    socket.on(C2S.joinRoom, (req: JoinRoomReq, ack?: (r: JoinAck) => void) => {
      const code = String(req?.code ?? '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        ack?.({ ok: false, error: `No room "${code}"` });
        return;
      }
      const name = cleanName(req?.name);
      const existing = req?.playerId ? room.players.get(req.playerId) : undefined;

      const err = admissionError(room, name, existing, req?.playerId);
      if (err) {
        ack?.({ ok: false, error: err });
        return;
      }

      // Somebody coming back to a seat they already hold is not a new guest.
      if (existing) {
        ack?.(seat(socket, room, name, existing));
        return;
      }

      // Everyone else waits at the door until the host says yes.
      const previous = [...room.pending.values()].find((p) => p.socketId === socket.id);
      if (previous) {
        ack?.({ ok: true, pending: true, requestId: previous.requestId, code: room.code });
        return;
      }
      const requestId = makeId('req');
      room.pending.set(requestId, {
        requestId,
        socketId: socket.id,
        name,
        since: Date.now(),
      });
      broadcastState(room);
      ack?.({ ok: true, pending: true, requestId, code: room.code });
    });

    socket.on(C2S.config, (raw: Partial<RoomConfig>) => {
      const c = ctx(socket);
      if (!c) return;
      if (c.room.practice) return fail(socket, 'Practice settings are fixed');
      if (c.room.hostId !== c.player.id) return fail(socket, 'Only the host can change settings');
      if (c.room.phase !== 'lobby' && c.room.phase !== 'ended') {
        return fail(socket, 'Settings are locked while a match is running');
      }
      const next = sanitizeConfig({ ...c.room.config, ...raw });
      // Settings decide the room size, so they can't be tightened below the people
      // already sitting in it — that would leave the room over its own limit.
      const seats = roomCapacity(next);
      const here = c.room.players.size;
      if (here > seats) {
        return fail(
          socket,
          `${here} players are here, and those settings only seat ${seats}`,
        );
      }
      c.room.config = next;
      broadcastState(c.room);
    });

    socket.on(C2S.start, () => {
      const c = ctx(socket);
      if (!c) return;
      if (c.room.practice) return; // started on creation, and there is no lobby
      if (c.room.hostId !== c.player.id) return fail(socket, 'Only the host can start');
      const err = startMatch(c.room);
      if (err) return fail(socket, err);
      // No fresh faces once a match is running, so the queue can't just sit there.
      clearPending(c.room, c.player.name);
      broadcastState(c.room);
    });

    socket.on(C2S.acceptRematch, () => {
      const c = ctx(socket);
      if (!c) return;
      if (c.room.phase !== 'ended') return;
      c.room.readyForNext.add(c.player.id);
      broadcastState(c.room);
    });

    socket.on(C2S.playAgain, () => {
      const c = ctx(socket);
      if (!c) return;
      if (c.room.hostId !== c.player.id) return fail(socket, 'Only the host can restart');
      if (c.room.phase !== 'ended') return;

      if (c.room.practice) {
        // Only one human in the room, so there is nobody to get consent from.
        const err = startMatch(c.room);
        if (err) fail(socket, err);
        return;
      }

      // The host doesn't get to drag people into another match on their own.
      const others = [...c.room.readyForNext].filter((id) => id !== c.player.id);
      if (others.length === 0) {
        return fail(socket, 'Waiting for at least one player to accept');
      }

      // Anyone who walked out is gone for good — clear the seat, keep the id barred.
      for (const [id, p] of c.room.players) {
        if (p.left) {
          c.room.banned.add(id);
          c.room.players.delete(id);
          c.room.order = c.room.order.filter((o) => o !== id);
        }
      }
      c.room.phase = 'lobby';
      c.room.tokens = [];
      c.room.lastReveal = null;
      c.room.endReason = null;
      c.room.readyForNext.clear();
      broadcastState(c.room);
    });

    socket.on(C2S.closeRoom, () => {
      const c = ctx(socket);
      if (!c) return;
      if (c.room.hostId !== c.player.id) return fail(socket, 'Only the host can close the room');
      const { room } = c;
      stopTimers(room);
      forgetBots(room);
      clearPending(room, c.player.name);
      for (const t of room.lobbyTimers.values()) clearTimeout(t);
      room.lobbyTimers.clear();
      io?.to(room.code).emit(S2C.roomClosed, { by: c.player.name });
      for (const sid of [...room.players.values()].map((p) => p.socketId)) {
        if (!sid) continue;
        const s2 = io?.sockets.sockets.get(sid);
        s2?.leave(room.code);
        if (s2) {
          (s2.data as SocketData).roomCode = undefined;
          (s2.data as SocketData).playerId = undefined;
        }
      }
      rooms.delete(room.code);
    });

    socket.on(C2S.admit, (req: { requestId?: string }) => {
      const c = ctx(socket);
      if (!c) return;
      if (c.room.hostId !== c.player.id) return fail(socket, 'Only the host can admit players');
      const request = c.room.pending.get(String(req?.requestId ?? ''));
      if (!request) return;
      c.room.pending.delete(request.requestId);

      const guest = io?.sockets.sockets.get(request.socketId);
      if (!guest) {
        // They gave up waiting and closed the tab.
        broadcastState(c.room);
        return;
      }
      // Asked again, because the room may have filled or the match started while they
      // were in the queue.
      const err = admissionError(c.room, request.name, undefined);
      if (err) {
        guest.emit(S2C.declined, { by: c.player.name });
        guest.emit(S2C.error, { message: err });
        broadcastState(c.room);
        return;
      }
      const ack = seat(guest, c.room, request.name);
      guest.emit(S2C.admitted, ack);
    });

    socket.on(C2S.decline, (req: { requestId?: string }) => {
      const c = ctx(socket);
      if (!c) return;
      if (c.room.hostId !== c.player.id) return fail(socket, 'Only the host can admit players');
      const request = c.room.pending.get(String(req?.requestId ?? ''));
      if (!request) return;
      c.room.pending.delete(request.requestId);
      io?.to(request.socketId).emit(S2C.declined, { by: c.player.name });
      broadcastState(c.room);
    });

    socket.on(C2S.kick, (req: { playerId?: string }) => {
      const c = ctx(socket);
      if (!c) return;
      if (c.room.hostId !== c.player.id) return fail(socket, 'Only the host can remove players');
      const target = c.room.players.get(String(req?.playerId ?? ''));
      if (!target || target.id === c.player.id || target.isBot) return;

      // Barred by id, so they cannot simply rejoin with the same code.
      c.room.banned.add(target.id);
      const sock = target.socketId ? io?.sockets.sockets.get(target.socketId) : null;
      if (sock) {
        sock.emit(S2C.kicked, { by: c.player.name });
        sock.leave(c.room.code);
        (sock.data as SocketData).roomCode = undefined;
        (sock.data as SocketData).playerId = undefined;
      }

      if (c.room.phase === 'lobby') {
        // Nothing to preserve yet, so the seat just disappears.
        leaveRoom(c.room, target);
      } else {
        // Mid-match they keep their score on the final board, like any walk-out.
        leaveMatch(c.room, target);
        passHostIfNeeded(c.room);
        broadcastState(c.room);
      }
    });

    socket.on(C2S.coachPause, (req: { paused?: boolean }) => {
      const c = ctx(socket);
      if (!c) return;
      // `setPaused` ignores anything that isn't a practice room, so a client asking to
      // stop the clock in a real match gets nothing.
      setPaused(c.room, req?.paused === true);
    });

    socket.on(C2S.boardClick, (req: BoardClickReq) => {
      const c = ctx(socket);
      if (!c) return;
      const x = Number(req?.x);
      const y = Number(req?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      boardClick(c.room, c.player, x, y);
    });

    socket.on(C2S.puzzleSubmit, (req: PuzzleSubmitReq) => {
      const c = ctx(socket);
      if (!c) return;
      if (!req?.puzzleId || !Array.isArray(req.order)) return;
      submitPuzzle(c.room, c.player, String(req.puzzleId), req.order.map(String));
    });

    socket.on(C2S.leave, () => {
      const c = ctx(socket);
      if (!c) return;
      // Drop out of the channel FIRST, so the broadcast that follows doesn't land back
      // on the leaver and put them straight into a match they just quit.
      socket.leave(c.room.code);
      (socket.data as SocketData).roomCode = undefined;
      (socket.data as SocketData).playerId = undefined;

      if (c.room.phase === 'lobby') {
        // Nothing to preserve yet, so the seat just disappears.
        leaveRoom(c.room, c.player);
      } else {
        // Exiting after the final whistle counts too: that id is done with this room.
        c.room.banned.add(c.player.id);
        leaveMatch(c.room, c.player);
        passHostIfNeeded(c.room);
        broadcastState(c.room);
      }
    });

    socket.on('disconnect', () => {
      // They may have been queued rather than seated, in which case there is no ctx.
      for (const room of rooms.values()) {
        for (const [id, req] of room.pending) {
          if (req.socketId !== socket.id) continue;
          room.pending.delete(id);
          broadcastState(room);
        }
      }

      const c = ctx(socket);
      if (!c) return;
      // Ignore a stale socket that was already replaced by a reconnect.
      if (c.player.socketId && c.player.socketId !== socket.id) return;

      if (c.room.phase === 'lobby') {
        holdLobbySeat(c.room, c.player);
        return;
      }
      handleDisconnect(c.room, c.player);
      passHostIfNeeded(c.room);
      broadcastState(c.room);
    });
  });
}

/** Exposed for tests that need to fire the lobby grace clock without waiting for it. */
export { leaveRoom as leaveRoomForTest };

function leaveRoom(room: Room, player: PlayerInternal) {
  releaseLobbyTimer(room, player.id);
  room.players.delete(player.id);
  room.order = room.order.filter((id) => id !== player.id);
  room.puzzles.delete(player.id);
  clearPendingIfAbandoned(room);

  // A practice room is that one person's room. Once they're gone it is just two bots
  // playing to an empty chair, so it goes now rather than waiting on the janitor.
  if (room.practice) {
    stopTimers(room);
    forgetBots(room);
    rooms.delete(room.code);
    return;
  }

  passHostIfNeeded(room);
  broadcastState(room);
}

function passHostIfNeeded(room: Room) {
  const host = room.players.get(room.hostId);
  if (host?.connected && !host.left) return;
  const next = room.order
    .map((id) => room.players.get(id))
    .find((p) => p?.connected && !p.left && !p.isBot);
  if (next) room.hostId = next.id;
}

/** Drop rooms nobody has been connected to for a while. */
export function startJanitor() {
  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      // Bots are connected for as long as they exist, so asking them whether anyone is
      // still here would keep every abandoned practice room alive forever.
      const anyone = [...room.players.values()].some(
        (p) =>
          !p.isBot &&
          (p.connected || (p.disconnectedAt && now - p.disconnectedAt < 15 * 60_000)),
      );
      if (!anyone || room.players.size === 0) {
        if (now - room.createdAt > 60_000) {
          stopTimers(room);
          forgetBots(room);
          // Anyone still knocking is knocking on a room about to stop existing.
          clearPending(room, '');
          for (const t of room.lobbyTimers.values()) clearTimeout(t);
          room.lobbyTimers.clear();
          rooms.delete(code);
          console.log(`[room ${code}] reclaimed`);
        }
      }
    }
  }, 60_000).unref();
}
