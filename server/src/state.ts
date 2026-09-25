import type {
  EndReason,
  NumberToken,
  Phase,
  Player,
  RoomConfig,
  RoomState,
  Tile,
} from '@game/shared';
import { DEFAULT_CONFIG } from '@game/shared';

export interface PlayerStats {
  puzzlesSolved: number;
  numbersFound: number;
  wrongClicks: number;
}

export interface PlayerInternal {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  /** Walked out on purpose — keeps their seat and score, but never plays again. */
  left: boolean;
  /** Driven by `bots.ts` rather than a socket. Always "connected", never a host. */
  isBot: boolean;
  socketId: string | null;
  /** Epoch ms until which board clicks are ignored (wrong-click lockout). */
  lockedUntil: number;
  disconnectedAt: number | null;
  stats: PlayerStats;
}

/**
 * A bot action waiting to happen. It keeps its own due time so a paused practice match
 * can stop the clock on it and put it back exactly where it was.
 */
export interface PendingBotAction {
  timeout: NodeJS.Timeout | null;
  /** Epoch ms it should run at. Shifted forward by however long the match was paused. */
  dueAt: number;
  run: () => void;
}

export interface PuzzleInternal {
  id: string;
  playerId: string;
  target: string;
  tiles: Tile[];
  startedAt: number;
  roundNumber: number;
}

export interface Room {
  code: string;
  hostId: string;
  /** Solo match against bots: gentler pacing, no penalties, nobody else can join. */
  practice: boolean;
  config: RoomConfig;
  players: Map<string, PlayerInternal>;
  /** Join order, which is also the round-robin turn order. */
  order: string[];
  phase: Phase;
  /** Numbers still on the board. */
  tokens: NumberToken[];
  roundNumber: number;
  /** Index into `order` of the player whose turn it is. */
  callerIdx: number;
  currentCallerId: string | null;
  /** The token the caller must announce. Never leaves the server until it's called. */
  target: NumberToken | null;
  calledValue: number | null;
  foundBy: Set<string>;
  /** playerId -> their open puzzle. */
  puzzles: Map<string, PuzzleInternal>;
  matchEndsAt: number | null;
  phaseEndsAt: number | null;
  lastReveal: { value: number; x: number; y: number } | null;
  endReason: EndReason | null;
  /** Between matches: who has agreed to another one. The host needs at least one. */
  readyForNext: Set<string>;
  /** Ids that walked out. Kept after their seat is cleared so they can't sneak back. */
  banned: Set<string>;
  /**
   * People who have asked to join and are waiting on the host. They are deliberately
   * not in `players`: no seat, no turn, and they don't count against the room's size
   * until they are actually let in.
   */
  pending: Map<string, { requestId: string; socketId: string; name: string; since: number }>;
  seed: number;
  puzzleSeq: number;
  timers: {
    phase: NodeJS.Timeout | null;
    tick: NodeJS.Timeout | null;
    /** Grace clock for a room that has dropped below two connected players. */
    lonely: NodeJS.Timeout | null;
  };
  /** Every pending bot action, so a room teardown can't leave timers running. */
  botTimers: Set<PendingBotAction>;
  /**
   * Grace clocks for lobby seats whose player has gone quiet. A refresh takes a second;
   * a closed tab shouldn't hold a seat all evening, especially now the room has a size.
   */
  lobbyTimers: Map<string, NodeJS.Timeout>;
  /**
   * What the phase timer will do when it fires. Held so a pause can cancel the timer
   * and re-arm the same outcome later, rather than having to re-derive it from `phase`.
   */
  phaseFn: (() => void) | null;
  /** Practice only: epoch ms the clocks were held at, or null when running. */
  pausedAt: number | null;
  createdAt: number;
}

export const rooms = new Map<string, Room>();

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

