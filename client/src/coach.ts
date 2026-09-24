/**
 * The practice coach: a linear script that explains the screen and tells the player what
 * to do next.
 *
 * Two kinds of step, which is what makes this both a product tour and a tutorial:
 *
 *  - `{ on: 'next' }`     — an explanation. The player reads it and presses Next.
 *  - `{ on: 'signal' }`   — an instruction. It stays on screen until the player actually
 *                           does the thing, and the *game* reports it (see `signal()`),
 *                           so the coach can never claim something happened that didn't.
 *
 * Every waiting step carries a `timeoutMs`. A tutorial that can deadlock is worse than no
 * tutorial, and there are plenty of ways to reach a state the script didn't predict — the
 * player's turn can be skipped, a round can resolve early, they can wander off. When the
 * clock runs out the coach moves on rather than sitting there insisting.
 */
import { create } from 'zustand';

/** Things the game tells the coach about. Raised from `socket.ts`. */
export type CoachSignal =
  | 'i_called'
  | 'i_solved'
  | 'i_found'
  | 'hunt_started'
  | 'match_over';

export interface CoachStep {
  id: string;
  /** `data-tour` value to spotlight. Omitted = a plain centred card, nothing highlighted. */
  anchor?: string;
  title: string;
  body: string;
  /** Short call to action under the body, for steps that want the player to act. */
  action?: string;
  /**
   * Darken everything outside the anchor. On by default, but turned off for any step
   * that asks the player to *search* the screen — dimming the board while telling
   * someone to find a number on it is working against them.
   */
  dim?: boolean;
  /** Open this step already minimised, for steps whose whole job is "go and look". */
  compact?: boolean;
  advance: { on: 'next' } | { on: 'signal'; signal: CoachSignal; timeoutMs: number };
}

export const COACH_STEPS: CoachStep[] = [
  {
    id: 'welcome',
    title: 'Practice match',
    body: "It's you against two computer players. Nothing here counts and nothing is penalised — I'll walk you through one full turn, then you can play the rest however you like.",
    advance: { on: 'next' },
  },
  {
    id: 'hud',
    anchor: 'hud',
    title: 'The top bar',
    body: 'Which room you are in, how long is left in the match, and the clock for whatever is happening right now. Under those is every player and their score — yours is the highlighted one, and the two with a robot next to them are the computer players.',
    advance: { on: 'next' },
  },
  {
    id: 'feed',
    anchor: 'feed',
    title: 'What the computers are doing',
    body: "In a real game the other players are on their own phones and you can't see their screens. Here you can: this panel narrates what each computer player is looking at, finding and solving, so you can follow both sides of a turn.",
    advance: { on: 'next' },
  },
  {
    id: 'board',
    anchor: 'board',
    title: 'The board',
    body: 'Thirty-five numbers, scattered and tilted. Pinch or scroll to zoom in, and drag to move around. The same board is on everyone’s screen, laid out identically.',
    advance: { on: 'next' },
  },
  {
    id: 'call',
    anchor: 'board',
    title: 'Your turn to call',
    body: 'Each turn, one player picks a number and says it out loud. Everyone else has to find it. You go first.',
    action: 'Tap any number on the board.',
    // Don't darken the thing they've just been told to pick from.
    dim: false,
    advance: { on: 'signal', signal: 'i_called', timeoutMs: 180_000 },
  },
  {
    id: 'puzzle',
    anchor: 'puzzle',
    title: 'Now you are busy',
    body: 'You called it, so you already know where it is — instead you get a tile puzzle. Drag the tiles below to match the pattern above. This is the only thing in the game that scores points, and solving it faster is worth more.',
    action: 'Drag the tiles into the right order.',
    advance: { on: 'signal', signal: 'i_solved', timeoutMs: 180_000 },
  },
  {
    id: 'streak',
    title: 'Solved it',
    body: 'A new puzzle appears the moment you finish one, and you keep them coming until the turn moves on. That is the real reward for finding a number quickly: more time on puzzles than anyone else.',
    advance: { on: 'next' },
  },
  {
    id: 'their_turn',
    anchor: 'feed',
    title: 'Their turn to call',
    body: 'Keep solving while a computer player picks a number — the feed tells you the moment one of them calls. Your puzzle then closes and you go and find their number on the board. A wrong tap costs you 2 and freezes the board briefly, so it pays to be sure.',
    advance: { on: 'signal', signal: 'hunt_started', timeoutMs: 120_000 },
  },
  {
    id: 'hunt',
    anchor: 'status',
    title: 'Find it',
    body: '',
    action: 'Find the number above on the board, and tap it.',
    // The whole step is "go and look at the screen", so it gets out of the way: no dim,
    // and a slim bar instead of a card over the bottom third of the board.
    dim: false,
    compact: true,
    advance: { on: 'signal', signal: 'i_found', timeoutMs: 120_000 },
  },
  {
    id: 'done',
    title: "That's the whole game",
    body: 'Call, hunt, solve, repeat — until the board is empty or the clock runs out, then the leaderboard. Play out the rest of this match to get a feel for it. You can leave any time from the button in the top right.',
    advance: { on: 'next' },
  },
];

