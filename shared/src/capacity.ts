import type { RoomConfig } from './types.js';

/**
 * How many people a room may seat, derived from its match settings.
 *
 * The limit is turns, not technology. A round costs the caller's thinking time plus the
 * whole find window — the find window always runs its full length — so a match holds a
 * fixed number of rounds, and every extra player divides them further. At 15 minutes
 * with a 60-second find window there are only about 12 rounds in the match: seat eight
 * people and half of them call once.
 *
 * Capping the room is kinder than letting everyone in and leaving two thirds of them
 * watching. The host can raise the cap by shortening the find window or lengthening the
 * match, and the lobby shows the number moving as they do.
 */

/** Nobody should leave having called fewer times than this. */
export const MIN_CALLS_PER_PLAYER = 3;

/**
 * What a caller realistically spends choosing a number. Not the full 25s they're
 * allowed — most people tap in a few seconds — but not zero either.
 */
export const CALL_BUDGET_SECONDS = 10;

/**
 * One seat held back from the arithmetic. The call budget is an average: a room of
 * ditherers gets fewer rounds than the formula predicts, and the margin absorbs that
 * rather than quietly cheating the last player out of their third turn.
 */
export const CAPACITY_MARGIN = 1;

/**
 * A ceiling no setting can raise. Every player multiplies the room-state broadcast that
 * follows each find, each wrong tap and each puzzle solved, so the traffic grows with
 * the square of the room. Twelve stays comfortably inside a small host's budget; sixty
 * would push hundreds of megabytes a round.
 */
export const MAX_ROOM_SIZE = 12;

/** The floor: two is the fewest that can play at all. */
export const MIN_ROOM_SIZE = 2;

/** Rounds a match of these settings has room for. */
export function roundsInMatch(config: RoomConfig): number {
  const roundSeconds = CALL_BUDGET_SECONDS + config.findSeconds;
  return Math.floor((config.matchMinutes * 60) / roundSeconds);
}

/** How many players these settings can seat. */
export function roomCapacity(config: RoomConfig): number {
  const fits = Math.floor(roundsInMatch(config) / MIN_CALLS_PER_PLAYER) - CAPACITY_MARGIN;
  return Math.max(MIN_ROOM_SIZE, Math.min(MAX_ROOM_SIZE, fits));
}

/** Roughly how many turns each player gets at a given room size. */
export function callsEach(config: RoomConfig, players: number): number {
  if (players <= 0) return 0;
  return roundsInMatch(config) / players;
}
