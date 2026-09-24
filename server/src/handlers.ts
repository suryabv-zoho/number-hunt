import type { Server, Socket } from 'socket.io';
import { C2S, S2C, DEFAULT_CONFIG } from '@game/shared';
import type {
  BoardClickReq,
  CreateRoomReq,
  JoinAck,
  JoinRoomReq,
  PuzzleSubmitReq,
  RoomConfig,
} from '@game/shared';
import {
  createRoom,
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
function enter(socket: Socket, room: Room, name: string, wantedId?: string): JoinAck {
  const existing = wantedId ? room.players.get(wantedId) : undefined;
  const inProgress = room.phase !== 'lobby';

  // Walking out is final. Losing your wifi is not.
  if (existing?.left || (wantedId && room.banned.has(wantedId))) {
    return { ok: false, error: 'You left this room — you can\'t rejoin it' };
  }
  // A match is a closed table: reconnects only, no fresh faces mid-game.
  if (inProgress && !existing) {
    return { ok: false, error: 'That match has already started' };
  }
  // Two people called "Meera" in one scoreboard helps nobody.
  if (isNameTaken(room, name, existing?.id)) {
    return { ok: false, error: `"${name}" is already taken in this room` };
  }

  let player: PlayerInternal;
  if (existing) {
    // Reconnect: keep their score and stats, swap in the new socket.
    //
    // Claim the seat BEFORE hanging up on the old socket. socket.io fires that socket's
    // 'disconnect' handler synchronously, and if the seat still pointed at it, the
    // handler would treat this as a genuine drop — in the lobby it would delete the
    // player out from under us and leave them a ghost in their own room.
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

    socket.on(C2S.joinRoom, (req: JoinRoomReq, ack?: (r: JoinAck) => void) => {
      const code = String(req?.code ?? '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        ack?.({ ok: false, error: `No room "${code}"` });
        return;
      }
      ack?.(enter(socket, room, cleanName(req?.name), req?.playerId));
    });

    socket.on(C2S.config, (raw: Partial<RoomConfig>) => {
      const c = ctx(socket);
      if (!c) return;
      if (c.room.hostId !== c.player.id) return fail(socket, 'Only the host can change settings');
      if (c.room.phase !== 'lobby' && c.room.phase !== 'ended') {
        return fail(socket, 'Settings are locked while a match is running');
      }
      c.room.config = sanitizeConfig({ ...c.room.config, ...raw });
      broadcastState(c.room);
    });

    socket.on(C2S.start, () => {
      const c = ctx(socket);
      if (!c) return;
      if (c.room.hostId !== c.player.id) return fail(socket, 'Only the host can start');
      const err = startMatch(c.room);
      if (err) fail(socket, err);
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
      const c = ctx(socket);
      if (!c) return;
      // Ignore a stale socket that was already replaced by a reconnect.
      if (c.player.socketId && c.player.socketId !== socket.id) return;

      if (c.room.phase === 'lobby') {
        leaveRoom(c.room, c.player);
        return;
      }
      handleDisconnect(c.room, c.player);
      passHostIfNeeded(c.room);
      broadcastState(c.room);
    });
  });
}

function leaveRoom(room: Room, player: PlayerInternal) {
  room.players.delete(player.id);
  room.order = room.order.filter((id) => id !== player.id);
  room.puzzles.delete(player.id);
  passHostIfNeeded(room);
  broadcastState(room);
}

function passHostIfNeeded(room: Room) {
  const host = room.players.get(room.hostId);
  if (host?.connected && !host.left) return;
  const next = room.order
    .map((id) => room.players.get(id))
    .find((p) => p?.connected && !p.left);
  if (next) room.hostId = next.id;
}

/** Drop rooms nobody has been connected to for a while. */
export function startJanitor() {
  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const anyone = [...room.players.values()].some(
        (p) => p.connected || (p.disconnectedAt && now - p.disconnectedAt < 15 * 60_000),
      );
      if (!anyone || room.players.size === 0) {
        if (now - room.createdAt > 60_000) {
          stopTimers(room);
          rooms.delete(code);
          console.log(`[room ${code}] reclaimed`);
        }
      }
    }
  }, 60_000).unref();
}