interface CoachState {
  /** Index into COACH_STEPS, or -1 when the coach isn't running. */
  index: number;
  running: boolean;
  /**
   * Folded down to a button. On a phone the full card covers the game it is describing,
   * so the player can put it away and pull it back whenever they want to re-read it.
   */
  minimised: boolean;
  step: () => CoachStep | null;
  start: () => void;
  next: () => void;
  stop: () => void;
  setMinimised: (v: boolean) => void;
  /** The game reporting that something happened. Advances a waiting step. */
  signal: (s: CoachSignal) => void;
}

let waitTimer: ReturnType<typeof setTimeout> | undefined;

/** Kept out of the main store: it's a self-contained bit of UI with its own lifetime. */
export const useCoach = create<CoachState>()((set, get) => {
  /** Arm the escape hatch for a step that is waiting on the player. */
  function armTimeout(index: number) {
    clearTimeout(waitTimer);
    const step = COACH_STEPS[index];
    if (!step || step.advance.on !== 'signal') return;
    const { timeoutMs } = step.advance;
    waitTimer = setTimeout(() => {
      // Only skip if we're still sitting on the very step that armed this.
      if (get().running && get().index === index) get().next();
    }, timeoutMs);
  }

  function go(index: number) {
    if (index >= COACH_STEPS.length) {
      clearTimeout(waitTimer);
      set({ running: false, index: -1, minimised: false });
      return;
    }
    const step = COACH_STEPS[index];
    set({
      index,
      running: true,
      // A step that needs a button press has to be readable, or the tour stalls behind
      // a pill the player doesn't know to open. Steps that wait on the player keep
      // whatever they chose last — except the ones that start folded away by design.
      minimised:
        step.advance.on === 'next' ? false : (step.compact ?? get().minimised),
    });
    armTimeout(index);
  }

  return {
    index: -1,
    running: false,
    minimised: false,
    setMinimised: (minimised) => set({ minimised }),
    step: () => {
      const { index, running } = get();
      return running ? (COACH_STEPS[index] ?? null) : null;
    },
    start: () => {
      set({ minimised: false });
      go(0);
    },
    next: () => {
      if (!get().running) return;
      go(get().index + 1);
    },
    stop: () => {
      clearTimeout(waitTimer);
      set({ running: false, index: -1, minimised: false });
    },
    signal: (s) => {
      const { running, index } = get();
      if (!running) return;
      // The match ending pulls the rug out from under any remaining instruction.
      if (s === 'match_over') {
        get().stop();
        return;
      }
      const step = COACH_STEPS[index];
      if (step?.advance.on === 'signal' && step.advance.signal === s) get().next();
    },
  };
});
