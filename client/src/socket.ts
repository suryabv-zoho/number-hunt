import { io, type Socket } from 'socket.io-client';
import { C2S, S2C } from '@game/shared';
import type {
  BoardInitPayload,
  BoardRemovePayload,
  BoardWrongPayload,
  GameOverPayload,
  JoinAck,
  MissedCallPayload,
  PuzzleResultPayload,
  PuzzleView,
  RoomClosedPayload,
  RoomState,
  TickPayload,
} from '@game/shared';
import { useStore } from './store.js';
import { chime, speak, watchSpeechBlocked } from './speech.js';

watchSpeechBlocked((v) => store().setSpeechBlocked(v));

export const socket: Socket = io({ autoConnect: true });

const store = () => useStore.getState();

socket.on('connect', () => {
  store().setConnected(true);
  // Rejoin on every connect, which covers both a page refresh and a dropped
  // connection coming back — the server keeps our score against the same playerId.
  const code = sessionStorage.getItem('nh.room');
  const playerId = sessionStorage.getItem('nh.playerId');
  const name = sessionStorage.getItem('nh.name');
  if (code && playerId && name) {
    joinRoom(code, name, playerId).then((ack) => {
      if (ack.ok && ack.playerId) {
        // The server may hand back a different id (e.g. it restarted and our old
        // seat is gone). Adopt whatever it gives us, or we'd be a ghost in our own room.
        store().setIdentity(ack.playerId, name);
      } else {
        sessionStorage.removeItem('nh.room');
        sessionStorage.removeItem('nh.playerId');
        store().setRoom(null);
        if (ack.error) store().pushToast(ack.error, 'bad');
      }
    });
  }
});
socket.on('disconnect', () => store().setConnected(false));

socket.on(S2C.state, (state: RoomState) => {
  const prev = store().room;
  store().setRoom(state);
  // Leaving a finished match back to the lobby: clear the old result.
  if (prev && prev.phase === 'ended' && state.phase === 'lobby') {
    store().setGameOver(null);
  }
});

socket.on(S2C.turnCalled, (p: { value: number; callerId: string }) => {
  const s = store();
  const caller = s.room?.players.find((pl) => pl.id === p.callerId);
  if (p.callerId !== s.playerId) {
    s.pushToast(`${caller?.name ?? 'Someone'} called ${p.value}`, 'info');
    if (s.speak) {
      // The tone lands immediately and almost always works; the spoken number is the
      // part browsers like to block, so it comes second.
      chime();
      speak(String(p.value));
    }
  }
});

socket.on(S2C.turnMissed, (p: MissedCallPayload) => {
  const s = store();
  if (p.callerId === s.playerId) {
    s.pushToast(`You never called — ${p.penalty}`, 'bad');
  } else {
    s.pushToast(`${p.name} missed their turn · +${p.consolation} to you`, 'good');
  }
});

socket.on(S2C.boardInit, (p: BoardInitPayload) => store().setTokens(p.tokens));
socket.on(S2C.boardRemove, (p: BoardRemovePayload) => store().removeToken(p.tokenId));

socket.on(S2C.boardFound, (p: { playerId: string; name: string }) => {
  const s = store();
  if (p.playerId === s.playerId) s.pushToast('Found it! Solve the puzzle', 'good');
  else s.pushToast(`${p.name} found it`, 'info');
});

socket.on(S2C.boardWrong, (p: BoardWrongPayload) => {
  const s = store();
  if (p.playerId !== s.playerId) return;
  s.pushToast(`Wrong number  ${p.penalty}`, 'bad');
  s.lockBoard(p.lockedUntilMs);
});

socket.on(S2C.puzzleStart, (p: PuzzleView) => store().setPuzzle(p));

socket.on(S2C.puzzleEnd, (p: { reason?: string }) => {
  const s = store();
  // 'your_turn' and 'match_over' are expected endings, not a window slamming shut.
  const quiet = p?.reason === 'your_turn' || p?.reason === 'match_over';
  if (s.puzzle && !quiet) s.pushToast('Puzzle window closed', 'bad');
  s.setPuzzle(null);
  s.resetStreak();
});

socket.on(S2C.puzzleResult, (p: PuzzleResultPayload) => {
  const s = store();
  if (p.correct) {
    // The server sends the next puzzle right behind this, so don't clear the panel —
    // that would flash an empty screen between puzzles.
    s.bumpStreak();
    s.pushToast(`Solved  +${p.delta}`, 'good');
  }
});

socket.on(S2C.tick, (p: TickPayload) => store().setTick(p.matchLeftMs, p.phaseLeftMs));

socket.on(S2C.gameOver, (p: GameOverPayload) => {
  store().setGameOver(p);
  store().setPuzzle(null);
});

socket.on(S2C.roomClosed, (p: RoomClosedPayload) => {
  const s = store();
  // The room is gone for everyone; drop our seat and say why.
  sessionStorage.removeItem('nh.room');
  sessionStorage.removeItem('nh.playerId');
  s.setPuzzle(null);
  s.setGameOver(null);
  s.setRoom(null);
  s.setNotice(`${p.by} closed the room.`);
});

socket.on(S2C.error, (p: { message: string }) => {
  store().setError(p.message);
  store().pushToast(p.message, 'bad');
  setTimeout(() => store().setError(null), 4000);
});


/* ------------------------------------------------------------- client actions */

export function createRoom(name: string): Promise<JoinAck> {
  store().setHasLeft(false);
  return new Promise((resolve) =>
    socket.emit(C2S.createRoom, { name }, (ack: JoinAck) => {
      if (ack.ok) store().setHasLeft(false);
      resolve(ack);
    }),
  );
}

export function joinRoom(code: string, name: string, playerId?: string): Promise<JoinAck> {
  store().setHasLeft(false);
  return new Promise((resolve) =>
    socket.emit(C2S.joinRoom, { code, name, playerId }, (ack: JoinAck) => {
      if (ack.ok) store().setHasLeft(false);
      resolve(ack);
    }),
  );
}

export const sendConfig = (config: Partial<RoomState['config']>) =>
  socket.emit(C2S.config, config);
export const startMatch = () => socket.emit(C2S.start);
export const playAgain = () => socket.emit(C2S.playAgain);
export const acceptRematch = () => socket.emit(C2S.acceptRematch);
export const closeRoom = () => socket.emit(C2S.closeRoom);
/** Doubles as "call this number" for the caller and "I found it" for everyone else. */
export const clickBoard = (x: number, y: number) => socket.emit(C2S.boardClick, { x, y });
export const submitPuzzle = (puzzleId: string, order: string[]) =>
  socket.emit(C2S.puzzleSubmit, { puzzleId, order });
export function leaveRoom() {
  socket.emit(C2S.leave);
  store().setHasLeft(true);
  // Drop the identity too, so the auto-rejoin on the next connect doesn't try to walk
  // back into a match we deliberately walked out of.
  sessionStorage.removeItem('nh.room');
  sessionStorage.removeItem('nh.playerId');
  const s = store();
  s.setRoom(null);
  s.setPuzzle(null);
  s.setGameOver(null);
}
