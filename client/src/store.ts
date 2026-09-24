import { create } from 'zustand';
import type {
  GameOverPayload,
  NumberToken,
  Player,
  PuzzleView,
  RoomState,
} from '@game/shared';

export interface Toast {
  id: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

interface AppState {
  connected: boolean;
  playerId: string | null;
  name: string;
  room: RoomState | null;
  /**
   * The board, kept separately from the room snapshot: it arrives once per match and
   * then only changes by one token a round, so it stays out of the hot update path.
   */
  tokens: NumberToken[];
  puzzle: PuzzleView | null;
  matchLeftMs: number | null;
  phaseLeftMs: number | null;
  lockedUntil: number;
  gameOver: GameOverPayload | null;
  /** Set once we deliberately walk out, so late state broadcasts can't drag us back. */
  hasLeft: boolean;
  /** A message to show on the home screen, e.g. the host closed the room. */
  notice: string | null;
  /** Puzzles solved since the current window opened — resets when the turn moves on. */
  streak: number;
  toasts: Toast[];
  error: string | null;
  speak: boolean;
  /** The browser refused to read a number out — worth telling the player. */
  speechBlocked: boolean;

  setConnected: (v: boolean) => void;
  setIdentity: (playerId: string, name: string) => void;
  setRoom: (room: RoomState | null) => void;
  setTokens: (tokens: NumberToken[]) => void;
  removeToken: (tokenId: string) => void;
  setHasLeft: (v: boolean) => void;
  setNotice: (v: string | null) => void;
  bumpStreak: () => void;
  resetStreak: () => void;
  setPuzzle: (p: PuzzleView | null) => void;
  setTick: (matchLeftMs: number | null, phaseLeftMs: number | null) => void;
  lockBoard: (ms: number) => void;
  setGameOver: (g: GameOverPayload | null) => void;
  pushToast: (text: string, tone?: Toast['tone']) => void;
  dropToast: (id: number) => void;
  setError: (e: string | null) => void;
  toggleSpeak: () => void;
  setSpeechBlocked: (v: boolean) => void;
  me: () => Player | null;
}

let toastSeq = 0;

export const useStore = create<AppState>()((set, get) => ({
  connected: false,
  // Identity lives in sessionStorage, not localStorage: it survives a refresh but stays
  // per-tab, so two players on one machine (or three test tabs) don't clobber each other.
  playerId: sessionStorage.getItem('nh.playerId'),
  name: localStorage.getItem('nh.name') ?? '',
  room: null,
  tokens: [],
  puzzle: null,
  matchLeftMs: null,
  phaseLeftMs: null,
  lockedUntil: 0,
  gameOver: null,
  hasLeft: false,
  notice: null,
  streak: 0,
  toasts: [],
  error: null,
  speak: localStorage.getItem('nh.speak') !== 'off',
  speechBlocked: false,

  setConnected: (connected) => set({ connected }),
  setIdentity: (playerId, name) => {
    sessionStorage.setItem('nh.playerId', playerId);
    // Per-tab, so two players sharing a browser keep their own names; the localStorage
    // copy is only the pre-filled default for a brand new tab.
    sessionStorage.setItem('nh.name', name);
    localStorage.setItem('nh.name', name);
    set({ playerId, name });
  },
  setRoom: (room) => {
    if (room && get().hasLeft) return;
    if (room) sessionStorage.setItem('nh.room', room.code);
    // No room, or back in the lobby, means there is no board to show.
    if (!room || room.phase === 'lobby') set({ room, tokens: [] });
    else set({ room });
  },
  setTokens: (tokens) => set({ tokens }),
  removeToken: (tokenId) =>
    set((s) => ({ tokens: s.tokens.filter((t) => t.id !== tokenId) })),
  setHasLeft: (hasLeft) => set({ hasLeft }),
  setNotice: (notice) => set({ notice }),
  bumpStreak: () => set((s) => ({ streak: s.streak + 1 })),
  resetStreak: () => set({ streak: 0 }),
  setPuzzle: (puzzle) => set({ puzzle }),
  setTick: (matchLeftMs, phaseLeftMs) => set({ matchLeftMs, phaseLeftMs }),
  lockBoard: (ms) => set({ lockedUntil: Date.now() + ms }),
  setGameOver: (gameOver) => set({ gameOver }),
  pushToast: (text, tone = 'info') => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => get().dropToast(id), 2600);
  },
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setError: (error) => set({ error }),
  setSpeechBlocked: (speechBlocked) => set({ speechBlocked }),
  toggleSpeak: () =>
    set((s) => {
      localStorage.setItem('nh.speak', s.speak ? 'off' : 'on');
      return { speak: !s.speak };
    }),

  me: () => {
    const { room, playerId } = get();
    return room?.players.find((p) => p.id === playerId) ?? null;
  },
}));
