/**
 * Practice-match opponents.
 *
 * A bot is an ordinary seat in an ordinary room: it takes its turn in the same rotation,
 * clicks the same board through the same hit-test, and banks points through the same
 * scoring path as a person. Nothing here is a parallel implementation of the game — it
 * only decides *when* a bot acts, then calls the same entry points a socket would.
 *
 * Every action is scheduled against the round it was planned in and re-checks the world
 * before it runs, because 8 seconds is a long time in this game: the round may have
 * resolved, the match may have ended, or the human may have walked out.
 *
 * The actions themselves are injected (see `attachBotActions`) rather than imported from
 * `game.ts`, which would be an import cycle — `game.ts` has to call into this file.
 */
import type { BotActivityPayload, NumberToken } from '@game/shared';
import {
  makeId,
  newBot,
  rooms,
  type PendingBotAction,
  type PlayerInternal,
  type PuzzleInternal,
  type Room,
} from './state.js';

export interface BotActions {
  callNumber(room: Room, token: NumberToken): void;
  boardClick(room: Room, player: PlayerInternal, x: number, y: number): void;
  submitPuzzle(room: Room, player: PlayerInternal, puzzleId: string, order: string[]): void;
  narrate(room: Room, payload: BotActivityPayload): void;
}

let actions: BotActions | null = null;
export function attachBotActions(a: BotActions) {
  actions = a;
}

/* ------------------------------------------------------------------ profiles */

interface BotProfile {
  /** Thinking time before calling a number, in ms. */
  call: [number, number];
  /** How long the bot takes to spot the called number. */
  find: [number, number];
  /** How long one puzzle takes it. */
  solve: [number, number];
  /** Chance it taps a wrong number on the way. */
  slip: number;
  /** Chance it never finds the number at all. */
  miss: number;
}

/**
 * Two different opponents so the feed reads like two people rather than one algorithm
 * twice.
 *
 * The solve times look slow next to a competent human, and that is deliberate. A bot's
 * puzzle stream never pauses, while a first-timer's is interrupted by reading the coach,
 * hunting for the board and working out what a tile puzzle even is. Pitched any faster
 * and they finish their first game 10 points to 100, which teaches them only that they
 * are bad at it.
 */
const PROFILES: BotProfile[] = [
  // Careful: rarely slips, but slow on the board and slow on the puzzle.
  { call: [3200, 5200], find: [13_000, 24_000], solve: [21_000, 33_000], slip: 0.15, miss: 0.14 },
  // Hasty: quick to spot things, and quick to tap the wrong one.
  { call: [2600, 4400], find: [8000, 17_000], solve: [17_000, 27_000], slip: 0.38, miss: 0.1 },
];

const BOT_NAMES = ['Aarav', 'Meera', 'Ravi', 'Kavya', 'Nila', 'Dev', 'Anu', 'Kiran'];

/** playerId -> profile. Module-level so a Room stays a plain serialisable-ish object. */
const profiles = new Map<string, BotProfile>();

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pickOne = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

/* -------------------------------------------------------------------- timers */

function later(room: Room, ms: number, fn: () => void) {
  const delay = Math.max(0, ms);
  const action: PendingBotAction = {
    timeout: null,
    dueAt: Date.now() + delay,
    run: () => {
      room.botTimers.delete(action);
      // A bot acting in a room that has been closed would resurrect it in `rooms`.
      if (!rooms.has(room.code)) return;
      try {
        fn();
      } catch (err) {
        console.error(`[room ${room.code}] bot action failed`, err);
      }
    },
  };
  // Scheduled during a pause: it waits, and gets armed when the clocks start again.
  if (room.pausedAt === null) action.timeout = setTimeout(action.run, delay);
  room.botTimers.add(action);
}

export function clearBotTimers(room: Room) {
  for (const a of room.botTimers) if (a.timeout) clearTimeout(a.timeout);
  room.botTimers.clear();
}

/** Hold every pending bot action where it is. Their due times are shifted on resume. */
export function pauseBotTimers(room: Room) {
  for (const a of room.botTimers) {
    if (a.timeout) clearTimeout(a.timeout);
    a.timeout = null;
  }
}

/** Put them back exactly as far from firing as they were when the clocks stopped. */
export function resumeBotTimers(room: Room, shiftMs: number) {
  const now = Date.now();
  for (const a of room.botTimers) {
    a.dueAt += shiftMs;
    a.timeout = setTimeout(a.run, Math.max(0, a.dueAt - now));
  }
}

export function forgetBots(room: Room) {
  clearBotTimers(room);
  for (const p of room.players.values()) if (p.isBot) profiles.delete(p.id);
}

/* --------------------------------------------------------------------- seats */

/**
 * Seat `count` bots, avoiding the human's name — two "Meera"s on one scoreboard is
 * exactly the confusion this mode exists to remove.
 */
