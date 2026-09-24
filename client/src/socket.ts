import { io, type Socket } from 'socket.io-client';
import { C2S, S2C } from '@game/shared';
import type {
  BoardInitPayload,
  BotActivityPayload,
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
import { useCoach } from './coach.js';
import { chime, speak, watchSpeechBlocked } from './speech.js';

watchSpeechBlocked((v) => store().setSpeechBlocked(v));

export const socket: Socket = io({ autoConnect: true });

const store = () => useStore.getState();
/**
 * The coach only ever advances on something the server confirmed. Nothing below guesses
 * at what the player did — it reports what the game said happened.
 */
const coach = () => useCoach.getState();

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
  coach().signal(p.callerId === s.playerId ? 'i_called' : 'hunt_started');
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

socket.on(S2C.boardInit, (p: BoardInitPayload) => {
  // A fresh board means a fresh match, so last match's narration goes with it.
  store().clearBotFeed();
  store().setTokens(p.tokens);
});
socket.on(S2C.boardRemove, (p: BoardRemovePayload) => store().removeToken(p.tokenId));

socket.on(S2C.boardFound, (p: { playerId: string; name: string }) => {
  const s = store();
  if (p.playerId === s.playerId) {
    coach().signal('i_found');
    s.pushToast('Found it! Solve the puzzle', 'good');
  } else {
    s.pushToast(`${p.name} found it`, 'info');
  }
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
    coach().signal('i_solved');
    s.bumpStreak();
    s.pushToast(`Solved  +${p.delta}`, 'good');
  }
});

socket.on(S2C.tick, (p: TickPayload) =>
  store().setTick(p.matchLeftMs, p.phaseLeftMs, p.paused === true),
);

socket.on(S2C.botActivity, (p: BotActivityPayload) => store().pushBotActivity(p));

socket.on(S2C.gameOver, (p: GameOverPayload) => {
  // Whatever the coach was waiting for is not going to happen now.
  coach().signal('match_over');
  store().setGameOver(p);
  store().setPuzzle(null);
});

socket.on(S2C.roomClosed, (p: RoomClosedPayload) => {
  const s = store();
  coach().stop();
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

/**
 * Solo match against two bots. The server starts it immediately, so there's no lobby in
 * between — the player lands on the board with the coach already on step one.
 */
export function startPractice(name: string): Promise<JoinAck> {
  store().setHasLeft(false);
  return new Promise((resolve) =>
    socket.emit(C2S.createPractice, { name }, (ack: JoinAck) => {
      if (ack.ok) {
        store().setHasLeft(false);
        useCoach.getState().start();
      }
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

/**
 * Ask the server to hold the clocks while a coach instruction is on screen. Only a
 * practice room honours it — the server decides, not us.
 */
export const setCoachPaused = (paused: boolean) =>
  socket.emit(C2S.coachPause, { paused });

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
  coach().stop();
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
