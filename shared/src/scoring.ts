/**
 * All scoring lives here.
 *
 * Points come from solving puzzles. Finding the number on the board is just the gate
 * that opens a puzzle. Clicking the wrong number costs you, and so does sitting on your
 * turn without calling a number.
 */

export const PUZZLE_BASE_POINTS = 10;
export const PUZZLE_MAX_BONUS = 6;
/** One bonus point is lost for every full 5s spent on the puzzle. */
export const PUZZLE_BONUS_STEP_MS = 5000;
/** Past this the puzzle still counts as solved, but earns no bonus. */
export const PUZZLE_SOFT_SECONDS = 90;

export const WRONG_CLICK_PENALTY = -2;
/** How long a player is locked out of the board after clicking the wrong number. */
export const WRONG_CLICK_LOCKOUT_MS = 2000;

/** How long the caller has to pick a number off the board before their turn is burned. */
export const PICK_MS = 25_000;

/**
 * The same window in a practice match, for the human only. A first-timer is reading the
 * coach, finding the board and working out what a "call" even is — putting a 25s clock
 * on that teaches panic rather than the game. Bots still act in seconds.
 *
 * Generous, but still a real clock: it has to stay well inside a practice match, or the
 * phase counts down from longer than the match it sits in.
 */
export const PRACTICE_PICK_MS = 2 * 60_000;

/** The caller pays this for letting their turn expire without calling anything. */
export const MISSED_CALL_PENALTY = -5;
/** ...and everyone left waiting gets this for the wasted round. */
export const MISSED_CALL_CONSOLATION = 2;

/**
 * How long the coach may hold the clocks before the server gives up and starts them
 * again. Reading a step takes seconds; anything approaching this means the player walked
 * away with a card open, and a room frozen for ever is a room that never finishes.
 */
export const COACH_MAX_PAUSE_MS = 5 * 60_000;

/** Grace window after the match ends so open puzzles can still be finished. */
export const WRAPUP_MS = 20_000;

/**
 * How long a room stays alive once it is down to fewer than two connected players.
 * Long enough to cover a page refresh or a lift-door moment, short enough that a
 * closed tab doesn't leave the last player waiting around.
 */
export const LONELY_GRACE_MS = 45_000;

/** Points for solving a puzzle, given how long the player took. */
export function scorePuzzle(elapsedMs: number): number {
  const lost = Math.floor(Math.max(0, elapsedMs) / PUZZLE_BONUS_STEP_MS);
  const bonus = Math.max(0, PUZZLE_MAX_BONUS - lost);
  return PUZZLE_BASE_POINTS + bonus;
}

/**
 * Totals are allowed to go negative. Clamping at zero would make every penalty free
 * once a player hit the floor, which is exactly when the penalty needs to bite.
 */
export function applyDelta(score: number, delta: number): number {
  return score + delta;
}