export function makeRoomCode(): string {
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

export function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function createRoom(hostId: string, practice = false): Room {
  const room: Room = {
    code: makeRoomCode(),
    hostId,
    practice,
    config: { ...DEFAULT_CONFIG },
    players: new Map(),
    order: [],
    phase: 'lobby',
    tokens: [],
    roundNumber: 0,
    callerIdx: -1,
    currentCallerId: null,
    target: null,
    calledValue: null,
    foundBy: new Set(),
    puzzles: new Map(),
    matchEndsAt: null,
    phaseEndsAt: null,
    lastReveal: null,
    endReason: null,
    readyForNext: new Set(),
    banned: new Set(),
    pending: new Map(),
    seed: 0,
    puzzleSeq: 0,
    timers: { phase: null, tick: null, lonely: null },
    botTimers: new Set(),
    lobbyTimers: new Map(),
    phaseFn: null,
    pausedAt: null,
    createdAt: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

export function newPlayer(id: string, name: string, socketId: string): PlayerInternal {
  return {
    id,
    name,
    score: 0,
    connected: true,
    left: false,
    isBot: false,
    socketId,
    lockedUntil: 0,
    disconnectedAt: null,
    stats: { puzzlesSolved: 0, numbersFound: 0, wrongClicks: 0 },
  };
}

/**
 * A bot seat. No socket, permanently "connected" — it can't drop out, so the match
 * never stalls waiting for one, and `connectedPlayers` counts it as a body at the table.
 */
export function newBot(id: string, name: string): PlayerInternal {
  return {
    id,
    name,
    score: 0,
    connected: true,
    left: false,
    isBot: true,
    socketId: null,
    lockedUntil: 0,
    disconnectedAt: null,
    stats: { puzzlesSolved: 0, numbersFound: 0, wrongClicks: 0 },
  };
}

export function toPublicPlayer(room: Room, p: PlayerInternal): Player {
  return {
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected,
    isHost: room.hostId === p.id,
    left: p.left,
    isBot: p.isBot,
  };
}

/**
 * The snapshot every client in the room receives, sent on every change — so it is kept
 * small. Note what is NOT here: the board (sent once, then maintained with deltas), the
 * caller's chosen number before it's called, and anyone's puzzle.
 */
export function publicState(room: Room): RoomState {
  return {
    code: room.code,
    phase: room.phase,
    config: room.config,
    players: room.order
      .map((id) => room.players.get(id))
      .filter((p): p is PlayerInternal => !!p)
      .map((p) => toPublicPlayer(room, p)),
    turnOrder: [...room.order],
    currentCallerId: room.currentCallerId,
    roundNumber: room.roundNumber,
    calledValue: room.calledValue,
    foundBy: [...room.foundBy],
    solving: [...room.puzzles.keys()],
    readyForNext: [...room.readyForNext],
    lastReveal: room.lastReveal,
    practice: room.practice,
    pending: [...room.pending.values()].map((p) => ({
      requestId: p.requestId,
      name: p.name,
      since: p.since,
    })),
  };
}

/**
 * Is this name already in use in the room? Compared case-insensitively and ignoring
 * surrounding space, so "Meera" and " meera " count as the same person trying to sit
 * down twice. `exceptId` is the player doing the asking, so a reconnect keeps its name.
 */
export function isNameTaken(room: Room, name: string, exceptId?: string): boolean {
  const wanted = name.trim().toLowerCase();
  for (const p of room.players.values()) {
    if (p.id === exceptId) continue;
    if (p.name.trim().toLowerCase() === wanted) return true;
  }
  return false;
}

/** Connected right now, and still part of the match. */
export function connectedPlayers(room: Room): PlayerInternal[] {
  return room.order
    .map((id) => room.players.get(id))
    .filter((p): p is PlayerInternal => !!p && p.connected && !p.left);
}

/**
 * Still in the match — includes someone who is momentarily offline with a flaky
 * connection, excludes anyone who deliberately walked out.
 */
export function activePlayers(room: Room): PlayerInternal[] {
  return room.order
    .map((id) => room.players.get(id))
    .filter((p): p is PlayerInternal => !!p && !p.left);
}

/**
 * The people, as opposed to the bots. A practice room is alive only while its one human
 * is — bots are always "connected", so every liveness check has to ask this instead.
 */
export function humanPlayers(room: Room): PlayerInternal[] {
  return [...room.players.values()].filter((p) => !p.isBot);
}

export function connectedHumans(room: Room): PlayerInternal[] {
  return humanPlayers(room).filter((p) => p.connected && !p.left);
}
