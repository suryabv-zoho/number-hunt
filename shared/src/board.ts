import type { NumberToken } from './types.js';
import { mulberry32, randInt, pick } from './rng.js';

/**
 * The board is a fixed virtual canvas. Every client scales this same rectangle to fit
 * its viewport, so all players see an identical layout regardless of screen size.
 */
export const BOARD_W = 2000;
export const BOARD_H = 1250;

const MARGIN = 40;
const MIN_VALUE = 10;
const MAX_VALUE = 999;

/**
 * Numbers sit on a dark board, so these are light — but deliberately not neon. Fully
 * saturated brights on a dark field shimmer and tire the eyes over a long match, so
 * every one of these is pulled back toward pastel and held to a similar lightness, and
 * kept clear of the interface's violet so the UI never reads as "a number".
 */
export const PALETTE = [
  '#f0c05a',
  '#ef8f6b',
  '#e88bc4',
  '#b0d47a',
  '#7fb4e8',
  '#6fc9a2',
  '#e0a15c',
  '#88c9d8',
  '#e496a4',
  '#c49ae0',
  '#6cbfc4',
  '#cfc07a',
];

/**
 * Axis-aligned bounds of a rendered token, in board units.
 * Rendering (client) and hit-testing (server) both go through this so they can't disagree.
 */
export function tokenBounds(token: Pick<NumberToken, 'value' | 'x' | 'y' | 'fontSize'>) {
  const digits = String(token.value).length;
  // 0.62em per digit is a close enough advance width for the bold sans we render with.
  const w = digits * token.fontSize * 0.62;
  const h = token.fontSize;
  return {
    left: token.x - w / 2,
    right: token.x + w / 2,
    top: token.y - h / 2,
    bottom: token.y + h / 2,
    w,
    h,
  };
}

function overlaps(a: NumberToken, b: NumberToken, pad: number): boolean {
  const ba = tokenBounds(a);
  const bb = tokenBounds(b);
  return (
    ba.left - pad < bb.right + pad &&
    ba.right + pad > bb.left - pad &&
    ba.top - pad < bb.bottom + pad &&
    ba.bottom + pad > bb.top - pad
  );
}

/**
 * Scatter `count` unique numbers across the board with random colour, size and tilt.
 * Positions are rejection-sampled so labels don't pile on top of each other; the padding
 * relaxes if the board gets crowded rather than looping forever.
 */
export function generateBoard(count: number, seed: number): NumberToken[] {
  const rnd = mulberry32(seed);

  // Unique values, so a click is never ambiguous.
  const pool: number[] = [];
  for (let v = MIN_VALUE; v <= MAX_VALUE; v++) pool.push(v);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const values = pool.slice(0, Math.min(count, pool.length));

  const placed: NumberToken[] = [];
  values.forEach((value, i) => {
    const fontSize = randInt(rnd, 28, 64);
    let pad = 14;
    let token: NumberToken | null = null;

    for (let attempt = 0; attempt < 400; attempt++) {
      // Shrink the padding as attempts pile up rather than failing to place anything.
      if (attempt > 0 && attempt % 80 === 0) pad = Math.max(2, pad - 4);

      const candidate: NumberToken = {
        id: `t${i}`,
        value,
        fontSize,
        // Tilt makes scanning harder, which is the whole point of the game.
        rotation: randInt(rnd, -30, 30),
        color: pick(rnd, PALETTE),
        x: 0,
        y: 0,
      };
      const b = tokenBounds(candidate);
      candidate.x = MARGIN + b.w / 2 + rnd() * (BOARD_W - 2 * MARGIN - b.w);
      candidate.y = MARGIN + b.h / 2 + rnd() * (BOARD_H - 2 * MARGIN - b.h);

      if (!placed.some((p) => overlaps(p, candidate, pad))) {
        token = candidate;
        break;
      }
    }

    // Last resort: place it anyway so the board always has the requested count.
    if (!token) {
      token = {
        id: `t${i}`,
        value,
        fontSize,
        rotation: randInt(rnd, -30, 30),
        color: pick(rnd, PALETTE),
        x: MARGIN + rnd() * (BOARD_W - 2 * MARGIN),
        y: MARGIN + rnd() * (BOARD_H - 2 * MARGIN),
      };
    }
    placed.push(token);
  });

  return placed;
}

/** Which token (if any) sits under a click at board coords (x, y). */
export function hitTest(tokens: readonly NumberToken[], x: number, y: number): NumberToken | null {
  // Generous slop so a near-miss on a small number still registers, and so tilted
  // labels stay clickable despite the axis-aligned box.
  const SLOP = 8;
  let best: NumberToken | null = null;
  let bestArea = Infinity;

  for (const t of tokens) {
    const b = tokenBounds(t);
    if (
      x >= b.left - SLOP &&
      x <= b.right + SLOP &&
      y >= b.top - SLOP &&
      y <= b.bottom + SLOP
    ) {
      // If boxes overlap, the smallest one wins — that's the one the eye targeted.
      const area = b.w * b.h;
      if (area < bestArea) {
        best = t;
        bestArea = area;
      }
    }
  }
  return best;
}
