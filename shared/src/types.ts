/** Shared wire + domain types. Everything here is serialisable over socket.io. */

/**
 * `wrapup` is a short grace window after the match ends: the board is gone, but anyone
 * still mid-puzzle gets to finish it and bank the points before the leaderboard locks.
 */
export type Phase = 'lobby' | 'await_call' | 'hunting' | 'wrapup' | 'ended';

/** One number painted on the board. */
export interface NumberToken {
  id: string;
  value: number;
  /** Position of the label centre, in virtual board units (see BOARD_W / BOARD_H). */
  x: number;
  y: number;
  fontSize: number;
  /** Degrees, negative = counter-clockwise. */
  rotation: number;
  color: string;
}

export interface Player {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  isHost: boolean;
  /** Walked out on purpose. Their score still counts; they can't come back. */
  left: boolean;
  /** A practice-match opponent driven by the server, not a person. */
  isBot: boolean;
}

export type PuzzleCharset = 'letters' | 'alnum';

export interface RoomConfig {
  /** How many numbers get scattered on the board. */
  numberCount: number;
  /** Match length in minutes. */
  matchMinutes: number;
  /** How long players get to find the called number. */
  findSeconds: number;
  /** Number of tiles in the drag puzzle. */
  puzzleLength: number;
  puzzleCharset: PuzzleCharset;
}

/**
 * Tuned so a default room seats a real group. A 60-second find window leaves only ~12
 * rounds in a 15-minute match, which is three players at three calls each — the first
 * room anyone made would have turned their friends away. Thirty seconds doubles the
 * rounds, and the board is thinned to match: 150 numbers are not findable in 30s.
 */
export const DEFAULT_CONFIG: RoomConfig = {
  numberCount: 50,
  matchMinutes: 15,
  findSeconds: 30,
  puzzleLength: 6,
  puzzleCharset: 'alnum',
};

/**
 * Practice is deliberately gentler than a real match: a thinner board so the number is
 * findable, short letter-only puzzles so the first solve comes quickly, a long find
 * window, and a short match so the leaderboard arrives while it still feels relevant.
 */
export const PRACTICE_CONFIG: RoomConfig = {
  numberCount: 35,
  matchMinutes: 6,
  findSeconds: 75,
  puzzleLength: 4,
  puzzleCharset: 'letters',
};

export interface Tile {
  id: string;
  ch: string;
}

/** What a player sees of their own puzzle. `target` is the string they must build. */
export interface PuzzleView {
  id: string;
  target: string;
  /** Tiles in their current scrambled order. */
  tiles: Tile[];
  /** Server timestamp (ms) the puzzle opened — used for the speed bonus. */
  startedAt: number;
  /** Soft clock: solving after this still counts as a solve but earns no bonus. */
  softSeconds: number;
}

/** Somebody knocking at the door: they have asked to join but are not seated yet. */
export interface PendingPlayer {
  /** Identifies the request, not a player — they have no seat and no score yet. */
  requestId: string;
  name: string;
  /** Epoch ms the request arrived, so the host can see who has been waiting longest. */
  since: number;
}

/** Public room snapshot, broadcast to everyone in the room. */
export interface RoomState {
  code: string;
  phase: Phase;
  config: RoomConfig;
  players: Player[];
  /** Player ids in round-robin turn order. */
  turnOrder: string[];
  currentCallerId: string | null;
  roundNumber: number;
  /** The announced number, or null while we're waiting for the caller. */
  calledValue: number | null;
  /** Player ids who have already found the called number this round. */
  foundBy: string[];
  /** Player ids with a puzzle currently open (so others can see who's still working). */
  solving: string[];
  /** After a match: who has agreed to play another one in this room. */
  readyForNext: string[];
  /** Where the previous round's number was, revealed after the round resolves. */
  lastReveal: { value: number; x: number; y: number } | null;
  /** Solo match against two bots, with the coach running. Changes pacing and penalties. */
  practice: boolean;
  /** People waiting for the host to let them in. Names only — they hold no seat. */
  pending: PendingPlayer[];
}

export interface TickPayload {
  /** Ms left in the match, or null in lobby/ended. */
  matchLeftMs: number | null;
  /** Ms left in the current phase (call window or find window). */
  phaseLeftMs: number | null;
  /** Practice only: the clocks are held while a coach instruction is open. */
  paused?: boolean;
}

export interface LeaderboardRow {
  playerId: string;
  name: string;
  score: number;
  puzzlesSolved: number;
  numbersFound: number;
  wrongClicks: number;
  rank: number;
  /** Quit partway through — shown on the board so the score reads honestly. */
  left: boolean;
}

export type EndReason = 'board_cleared' | 'time_up' | 'not_enough_players';

export interface GameOverPayload {
  reason: EndReason;
  leaderboard: LeaderboardRow[];
}

export interface RoomClosedPayload {
  /** Name of the host who shut the room down. */
  by: string;
}

/* ---------- client -> server payloads ---------- */

export interface CreateRoomReq {
  name: string;
  playerId?: string;
}
export interface JoinRoomReq {
  code: string;
  name: string;
  playerId?: string;
}
export interface BoardClickReq {
  x: number;
  y: number;
}
export interface PuzzleSubmitReq {
  puzzleId: string;
  /** Tile ids in the order the player arranged them. */
  order: string[];
}

export interface JoinAck {
  ok: boolean;
  error?: string;
  playerId?: string;
  code?: string;
  /**
   * Accepted into the queue rather than the room: the host has to let them in. `ok` is
   * still true — nothing went wrong, they are just waiting.
   */
  pending?: boolean;
  requestId?: string;
}

export interface KickedPayload {
  /** Name of the host who did it, so the message isn't anonymous. */
  by: string;
}

export interface DeclinedPayload {
  by: string;
}

/* ---------- server -> client payloads ---------- */

/**
 * The board is sent once when a match starts (and again on reconnect), then maintained
 * with `board:remove` deltas. It is by far the biggest thing on the wire, and it only
 * changes once a round — re-sending it on every score change was most of the traffic.
 */
export interface BoardInitPayload {
  tokens: NumberToken[];
}

export interface BoardRemovePayload {
  tokenId: string;
}

export interface MissedCallPayload {
  callerId: string;
  name: string;
  penalty: number;
  consolation: number;
}

export interface BoardWrongPayload {
  playerId: string;
  penalty: number;
  lockedUntilMs: number;
}

/**
 * What a bot is doing right now. Practice players can't see over a bot's shoulder, so
 * the server narrates it instead — that's the whole point of the activity feed.
 */
export type BotActivityKind =
  | 'thinking'
  | 'called'
  | 'scanning'
  | 'found'
  | 'wrong'
  | 'solved'
  | 'gaveup';

export interface BotActivityPayload {
  botId: string;
  name: string;
  kind: BotActivityKind;
  /** Ready to render — the server already knows the names and the numbers. */
  text: string;
}

export interface PuzzleResultPayload {
  puzzleId: string;
  correct: boolean;
  delta: number;
  total: number;
}
