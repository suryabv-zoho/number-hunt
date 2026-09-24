/** Socket event names, in one place so client and server can't drift. */

export const C2S = {
  createRoom: 'room:create',
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
  error: 'game:error',
} as const;
