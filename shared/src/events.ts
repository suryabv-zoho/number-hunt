/** Socket event names, in one place so client and server can't drift. */

export const C2S = {
  createRoom: 'room:create',
  /** Solo room against two bots, started immediately — no lobby, no join code. */
  createPractice: 'room:practice',
  joinRoom: 'room:join',
  config: 'room:config',
  start: 'room:start',
  /** One event for both jobs: the caller picking a number, and hunters hunting it. */
  boardClick: 'board:click',
  puzzleSubmit: 'puzzle:submit',
  /** Host only: take the room back to the lobby for another match. */
  playAgain: 'room:playAgain',
  /** Everyone else: "yes, deal me in again". The host can't restart without one. */
  acceptRematch: 'room:acceptRematch',
  /** Host only: shut the room down for everybody. */
  closeRoom: 'room:close',
  leave: 'room:leave',
  /** Host only: let a waiting player in, or turn them away. */
  admit: 'room:admit',
  decline: 'room:decline',
  /** Host only: remove someone who is already in. */
  kick: 'room:kick',
  /** Practice only: hold the clocks while the player reads a coach instruction. */
  coachPause: 'coach:pause',
} as const;

export const S2C = {
  state: 'room:state',
  turnCalled: 'turn:called',
  turnMissed: 'turn:missed',
  boardInit: 'board:init',
  boardRemove: 'board:remove',
  boardFound: 'board:found',
  boardWrong: 'board:wrong',
  puzzleStart: 'puzzle:start',
  puzzleEnd: 'puzzle:end',
  puzzleResult: 'puzzle:result',
  tick: 'game:tick',
  gameOver: 'game:over',
  roomClosed: 'room:closed',
  /** Sent to the person waiting at the door, not to the room. */
  admitted: 'room:admitted',
  declined: 'room:declined',
  kicked: 'room:kicked',
  /** Practice only: narration of what a bot just did. */
  botActivity: 'practice:bot',
  error: 'game:error',
} as const;