export function addBots(room: Room, count: number): PlayerInternal[] {
  if (!actions) {
    // Without the registry every bot action is a silent no-op, and the symptom is a
    // practice match where nobody but the player ever does anything — which is a long
    // way from the cause. Say so at the point the room commits to having bots.
    console.error(
      '[bots] attachBotActions() was never called: bots will sit and do nothing.',
    );
  }

  const taken = new Set(
    [...room.players.values()].map((p) => p.name.trim().toLowerCase()),
  );
  const available = BOT_NAMES.filter((n) => !taken.has(n.toLowerCase()));
  const made: PlayerInternal[] = [];

  for (let i = 0; i < count; i++) {
    const name = available.splice(Math.floor(Math.random() * available.length), 1)[0]
      ?? `Bot ${i + 1}`;
    const bot = newBot(makeId('bot'), name);
    room.players.set(bot.id, bot);
    room.order.push(bot.id);
    profiles.set(bot.id, PROFILES[i % PROFILES.length]);
    made.push(bot);
  }
  return made;
}

function profileOf(bot: PlayerInternal): BotProfile {
  return profiles.get(bot.id) ?? PROFILES[0];
}

function narrate(room: Room, bot: PlayerInternal, kind: BotActivityPayload['kind'], text: string) {
  actions?.narrate(room, { botId: bot.id, name: bot.name, kind, text });
}

/** Has the world moved on since this action was planned? */
function stale(room: Room, bot: PlayerInternal, round: number, phase: Room['phase']): boolean {
  return (
    !rooms.has(room.code) ||
    room.roundNumber !== round ||
    room.phase !== phase ||
    bot.left ||
    !room.players.has(bot.id)
  );
}

/* --------------------------------------------------------------------- hooks */

/** A new turn has started. If it belongs to a bot, it goes and picks a number. */
export function onAwaitCall(room: Room) {
  if (!room.practice || !room.currentCallerId) return;
  const bot = room.players.get(room.currentCallerId);
  if (!bot?.isBot) return;

  const round = room.roundNumber;
  narrate(room, bot, 'thinking', `${bot.name} is scanning the board for a number to call…`);

  later(room, rand(...profileOf(bot).call), () => {
    if (stale(room, bot, round, 'await_call')) return;
    if (room.currentCallerId !== bot.id || room.tokens.length === 0) return;
    const token = pickOne(room.tokens);
    narrate(room, bot, 'called', `${bot.name} called ${token.value} — find it on the board.`);
    actions?.callNumber(room, token);
  });
}

/** A number has just been called: every bot that isn't the caller starts hunting. */
export function onCalled(room: Room) {
  if (!room.practice || !room.target) return;
  const round = room.roundNumber;
  const target = room.target;
  const windowMs = room.config.findSeconds * 1000;

  for (const bot of room.players.values()) {
    if (!bot.isBot || bot.left || bot.id === room.currentCallerId) continue;
    const prof = profileOf(bot);

    if (Math.random() < prof.miss) {
      narrate(room, bot, 'scanning', `${bot.name} is searching…`);
      later(room, windowMs * 0.8, () => {
        if (stale(room, bot, round, 'hunting')) return;
        if (room.foundBy.has(bot.id)) return;
        narrate(room, bot, 'gaveup', `${bot.name} can't spot ${target.value} — no puzzle, no points.`);
      });
      continue;
    }

    // Keep the find comfortably inside the window even on a short one.
    const findAt = Math.min(rand(...prof.find), windowMs * 0.75);
    narrate(room, bot, 'scanning', `${bot.name} is searching…`);

    if (Math.random() < prof.slip) {
      later(room, findAt * 0.45, () => {
        if (stale(room, bot, round, 'hunting')) return;
        if (room.foundBy.has(bot.id)) return;
        const wrong = room.tokens.filter((t) => t.id !== target.id);
        if (wrong.length === 0) return;
        const t = pickOne(wrong);
        narrate(room, bot, 'wrong', `${bot.name} tapped ${t.value} by mistake — that costs 2.`);
        actions?.boardClick(room, bot, t.x, t.y);
      });
    }

    later(room, findAt, () => {
      if (stale(room, bot, round, 'hunting')) return;
      if (room.foundBy.has(bot.id)) return;
      narrate(room, bot, 'found', `${bot.name} found ${target.value} — now on a puzzle.`);
      // Straight through the real hit-test, exactly like a tap from a phone.
      actions?.boardClick(room, bot, target.x, target.y);
    });
  }
}

/** A puzzle just opened for a bot — give it a human-ish amount of time on it. */
export function onPuzzleOpened(room: Room, bot: PlayerInternal, puzzle: PuzzleInternal) {
  if (!room.practice || !bot.isBot) return;
  const round = room.roundNumber;

  later(room, rand(...profileOf(bot).solve), () => {
    if (!rooms.has(room.code) || bot.left) return;
    // Unlike board actions this one survives a round change: a puzzle stays open across
    // `await_call`, which is the whole point of the grace window.
    const open = room.puzzles.get(bot.id);
    if (!open || open.id !== puzzle.id) return;
    if (room.roundNumber < round) return;

    // Characters in a puzzle are distinct, so the target spells out its own tile order.
    const byChar = new Map(puzzle.tiles.map((t) => [t.ch, t.id]));
    const order: string[] = [];
    for (const ch of puzzle.target) {
      const id = byChar.get(ch);
      if (!id) return;
      order.push(id);
    }
    actions?.submitPuzzle(room, bot, puzzle.id, order);
  });
}

/** Called after a bot's puzzle scores, so the feed can report the points. */
export function onBotSolved(room: Room, bot: PlayerInternal, delta: number) {
  narrate(room, bot, 'solved', `${bot.name} solved a puzzle · +${delta}`);
}
